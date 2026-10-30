import { TFile } from 'obsidian';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type {
	AiProviderRequest,
	StreamEvent,
	StreamResult,
} from '../src/provider-stream';
import {
	EditRequestCoordinator,
	ReadOnlyRequestCoordinator,
	type EditSubmission,
	type ReadOnlySubmission,
} from '../src/request-coordinator';
import type { RequestContext } from '../src/context';
import type { NoteWriter } from '../src/note-writer';
import type {
	InstructionPromptParts,
	ProviderConfig,
	ProviderHistoryMessage,
} from '../src/types';

const provider: ProviderConfig = {
	name: 'Local test provider',
	baseUrl: 'http://127.0.0.1:8787/v1',
	apiKey: 'dummy-test-key',
	model: 'dummy-model',
	reasoningEffort: 'low',
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

function makeCoordinator(
	request = successfulRequest(),
	instructions: InstructionPromptParts = { skillTexts: new Map() },
) {
	const loadInstructions = vi.fn(async () => instructions);
	const coordinator = new ReadOnlyRequestCoordinator({
		provider,
		loadInstructions,
		request,
	});
	return { coordinator, loadInstructions, request };
}

function makeSubmission(
	overrides: Partial<ReadOnlySubmission> = {},
): ReadOnlySubmission {
	return {
		context: makeContext(),
		mode: 'ask',
		prompt: 'What does this note say?',
		history: [],
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
			}),
		);

		await coordinator.submit(makeSubmission({ history }));

		expect(request.mock.calls[0]?.[0].history).toEqual(history.slice(-8));
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
	const coordinator = new EditRequestCoordinator({
		provider,
		loadInstructions,
		request,
		writer,
	});
	return { coordinator, loadInstructions, request, writer };
}

function makeEditSubmission(
	overrides: Partial<EditSubmission> = {},
): EditSubmission {
	return {
		context: makeContext(),
		mode: 'edit',
		prompt: 'Improve this note.',
		history: [],
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
			editRequest(sourceText),
			sourceText,
		);

		await coordinator.submit(makeEditSubmission({ context }));

		const userPrompt = request.mock.calls[0]?.[0].userPrompt ?? '';
		expect(userPrompt).toContain(sourceText);
		expect(userPrompt).not.toContain('bounded window');
		expect(userPrompt).not.toContain('[...]');
		expect(request.mock.calls[0]?.[0].systemPrompt).toContain(
			'Return the COMPLETE note',
		);
	});

	it('streams reasoning while buffering the edit privately and writes after completion', async () => {
		const response = '# Note\n{~~Original~>Edited~~} text';
		const request = editRequest(response);
		const { coordinator, writer } = makeEditCoordinator(request);
		const submission = makeEditSubmission();

		const result = await coordinator.submit(submission);

		expect(result).toEqual({ applied: true, changeCount: 1 });
		expect(submission.callbacks.onReasoning).toHaveBeenCalledExactlyOnceWith(
			'Editing the complete note.',
		);
		expect(writer.write).toHaveBeenCalledExactlyOnceWith(
			submission.context.file,
			response,
		);
		expect(request.mock.invocationCallOrder[0]).toBeLessThan(
			(writer.write as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ??
				0,
		);
	});

	it('returns an unchanged result and performs no write for a no-op', async () => {
		const sourceText = '# Note\nOriginal text';
		const { coordinator, writer } = makeEditCoordinator(
			editRequest(sourceText),
			sourceText,
		);

		const result = await coordinator.submit(makeEditSubmission());

		expect(result).toEqual({ applied: false, changeCount: 0 });
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
			editRequest('# Note\nOriginal{++ added++} text'),
			'# Note\nEdited while waiting',
		);

		await expect(coordinator.submit(makeEditSubmission())).rejects.toThrow(
			'The note changed while Emend was responding. No edits were applied.',
		);

		expect(writer.write).not.toHaveBeenCalled();
	});

	it('does not write when aborted while the post-stream read is pending', async () => {
		const { coordinator, writer } = makeEditCoordinator(
			editRequest('# Note\n{~~Original~>Edited~~} text'),
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
