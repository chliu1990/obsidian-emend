import { TFile } from 'obsidian';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { AdditionalNoteSnapshot } from '../src/additional-notes-context';
import type {
	AiProviderRequest,
	StreamEvent,
	StreamResult,
} from '../src/provider-stream';
import { QUICK_ACTIONS } from '../src/quick-actions';
import {
	EditRequestCoordinator,
	ReadOnlyRequestCoordinator,
	type EditSubmission,
	type ReadOnlySubmission,
} from '../src/request-coordinator';
import type { RequestContext } from '../src/context';
import { operationEditStrategy } from '../src/operation-edit-strategy';
import type { NoteWriter } from '../src/note-writer';
import type {
	InstructionPromptParts,
	ProviderConfig,
	ProviderHistoryMessage,
} from '../src/types';
import type { WebSearchRunOptions, WebToolLoopResult } from '../src/web-search';

const provider: ProviderConfig = {
	name: 'Local test provider',
	baseUrl: 'http://127.0.0.1:8787/v1',
	apiKey: 'dummy-test-key',
	model: 'dummy-model',
	reasoningEffort: 'low',
	requestUsage: true,
	discoveredModels: [],
};

function makeContext(overrides: Partial<RequestContext> = {}): RequestContext {
	const file = new TFile();
	file.path = 'folder/note.md';
	return {
		file,
		sourceText: '# Note\nOriginal text',
		selection: { from: 0, to: 0 },
		noteLabel: 'folder/note.md',
		markdown: '# Note\nOriginal text',
		...overrides,
	};
}

function makeAdditionalNote(
	overrides: Partial<AdditionalNoteSnapshot> = {},
): AdditionalNoteSnapshot {
	return {
		sourcePath: 'Reference.md',
		markdown: 'Additional only.',
		sourceCharacters: 16,
		includedCharacters: 16,
		...overrides,
	};
}

function successfulRequest(
	events: StreamEvent[] = [
		{ type: 'content', text: 'Streamed answer' },
		{ type: 'reasoning', text: 'Folded reasoning' },
	],
) {
	return vi.fn(
		async (
			_request: AiProviderRequest,
			callbacks: { onEvent(event: StreamEvent): void },
			_signal: AbortSignal,
		): Promise<StreamResult> => {
			for (const event of events) {
				callbacks.onEvent(event);
			}
			return { content: 'Streamed answer', reasoning: 'Folded reasoning' };
		},
	);
}

function makeAdditionalNotesLoader() {
	return vi.fn(
		async (
			_paths: readonly string[],
			_activeNotePath: string,
			_signal: AbortSignal,
		): Promise<AdditionalNoteSnapshot[]> => [],
	);
}

function makeCoordinator(
	request = successfulRequest(),
	instructions: InstructionPromptParts = { skillTexts: new Map() },
) {
	const loadInstructions = vi.fn(async () => instructions);
	const loadAdditionalNotes = makeAdditionalNotesLoader();
	const coordinator = new ReadOnlyRequestCoordinator({
		provider,
		loadAdditionalNotes,
		loadInstructions,
		request,
	});
	return { coordinator, loadAdditionalNotes, loadInstructions, request };
}

function makeSubmission(
	overrides: Partial<ReadOnlySubmission> = {},
): ReadOnlySubmission {
	return {
		context: makeContext(),
		mode: 'ask',
		prompt: 'What does this note say?',
		history: [],
		additionalNotePaths: [],
		callbacks: { onContent: vi.fn(), onReasoning: vi.fn() },
		signal: new AbortController().signal,
		...overrides,
	};
}

describe('ReadOnlyRequestCoordinator', () => {
	it('has no writer dependency and accepts only read-only submission modes', () => {
		type Dependencies = ConstructorParameters<
			typeof ReadOnlyRequestCoordinator
		>[0];
		type Mode = ReadOnlySubmission['mode'];

		expectTypeOf<Dependencies>().not.toHaveProperty('writer');
		expectTypeOf<Dependencies>().not.toHaveProperty('noteWriter');
		expectTypeOf<Dependencies['loadAdditionalNotes']>().toEqualTypeOf<
			Required<Dependencies>['loadAdditionalNotes']
		>();
		expectTypeOf<Mode>().toEqualTypeOf<'ask' | 'discuss' | 'brainstorm'>();
	});

	it.each(['ask', 'discuss', 'brainstorm'] as const)(
		'streams %s responses only through content and reasoning callbacks',
		async (mode) => {
			const { coordinator, request } = makeCoordinator();
			const submission = makeSubmission({ mode });
			const originalSource = submission.context.sourceText;

			const result = await coordinator.submit(submission);

			expect(result.content).toBe('Streamed answer');
			expect(submission.callbacks.onContent).toHaveBeenCalledExactlyOnceWith(
				'Streamed answer',
			);
			expect(submission.callbacks.onReasoning).toHaveBeenCalledExactlyOnceWith(
				'Folded reasoning',
			);
			expect(submission.context.sourceText).toBe(originalSource);
			const requestArg = request.mock.calls[0]?.[0];
			expect(requestArg?.systemPrompt).toContain('Respond only in chat.');
			expect(requestArg?.systemPrompt).not.toContain('CriticMarkup');
		},
	);

	it('loads current instructions for every request and places skills before AGENTS', async () => {
		const instructions: InstructionPromptParts = {
			agentText: 'Agent instructions',
			skillTexts: new Map([['skills/review/SKILL.md', 'Review skill']]),
		};
		const { coordinator, loadInstructions, request } = makeCoordinator(
			successfulRequest(),
			instructions,
		);

		await coordinator.submit(makeSubmission());
		await coordinator.submit(makeSubmission());

		expect(loadInstructions).toHaveBeenCalledTimes(2);
		for (const call of request.mock.calls) {
			const systemPrompt = call[0].systemPrompt;
			expect(systemPrompt.indexOf('Review skill')).toBeLessThan(
				systemPrompt.indexOf('Agent instructions'),
			);
		}
	});

	it('caps provider history at the last eight ready messages', async () => {
		const { coordinator, request } = makeCoordinator();
		const history: ProviderHistoryMessage[] = Array.from(
			{ length: 12 },
			(_, index) => ({
				role: index % 2 === 0 ? 'user' : 'assistant',
				content: `ready ${index}`,
				mode: 'ask',
				origin: index % 2 === 0 ? 'user' : 'model',
			}),
		);

		await coordinator.submit(makeSubmission({ history }));

		expect(request.mock.calls[0]?.[0].history).toEqual(history.slice(-8));
	});

	it('adds an estimated usage source using the exact request and response text', async () => {
		const { coordinator, request } = makeCoordinator();

		const result = await coordinator.submit(makeSubmission());

		const requestArg = request.mock.calls[0]?.[0];
		if (!requestArg) {
			throw new Error('Provider request missing.');
		}
		const promptTokens = Math.max(
			1,
			Math.ceil(
				(requestArg.systemPrompt.length +
					requestArg.userPrompt.length +
					requestArg.history.reduce((sum, item) => sum + item.content.length, 0)) /
					4,
			),
		);
		const completionTokens = Math.max(
			1,
			Math.ceil((result.content.length + result.reasoning.length) / 4),
		);
		expect(result.usage).toEqual({
			promptTokens,
			completionTokens,
			totalTokens: promptTokens + completionTokens,
			source: 'estimated',
		});
	});

	it('labels valid provider usage and preserves zero counts', async () => {
		const request = vi.fn(async (): Promise<StreamResult> => ({
			content: 'Streamed answer',
			reasoning: 'Folded reasoning',
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
		}));
		const { coordinator } = makeCoordinator(request);

		const result = await coordinator.submit(makeSubmission());

		expect(result.usage).toEqual({
			promptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
			source: 'provider',
		});
	});

	it('builds prompts from captured context without an opt-in path', async () => {
		const { coordinator, request } = makeCoordinator();

		await coordinator.submit(makeSubmission());

		const userPrompt = request.mock.calls[0]?.[0].userPrompt ?? '';
		expect(userPrompt).toContain('# Note\nOriginal text');
		expect(userPrompt).toContain('What does this note say?');
		expect(userPrompt).not.toContain('folder/note.md');
	});

	it('includes only the explicitly captured opt-in note path', async () => {
		const { coordinator, request } = makeCoordinator();
		const context = makeContext({ notePath: 'Vault/folder/note.md' });

		await coordinator.submit(makeSubmission({ context }));

		const userPrompt = request.mock.calls[0]?.[0].userPrompt ?? '';
		expect(userPrompt).toContain('Vault/folder/note.md');
	});

	it('passes the caller AbortSignal to the provider', async () => {
		const { coordinator, request } = makeCoordinator();
		const controller = new AbortController();

		await coordinator.submit(makeSubmission({ signal: controller.signal }));

		expect(request.mock.calls[0]?.[2]).toBe(controller.signal);
	});

	it.each(['provider error', 'abort'])(
		'does not mutate note text after a %s',
		async (failure) => {
			const error =
				failure === 'abort'
					? new DOMException('Stopped', 'AbortError')
					: new Error('Provider unavailable');
			const request = vi.fn(async () => {
				throw error;
			});
			const { coordinator } = makeCoordinator(request);
			const submission = makeSubmission();
			const originalSource = submission.context.sourceText;

			await expect(coordinator.submit(submission)).rejects.toBe(error);

			expect(submission.context.sourceText).toBe(originalSource);
			expect(submission.callbacks.onContent).not.toHaveBeenCalled();
			expect(submission.callbacks.onReasoning).not.toHaveBeenCalled();
		},
	);
	it.each(['ask', 'discuss', 'brainstorm'] as const)(
		'loads exact additional-note paths before instructions and labels them for %s',
		async (mode) => {
			const order: string[] = [];
			const request = vi.fn(async (
				_request: AiProviderRequest,
			): Promise<StreamResult> => {
				order.push('request');
				return { content: 'Answer', reasoning: '' };
			});
			const { coordinator, loadAdditionalNotes, loadInstructions } =
				makeCoordinator(request);
			loadAdditionalNotes.mockImplementation(async () => {
				order.push('additional notes');
				return [
					makeAdditionalNote({ providerPath: 'Vault/Reference.md' }),
					makeAdditionalNote({
						sourcePath: 'Second.md',
						markdown: 'Second additional note.',
					}),
				];
			});
			loadInstructions.mockImplementation(async () => {
				order.push('instructions');
				return { skillTexts: new Map() };
			});
			const additionalNotePaths = ['Reference.md', 'Second.md'];
			const submission = makeSubmission({ mode, additionalNotePaths });

			await coordinator.submit(submission);

			expect(loadAdditionalNotes).toHaveBeenCalledExactlyOnceWith(
				additionalNotePaths,
				'folder/note.md',
				submission.signal,
			);
			expect(order).toEqual(['additional notes', 'instructions', 'request']);
			const userPrompt = request.mock.calls[0]?.[0].userPrompt ?? '';
			const activeContextIndex = userPrompt.indexOf('Active note Markdown:');
			const firstAdditionalIndex = userPrompt.indexOf('## Additional note 1');
			const secondAdditionalIndex = userPrompt.indexOf('## Additional note 2');
			const userMessageIndex = userPrompt.indexOf('User message:');
			expect(activeContextIndex).toBeGreaterThanOrEqual(0);
			expect(firstAdditionalIndex).toBeGreaterThan(activeContextIndex);
			expect(secondAdditionalIndex).toBeGreaterThan(firstAdditionalIndex);
			expect(userMessageIndex).toBeGreaterThan(secondAdditionalIndex);
			expect(userPrompt).toContain('Path: Vault/Reference.md');
			expect(userPrompt).toContain('Additional only.');
			expect(userPrompt).toContain('Second additional note.');
			expect(userPrompt).not.toContain('Path: Second.md');
		},
	);

	it('omits the additional-note section for an empty path selection', async () => {
		const { coordinator, loadAdditionalNotes, request } = makeCoordinator();
		const submission = makeSubmission({ additionalNotePaths: [] });

		await coordinator.submit(submission);

		expect(loadAdditionalNotes).toHaveBeenCalledExactlyOnceWith(
			[],
			'folder/note.md',
			submission.signal,
		);
		expect(request.mock.calls[0]?.[0].userPrompt).not.toContain(
			'## Additional note',
		);
	});

	it('estimates usage from the exact prompt augmented with additional notes', async () => {
		const { coordinator, loadAdditionalNotes, request } = makeCoordinator();
		loadAdditionalNotes.mockResolvedValue([makeAdditionalNote()]);

		const result = await coordinator.submit(
			makeSubmission({ additionalNotePaths: ['Reference.md'] }),
		);

		const expectedUserPrompt = [
			'Active note Markdown:',
			'```markdown',
			'# Note\nOriginal text',
			'```',
			'',
			'## Additional note 1',
			'Additional notes are read-only context and are not edit targets.',
			'',
			'```markdown',
			'Additional only.',
			'```',
			'',
			'User message:',
			'What does this note say?',
		].join('\n');
		const requestArg = request.mock.calls[0]?.[0];
		if (!requestArg) {
			throw new Error('Provider request missing.');
		}
		expect(requestArg.userPrompt).toBe(expectedUserPrompt);
		const promptTokens = Math.max(
			1,
			Math.ceil((requestArg.systemPrompt.length + expectedUserPrompt.length) / 4),
		);
		const completionTokens = Math.max(
			1,
			Math.ceil((result.content.length + result.reasoning.length) / 4),
		);
		expect(result.usage).toEqual({
			promptTokens,
			completionTokens,
			totalTokens: promptTokens + completionTokens,
			source: 'estimated',
		});
	});
});

function editRequest(
	response: string,
	reasoning = 'Editing the complete note.',
) {
	return vi.fn(
		async (
			_request: AiProviderRequest,
			callbacks: { onEvent(event: StreamEvent): void },
			_signal: AbortSignal,
		): Promise<StreamResult> => {
			if (reasoning) {
				callbacks.onEvent({ type: 'reasoning', text: reasoning });
			}
			for (const chunk of response.match(/.{1,5}/gs) ?? []) {
				callbacks.onEvent({ type: 'content', text: chunk });
			}
			return { content: response, reasoning };
		},
	);
}

function makeEditCoordinator(
	request: ReturnType<typeof editRequest>,
	currentText = '# Note\nOriginal text',
) {
	const writer: NoteWriter = {
		readCurrentText: vi.fn(async () => currentText),
		write: vi.fn(async () => undefined),
		isTargetCurrent: vi.fn(() => true),
	};
	const loadInstructions = vi.fn(async () => ({ skillTexts: new Map() }));
	const loadAdditionalNotes = makeAdditionalNotesLoader();
	const coordinator = new EditRequestCoordinator({
		provider,
		loadAdditionalNotes,
		loadInstructions,
		request,
		writer,
		editStrategy: operationEditStrategy,
	});
	return { coordinator, loadAdditionalNotes, loadInstructions, request, writer };
}

function makeEditSubmission(
	overrides: Partial<EditSubmission> = {},
): EditSubmission {
	return {
		context: makeContext(),
		mode: 'edit',
		prompt: 'Improve this note.',
		history: [],
		additionalNotePaths: [],
		callbacks: { onReasoning: vi.fn() },
		signal: new AbortController().signal,
		...overrides,
	};
}

describe('EditRequestCoordinator', () => {
	it('accepts only Edit and owns the writer dependency', () => {
		type Mode = EditSubmission['mode'];
		type Dependencies = ConstructorParameters<
			typeof EditRequestCoordinator
		>[0];

		expectTypeOf<Mode>().toEqualTypeOf<'edit'>();
		expectTypeOf<Dependencies>().toHaveProperty('writer');
	});

	it('always sends the complete captured source instead of bounded context', async () => {
		const sourceText = 'START\n' + 'long note content\n'.repeat(100) + 'END';
		const context = makeContext({
			sourceText,
			markdown: '[...]\nbounded window\n[...]',
		});
		const { coordinator, request } = makeEditCoordinator(
			editRequest('[]'),
			sourceText,
		);

		await coordinator.submit(makeEditSubmission({ context }));

		const userPrompt = request.mock.calls[0]?.[0].userPrompt ?? '';
		expect(userPrompt).toContain(sourceText);
		expect(userPrompt).not.toContain('bounded window');
		expect(userPrompt).not.toContain('[...]');
		expect(request.mock.calls[0]?.[0].systemPrompt).toContain(
			'bare JSON array',
		);
	});

	it.each(QUICK_ACTIONS)(
		'$id uses the same additional-note loading and prompt path',
		async (action) => {
			const order: string[] = [];
			const request = editRequest('[]');
			const { coordinator, loadAdditionalNotes, loadInstructions } =
				makeEditCoordinator(request);
			loadAdditionalNotes.mockImplementation(async () => {
				order.push('additional notes');
				return [makeAdditionalNote()];
			});
			loadInstructions.mockImplementation(async () => {
				order.push('instructions');
				return { skillTexts: new Map() };
			});
			const originalRequest = request.getMockImplementation();
			request.mockImplementation(async (...args) => {
				order.push('request');
				return originalRequest?.(...args) ?? { content: '[]', reasoning: '' };
			});
			const additionalNotePaths = ['Reference.md'];
			const submission = makeEditSubmission({
				prompt: action.prompt,
				additionalNotePaths,
			});

			await coordinator.submit(submission);

			expect(loadAdditionalNotes).toHaveBeenCalledExactlyOnceWith(
				additionalNotePaths,
				'folder/note.md',
				submission.signal,
			);
			expect(order).toEqual(['additional notes', 'instructions', 'request']);
			const userPrompt = request.mock.calls[0]?.[0].userPrompt ?? '';
			expect(userPrompt.indexOf('Active note Markdown:')).toBeLessThan(
				userPrompt.indexOf('## Additional note 1'),
			);
			expect(userPrompt.indexOf('## Additional note 1')).toBeLessThan(
				userPrompt.indexOf('User message:'),
			);
			expect(userPrompt).toContain('Additional only.');
			expect(userPrompt).toContain(`User message:\n${action.prompt}`);
		},
	);

	it('streams reasoning while buffering the edit privately and writes after completion', async () => {
		const response = JSON.stringify([
			{ type: 'replace', target: 'Original', replacement: 'Edited' },
		]);
		const request = editRequest(response);
		const { coordinator, writer } = makeEditCoordinator(request);
		const submission = makeEditSubmission();

		const result = await coordinator.submit(submission);

		expect(result).toMatchObject({
			applied: true,
			changeCount: 1,
			usage: { source: 'estimated' },
		});
		expect(submission.callbacks.onReasoning).toHaveBeenCalledExactlyOnceWith(
			'Editing the complete note.',
		);
		expect(writer.write).toHaveBeenCalledExactlyOnceWith(
			submission.context.file,
			'# Note\n{~~Original~>Edited~~} text',
		);
		expect(request.mock.invocationCallOrder[0]).toBeLessThan(
			(writer.write as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ??
				0,
		);
	});

	it('rejects an Operation target found only in an additional note without writing', async () => {
		const additionalNote = makeAdditionalNote();
		const originalAdditionalMarkdown = additionalNote.markdown;
		const request = editRequest(JSON.stringify([
			{ type: 'replace', target: 'Additional only', replacement: 'Changed' },
		]));
		const { coordinator, loadAdditionalNotes, writer } =
			makeEditCoordinator(request);
		loadAdditionalNotes.mockResolvedValue([additionalNote]);
		const submission = makeEditSubmission({
			additionalNotePaths: ['Reference.md'],
		});

		await expect(coordinator.submit(submission)).rejects.toThrow(/not found|match/i);

		expect(request).toHaveBeenCalledOnce();
		expect(writer.readCurrentText).not.toHaveBeenCalled();
		expect(writer.write).not.toHaveBeenCalled();
		expect(submission.context.sourceText).toBe('# Note\nOriginal text');
		expect(additionalNote.markdown).toBe(originalAdditionalMarkdown);
	});

	it('applies an active-note insertion without changing additional-note text', async () => {
		const additionalNote = makeAdditionalNote();
		const request = editRequest(JSON.stringify([
			{ type: 'insert', anchor: 'Original', position: 'after', text: ' changed' },
		]));
		const { coordinator, loadAdditionalNotes, writer } =
			makeEditCoordinator(request);
		loadAdditionalNotes.mockResolvedValue([additionalNote]);
		const submission = makeEditSubmission({
			additionalNotePaths: ['Reference.md'],
		});

		await expect(coordinator.submit(submission)).resolves.toMatchObject({
			applied: true,
			changeCount: 1,
		});

		expect(writer.write).toHaveBeenCalledExactlyOnceWith(
			submission.context.file,
			'# Note\nOriginal{++ changed++} text',
		);
		expect(additionalNote.markdown).toBe('Additional only.');
	});

	it('returns an unchanged result and performs no write for a no-op', async () => {
		const sourceText = '# Note\nOriginal text';
		const { coordinator, writer } = makeEditCoordinator(
			editRequest('[]'),
			sourceText,
		);

		const result = await coordinator.submit(makeEditSubmission());

		expect(result).toMatchObject({
			applied: false,
			changeCount: 0,
			usage: { source: 'estimated' },
		});
		expect(writer.write).not.toHaveBeenCalled();
	});

	it('rejects invalid output without writing', async () => {
		const { coordinator, writer } = makeEditCoordinator(
			editRequest('Here is my answer instead of the note.'),
		);

		await expect(coordinator.submit(makeEditSubmission())).rejects.toThrow();

		expect(writer.readCurrentText).not.toHaveBeenCalled();
		expect(writer.write).not.toHaveBeenCalled();
	});

	it.each(['provider error', 'abort'])(
		'does not write after a %s',
		async (failure) => {
			const error =
				failure === 'abort'
					? new DOMException('Stopped', 'AbortError')
					: new Error('Provider unavailable');
			const request = vi.fn(async () => {
				throw error;
			});
			const { coordinator, writer } = makeEditCoordinator(request);

			await expect(coordinator.submit(makeEditSubmission())).rejects.toBe(error);

			expect(writer.readCurrentText).not.toHaveBeenCalled();
			expect(writer.write).not.toHaveBeenCalled();
		},
	);

	it('does not write when the note changed before stream completion', async () => {
		const { coordinator, writer } = makeEditCoordinator(
			editRequest(JSON.stringify([
				{ type: 'insert', anchor: 'Original', position: 'after', text: ' added' },
			])),
			'# Note\nEdited while waiting',
		);

		await expect(coordinator.submit(makeEditSubmission())).rejects.toThrow(
			'The note changed while Emend was responding. No edits were applied.',
		);

		expect(writer.write).not.toHaveBeenCalled();
	});

	it('does not write when aborted while the post-stream read is pending', async () => {
		const { coordinator, writer } = makeEditCoordinator(
			editRequest(JSON.stringify([
				{ type: 'replace', target: 'Original', replacement: 'Edited' },
			])),
		);
		const controller = new AbortController();
		let finishRead!: (text: string) => void;
		let markReadStarted!: () => void;
		const readStarted = new Promise<void>((resolve) => {
			markReadStarted = resolve;
		});
		writer.readCurrentText = vi.fn(() => {
			markReadStarted();
			return new Promise<string>((resolve) => {
				finishRead = resolve;
			});
		});

		const submission = makeEditSubmission({ signal: controller.signal });
		const pending = coordinator.submit(submission);
		await readStarted;
		controller.abort();
		finishRead(submission.context.sourceText);

		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		expect(writer.write).not.toHaveBeenCalled();
	});
});


describe('ReadOnlyRequestCoordinator web routing', () => {
	it.each(['review', 'auto'] as const)('routes %s submissions through the web coordinator with captured options', async (mode) => {
		const ordinaryRequest = successfulRequest();
		const webSubmit = vi.fn(async (
			request: AiProviderRequest,
			options: WebSearchRunOptions,
		): Promise<WebToolLoopResult> => {
			options.callbacks.onEvent({ type: 'content', text: 'Web answer' });
			return {
				content: 'Web answer',
				reasoning: '',
				sources: [{ id: 'S1', title: 'Source', url: 'https://example.test/source' }],
				rounds: [{
					request,
					result: {
						content: 'Web answer',
						reasoning: '',
						usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
					},
				}],
			};
		});
		const coordinator = new ReadOnlyRequestCoordinator({
			provider,
			loadAdditionalNotes: makeAdditionalNotesLoader(),
			loadInstructions: async () => ({ skillTexts: new Map() }),
			request: ordinaryRequest,
			webSearch: { submit: webSubmit },
		});
		const reviewCalls = vi.fn(async (
			calls: Parameters<WebSearchRunOptions['reviewCalls']>[0],
		) => calls);
		const onActivity = vi.fn();

		const result = await coordinator.submit(makeSubmission({
			webSearch: { mode, maxToolCalls: 7, reviewCalls, onActivity },
		}));

		expect(ordinaryRequest).not.toHaveBeenCalled();
		expect(webSubmit).toHaveBeenCalledOnce();
		expect(webSubmit.mock.calls[0]?.[1]).toMatchObject({ mode, maxToolCalls: 7, reviewCalls, onActivity });
		expect(result.content).toBe('Web answer');
		expect(result.sources).toEqual([{ id: 'S1', title: 'Source', url: 'https://example.test/source' }]);
		expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 2, totalTokens: 12, source: 'provider' });
	});

	it('does not silently use ordinary chat when web support is unavailable', async () => {
		const ordinaryRequest = successfulRequest();
		const coordinator = new ReadOnlyRequestCoordinator({
			provider,
			loadAdditionalNotes: makeAdditionalNotesLoader(),
			loadInstructions: async () => ({ skillTexts: new Map() }),
			request: ordinaryRequest,
		});

		await expect(coordinator.submit(makeSubmission({
			webSearch: {
				mode: 'auto',
				maxToolCalls: 8,
				reviewCalls: async (calls) => calls,
				onActivity: vi.fn(),
			},
		}))).rejects.toThrow('Online search is not available');
		expect(ordinaryRequest).not.toHaveBeenCalled();
	});
});
