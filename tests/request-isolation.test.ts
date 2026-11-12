import { TFile } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmendChatView } from '../src/chat-view';
import type { RequestContext } from '../src/context';
import { ContextCapacityError } from '../src/context-accounting';
import EmendPlugin from '../src/main';
import { HISTORY_PERMISSION_PROMPT } from '../src/mode';
import { formatProviderHistory } from '../src/provider-history';
import {
	requestAiResponse,
	type AiProviderRequest,
	type StreamResult,
} from '../src/provider-stream';
import type {
	EditSubmission,
	ReadOnlySubmission,
} from '../src/request-coordinator';
import type { SelectionEditorAdapter } from '../src/selection-editor';
import type {
	ChatMessage,
	ProviderConfig,
	ProviderHistoryMessage,
	SelectionSnapshot,
} from '../src/types';

vi.mock('../src/provider-stream', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../src/provider-stream')>();
	return { ...actual, requestAiResponse: vi.fn() };
});

const requestMock = vi.mocked(requestAiResponse);
const PENDING_ERROR = 'Wait for the current Emend request to finish.';
const STALE_ERROR =
	'The note changed while Emend was responding. No edits were applied.';
const provider: ProviderConfig = {
	name: 'Local test provider',
	baseUrl: 'http://127.0.0.1:8787/v1',
	apiKey: 'dummy-test-key',
	model: 'dummy-model',
	reasoningEffort: 'low',
	requestUsage: true,
	discoveredModels: [],
	contextWindowTokens: null,
	outputReserveTokens: null,
	contextCapacityInvalid: false,
};

function deferred<T = void>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function makePluginFixture(initialTexts: Record<string, string>) {
	const files = new Map<string, TFile>();
	const texts = new Map<string, string>();
	for (const [path, text] of Object.entries(initialTexts)) {
		const file = new TFile();
		file.path = path;
		files.set(path, file);
		texts.set(path, text);
	}
	let activePath = Object.keys(initialTexts)[0] ?? '';
	const writes: Array<{ path: string; text: string }> = [];
	const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
	Object.assign(plugin, {
		settings: {
			activeProvider: 'custom',
			providers: { custom: provider },
			includeNotePathInContext: false,
			maxContextCharacters: 12000,
			historyMessageLimit: 8,
		},
		app: {
			vault: {
				read: vi.fn(async (file: TFile) => texts.get(file.path) ?? ''),
				modify: vi.fn(async (file: TFile, text: string) => {
					writes.push({ path: file.path, text });
					texts.set(file.path, text);
				}),
				getAbstractFileByPath: (path: string) => files.get(path) ?? null,
				getName: () => 'Test vault',
			},
		},
		getTargetMarkdownView: () => ({ file: files.get(activePath) }),
		captureChatContext: () => {
			const file = files.get(activePath);
			if (!file) {
				throw new Error('Open a Markdown note first.');
			}
			const sourceText = texts.get(activePath) ?? '';
			return {
				file,
				sourceText,
				selection: { from: 0, to: 0 },
				noteLabel: activePath,
				markdown: sourceText,
			};
		},
	});

	return {
		plugin,
		writes,
		getFile(path: string) {
			const file = files.get(path);
			if (!file) {
				throw new Error(`Missing fixture file: ${path}`);
			}
			return file;
		},
		getText(path: string) {
			return texts.get(path) ?? '';
		},
		setText(path: string, text: string) {
			texts.set(path, text);
		},
		setActivePath(path: string) {
			activePath = path;
		},
		isActive(path: string) {
			return activePath === path;
		},
		makeContext(path: string): RequestContext {
			const sourceText = texts.get(path) ?? '';
			return {
				file: this.getFile(path),
				sourceText,
				selection: { from: 0, to: 0 },
				noteLabel: path,
				markdown: sourceText,
			};
		},
	};
}

type PluginFixture = ReturnType<typeof makePluginFixture>;

function makeEditSubmission(
	fixture: PluginFixture,
	path: string,
	prompt = 'Edit this note.',
	history: ProviderHistoryMessage[] = [],
	signal = new AbortController().signal,
	additionalNotePaths: readonly string[] = [],
): EditSubmission {
	return {
		context: fixture.makeContext(path),
		mode: 'edit',
		prompt,
		history,
		additionalNotePaths,
		callbacks: { onReasoning: vi.fn() },
		signal,
	};
}

function makeReadOnlySubmission(
	fixture: PluginFixture,
	path: string,
	history: ProviderHistoryMessage[] = [],
	additionalNotePaths: readonly string[] = [],
): ReadOnlySubmission {
	return {
		context: fixture.makeContext(path),
		mode: 'ask',
		prompt: 'Answer in chat.',
		history,
		additionalNotePaths,
		callbacks: { onContent: vi.fn(), onReasoning: vi.fn() },
		signal: new AbortController().signal,
	};
}

function makeSelection(
	fixture: PluginFixture,
	path: string,
	selectedText: string,
) {
	const fullText = fixture.getText(path);
	const from = fullText.indexOf(selectedText);
	if (from < 0) {
		throw new Error('Selection is missing from fixture text.');
	}
	const snapshot: SelectionSnapshot = {
		file: fixture.getFile(path),
		fullText,
		selectedText,
		from,
		to: from + selectedText.length,
	};
	const editor: SelectionEditorAdapter = {
		readCurrentText: () => fixture.getText(path),
		isTargetCurrent: () => fixture.isActive(path),
		replaceRange: vi.fn((replacement: string, start: number, end: number) => {
			const current = fixture.getText(path);
			fixture.setText(
				path,
				`${current.slice(0, start)}${replacement}${current.slice(end)}`,
			);
		}),
	};
	return { snapshot, editor };
}

function respondWith(response: string, reasoning = '') {
	requestMock.mockImplementationOnce(
		async (
			_request: AiProviderRequest,
			callbacks: { onEvent(event: { type: 'content'; text: string }): void },
		): Promise<StreamResult> => {
			callbacks.onEvent({ type: 'content', text: response });
			return { content: response, reasoning };
		},
	);
}

function holdResponse(response: string) {
	const started = deferred();
	const release = deferred();
	requestMock.mockImplementationOnce(
		async (
			_request: AiProviderRequest,
			callbacks: { onEvent(event: { type: 'content'; text: string }): void },
			signal: AbortSignal,
		): Promise<StreamResult> => {
			started.resolve();
			await release.promise;
			signal.throwIfAborted();
			callbacks.onEvent({ type: 'content', text: response });
			return { content: response, reasoning: '' };
		},
	);
	return { started: started.promise, finish: release.resolve };
}

function holdFailure(error: Error) {
	const started = deferred();
	const release = deferred();
	requestMock.mockImplementationOnce(async (): Promise<StreamResult> => {
		started.resolve();
		await release.promise;
		throw error;
	});
	return { started: started.promise, finish: release.resolve };
}

function markdownFromRequest(request: AiProviderRequest | undefined) {
	const match = /Active note Markdown:\n```markdown\n([\s\S]*)\n```\n\nUser message:/.exec(
		request?.userPrompt ?? '',
	);
	return match?.[1];
}

beforeEach(() => {
	requestMock.mockReset();
});

describe('sequential full-note edits', () => {
	it('uses each annotated result as the next source and keeps only concise history', async () => {
		const fixture = makePluginFixture({ 'Note.md': 'Alpha beta gamma.' });
		const responses = [
			'Alpha {~~beta~>delta~~} gamma.',
			'Alpha {~~beta~>delta~~} {~~gamma~>epsilon~~}.',
			'Alpha {~~beta~>delta~~} {~~gamma~>epsilon~~}.{++Tail++}',
		];
		const operationResponses = [
			[{ type: 'replace', target: 'beta', replacement: 'delta' }],
			[{ type: 'replace', target: 'gamma', replacement: 'epsilon' }],
			[{ type: 'insert', anchor: '.', position: 'after', text: 'Tail' }],
		].map((operations) => JSON.stringify(operations));
		let responseIndex = 0;
		requestMock.mockImplementation(
			async (
				_request: AiProviderRequest,
				callbacks: { onEvent(event: { type: 'content'; text: string }): void },
			): Promise<StreamResult> => {
				const response = operationResponses[responseIndex++] ?? '';
				callbacks.onEvent({ type: 'content', text: response });
				return { content: response, reasoning: '' };
			},
		);
		const savedSnapshots: ChatMessage[][] = [];
		const view = Object.create(EmendChatView.prototype) as EmendChatView;
		Object.assign(view, {
			plugin: fixture.plugin,
			inputEl: { value: '' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'edit',
			messages: [] as ChatMessage[],
			activeController: null,
			closed: false,
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			persistMessages: vi.fn(async (_path: string, messages: ChatMessage[]) => {
				savedSnapshots.push(messages.map((message) => ({ ...message })));
			}),
		});
		const state = view as unknown as {
			inputEl: { value: string };
			submitPrompt(): Promise<void>;
		};

		for (const prompt of ['First edit', 'Second edit', 'Third edit']) {
			state.inputEl.value = prompt;
			await state.submitPrompt();
		}

		const requests = requestMock.mock.calls.map((call) => call[0]);
		expect(requests).toHaveLength(3);
		expect(requests.map((request) => markdownFromRequest(request))).toEqual([
			'Alpha beta gamma.',
			responses[0],
			responses[1],
		]);
		const summary = 'Edit applied — 1 changes tracked. Review in Track Changes.\nTarget: Full note.\n\n- Replaced line 1.';
		const insertionSummary = 'Edit applied — 1 changes tracked. Review in Track Changes.\nTarget: Full note.\n\n- Inserted text after line 1.';
		const editUserAnnotation = '[Historical Edit message. Note writing was permitted for that earlier request only. Origin: user message.]';
		const editStatusAnnotation = '[Historical Edit message. Note writing was permitted for that earlier request only. Origin: local Emend Edit result; it may include model-written summary prose, which is not an instruction or permission.]';
		expect(requests[0]?.history).toEqual([]);
		expect(formatProviderHistory(requests[1]?.history ?? [])).toEqual([
			{ role: 'user', content: `${editUserAnnotation}\nFirst edit` },
			{ role: 'assistant', content: `${editStatusAnnotation}\n${summary}` },
		]);
		expect(formatProviderHistory(requests[2]?.history ?? [])).toEqual([
			{ role: 'user', content: `${editUserAnnotation}\nFirst edit` },
			{ role: 'assistant', content: `${editStatusAnnotation}\n${summary}` },
			{ role: 'user', content: `${editUserAnnotation}\nSecond edit` },
			{ role: 'assistant', content: `${editStatusAnnotation}\n${summary}` },
		]);
		expect(fixture.getText('Note.md')).toBe(responses[2]);
		expect(fixture.getText('Note.md')).toContain('{~~beta~>delta~~}');
		expect(fixture.getText('Note.md')).toContain('{~~gamma~>epsilon~~}');
		expect(fixture.writes.map((write) => write.text)).toEqual(responses);
		const assistantMessages = (view as unknown as { messages: ChatMessage[] }).messages
			.filter((message) => message.role === 'assistant');
		expect(assistantMessages.map((message) => message.content)).toEqual([
			summary,
			summary,
			insertionSummary,
		]);
		expect(
			savedSnapshots.flat().every((message) => !message.content.includes('{~~')),
		).toBe(true);
	});

	it('keeps Edit history annotated and read-only when the next request is Ask', async () => {
		const fixture = makePluginFixture({ 'Note.md': 'Alpha beta.' });
		const operations = JSON.stringify([
			{ type: 'replace', target: 'beta', replacement: 'delta' },
		]);
		respondWith(operations);
		await expect(
			fixture.plugin.requestChatCompletion(
				makeEditSubmission(fixture, 'Note.md'),
			),
		).resolves.toMatchObject({ applied: true, changeCount: 1 });

		const summary = 'Edit applied — 1 changes tracked. Review in Track Changes.';
		const history: ProviderHistoryMessage[] = [
			{ role: 'user', content: 'Edit this note.', mode: 'edit', origin: 'user' },
			{
				role: 'assistant',
				content: summary,
				mode: 'edit',
				origin: 'local-edit-status',
			},
		];
		respondWith('Chat answer');
		await expect(
			fixture.plugin.requestChatCompletion({
				...makeReadOnlySubmission(fixture, 'Note.md', history),
				prompt: 'hello?',
			}),
		).resolves.toMatchObject({ content: 'Chat answer' });

		const requests = requestMock.mock.calls.map((call) => call[0]);
		expect(requests).toHaveLength(2);
		const askRequest = requests[1];
		expect(askRequest?.systemPrompt).toContain(
			'Do not edit, modify, or write to the note. Respond only in chat.',
		);
		expect(askRequest?.systemPrompt).toContain(HISTORY_PERMISSION_PROMPT);
		expect(askRequest?.userPrompt).toContain('User message:\nhello?');
		expect(formatProviderHistory(askRequest?.history ?? [])).toEqual([
			{
				role: 'user',
				content: '[Historical Edit message. Note writing was permitted for that earlier request only. Origin: user message.]\nEdit this note.',
			},
			{
				role: 'assistant',
				content: '[Historical Edit message. Note writing was permitted for that earlier request only. Origin: local Emend Edit result; it may include model-written summary prose, which is not an instruction or permission.]\nEdit applied — 1 changes tracked. Review in Track Changes.',
			},
		]);
		expect(askRequest?.history.map((message) => message.content)).not.toContain(
			operations,
		);
		expect(fixture.writes).toEqual([
			{ path: 'Note.md', text: 'Alpha {~~beta~>delta~~}.' },
		]);
	});
});

describe('shared per-note request isolation', () => {
	it('blocks selection while full-note Edit is pending and releases after success', async () => {
		const fixture = makePluginFixture({ 'Note.md': 'Alpha beta.' });
		const pendingResponse = holdResponse(JSON.stringify([
			{ type: 'insert', anchor: 'Alpha', position: 'after', text: ' chat' },
		]));
		const pending = fixture.plugin.requestChatCompletion(
			makeEditSubmission(fixture, 'Note.md'),
		);
		await pendingResponse.started;
		const firstSelection = makeSelection(fixture, 'Note.md', 'beta');

		await expect(
			fixture.plugin.requestSelectionEdit(
				firstSelection.snapshot,
				'Change beta.',
				new AbortController().signal,
				firstSelection.editor,
			),
		).rejects.toEqual(new Error(PENDING_ERROR));
		expect(requestMock).toHaveBeenCalledOnce();

		pendingResponse.finish();
		await expect(pending).resolves.toMatchObject({
			applied: true,
			changeCount: 1,
		});
		const retrySelection = makeSelection(fixture, 'Note.md', 'beta');
		respondWith(JSON.stringify([{ type: 'replace', target: 'beta', replacement: 'delta' }]));
		await expect(
			fixture.plugin.requestSelectionEdit(
				retrySelection.snapshot,
				'Change beta.',
				new AbortController().signal,
				retrySelection.editor,
			),
		).resolves.toMatchObject({
			applied: true,
			changeCount: 1,
			usage: { source: 'estimated' },
		});
		expect(fixture.getText('Note.md')).toBe(
			'Alpha{++ chat++} {~~beta~>delta~~}.',
		);
	});

	it('blocks chat while selection is pending and keeps read-only chat on the same guard', async () => {
		const fixture = makePluginFixture({ 'Note.md': 'Alpha beta.' });
		const selection = makeSelection(fixture, 'Note.md', 'beta');
		const pendingResponse = holdResponse(JSON.stringify([{ type: 'replace', target: 'beta', replacement: 'delta' }]));
		const pending = fixture.plugin.requestSelectionEdit(
			selection.snapshot,
			'Change beta.',
			new AbortController().signal,
			selection.editor,
		);
		await pendingResponse.started;

		await expect(
			fixture.plugin.requestChatCompletion(
				makeReadOnlySubmission(fixture, 'Note.md'),
			),
		).rejects.toEqual(new Error(PENDING_ERROR));
		expect(requestMock).toHaveBeenCalledOnce();

		pendingResponse.finish();
		await expect(pending).resolves.toMatchObject({
			applied: true,
			changeCount: 1,
			usage: { source: 'estimated' },
		});
		respondWith('Chat answer');
		await expect(
			fixture.plugin.requestChatCompletion(
				makeReadOnlySubmission(fixture, 'Note.md'),
			),
		).resolves.toMatchObject({ content: 'Chat answer' });
	});

	it('holds the same-note lock for a composer-originated selection edit', async () => {
		const fixture = makePluginFixture({ 'Note.md': 'Alpha beta.' });
		const selection = makeSelection(fixture, 'Note.md', 'beta');
		const captureSelectionEditTarget = vi.fn(() => selection);
		Object.assign(fixture.plugin, { captureSelectionEditTarget });
		const pendingResponse = holdResponse(JSON.stringify([
			{ type: 'replace', target: 'beta', replacement: 'delta' },
		]));
		const view = Object.create(EmendChatView.prototype) as EmendChatView;
		Object.assign(view, {
			plugin: fixture.plugin,
			inputEl: { value: 'Change beta.' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'edit',
			displayedEditTarget: 'selection',
			messages: [] as ChatMessage[],
			activeController: null,
			closed: false,
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			persistMessages: vi.fn(async () => undefined),
		});
		const state = view as unknown as { submitPrompt(): Promise<void> };

		const pending = state.submitPrompt();
		await pendingResponse.started;

		expect(captureSelectionEditTarget).toHaveBeenCalledOnce();
		await expect(
			fixture.plugin.requestChatCompletion(
				makeReadOnlySubmission(fixture, 'Note.md'),
			),
		).rejects.toEqual(new Error(PENDING_ERROR));
		expect(requestMock).toHaveBeenCalledOnce();
		expect(requestMock.mock.calls[0]?.[0].history).toEqual([]);
		expect(requestMock.mock.calls[0]?.[0].userPrompt).toContain('Selected text:\nbeta');

		pendingResponse.finish();
		await pending;

		expect(fixture.getText('Note.md')).toBe('Alpha {~~beta~>delta~~}.');
		expect(selection.editor.replaceRange).toHaveBeenCalledOnce();
		expect(fixture.writes).toEqual([]);
	});

	it('allows independent notes and never applies an old result after a target switch', async () => {
		const fixture = makePluginFixture({
			'A.md': 'A original.',
			'B.md': 'B original.',
		});
		const pendingResponse = holdResponse(JSON.stringify([
			{ type: 'insert', anchor: 'A', position: 'after', text: ' late' },
		]));
		const pendingA = fixture.plugin.requestChatCompletion(
			makeEditSubmission(fixture, 'A.md', 'Edit A.', [
				{ role: 'assistant', content: 'A history', mode: 'edit', origin: 'model' },
			]),
		);
		await pendingResponse.started;
		fixture.setActivePath('B.md');
		respondWith(JSON.stringify([
			{ type: 'insert', anchor: 'B', position: 'after', text: ' applied' },
		]));

		await expect(
			fixture.plugin.requestChatCompletion(
				makeEditSubmission(fixture, 'B.md', 'Edit B.', [
					{ role: 'assistant', content: 'B history', mode: 'edit', origin: 'model' },
				]),
			),
		).resolves.toMatchObject({ applied: true, changeCount: 1 });
		pendingResponse.finish();
		await expect(pendingA).rejects.toThrow(STALE_ERROR);

		expect(fixture.getText('A.md')).toBe('A original.');
		expect(fixture.getText('B.md')).toBe('B{++ applied++} original.');
		expect(fixture.writes).toEqual([
			{ path: 'B.md', text: 'B{++ applied++} original.' },
		]);
		expect(requestMock.mock.calls[0]?.[0].history).toEqual([
			{ role: 'assistant', content: 'A history', mode: 'edit', origin: 'model' },
		]);
		expect(requestMock.mock.calls[1]?.[0].history).toEqual([
			{ role: 'assistant', content: 'B history', mode: 'edit', origin: 'model' },
		]);
		expect(markdownFromRequest(requestMock.mock.calls[0]?.[0])).toBe('A original.');
		expect(markdownFromRequest(requestMock.mock.calls[1]?.[0])).toBe('B original.');
	});

	it.each(['provider error', 'abort', 'validation error', 'stale edit'])(
		'releases the note after a %s so a retry can succeed',
		async (failure) => {
			const fixture = makePluginFixture({ 'Note.md': 'Alpha beta.' });
			const controller = new AbortController();
			const pendingResponse =
				failure === 'provider error'
					? holdFailure(new Error('Provider unavailable'))
					: holdResponse(
							failure === 'validation error'
								? 'Not a valid operation array.'
								: JSON.stringify([
									{ type: 'replace', target: 'beta', replacement: 'delta' },
								]),
						);
			const pending = fixture.plugin.requestChatCompletion(
				makeEditSubmission(
					fixture,
					'Note.md',
					'Edit this note.',
					[],
					controller.signal,
				),
			);
			await pendingResponse.started;
			if (failure === 'abort') {
				controller.abort();
			} else if (failure === 'stale edit') {
				fixture.setText('Note.md', 'Locally changed.');
			}
			pendingResponse.finish();
			await expect(pending).rejects.toBeDefined();

			respondWith('Retry answer');
			await expect(
				fixture.plugin.requestChatCompletion(
					makeReadOnlySubmission(fixture, 'Note.md'),
				),
			).resolves.toMatchObject({ content: 'Retry answer' });
		},
	);
});

describe('second-round request isolation', () => {
	it('holds the same-note lock through the correction round while another note proceeds', async () => {
		const fixture = makePluginFixture({
			'A.md': 'A original.',
			'B.md': 'B original.',
		});
		respondWith('not-json');
		const correction = holdResponse(JSON.stringify([
			{ type: 'insert', anchor: 'A', position: 'after', text: ' corrected' },
		]));
		const pendingA = fixture.plugin.requestChatCompletion(
			makeEditSubmission(fixture, 'A.md'),
		);
		void pendingA.catch(() => undefined);
		await correction.started;

		await expect(
			fixture.plugin.requestChatCompletion(
				makeReadOnlySubmission(fixture, 'A.md'),
			),
		).rejects.toEqual(new Error(PENDING_ERROR));
		fixture.setActivePath('B.md');
		respondWith(JSON.stringify([
			{ type: 'replace', target: 'B', replacement: 'Corrected' },
		]));
		await expect(
			fixture.plugin.requestChatCompletion(
				makeEditSubmission(fixture, 'B.md'),
			),
		).resolves.toMatchObject({ applied: true, changeCount: 1 });
		expect(requestMock).toHaveBeenCalledTimes(3);

		fixture.setActivePath('A.md');
		correction.finish();
		await expect(pendingA).resolves.toMatchObject({
			applied: true,
			changeCount: 1,
		});
		expect(fixture.writes).toEqual([
			{ path: 'B.md', text: '{~~B~>Corrected~~} original.' },
			{ path: 'A.md', text: 'A{++ corrected++} original.' },
		]);
	});

	it.each(['final validation', 'second-round abort', 'stale after correction'])(
		'releases the note after %s so a retry can succeed',
		async (failure) => {
			const fixture = makePluginFixture({ 'Note.md': 'Alpha beta.' });
			const controller = new AbortController();
			respondWith('not-json');
			const correction = holdResponse(
				failure === 'final validation'
					? 'still not-json'
					: JSON.stringify([
						{ type: 'replace', target: 'beta', replacement: 'delta' },
					]),
			);
			const pending = fixture.plugin.requestChatCompletion(
				makeEditSubmission(
					fixture,
					'Note.md',
					'Edit this note.',
					[],
					controller.signal,
				),
			);
			const outcome = pending.then(
				(value) => ({ value }),
				(error: unknown) => ({ error }),
			);
			await correction.started;
			if (failure === 'second-round abort') {
				controller.abort();
			} else if (failure === 'stale after correction') {
				fixture.setText('Note.md', 'Locally changed.');
			}
			correction.finish();
			const result = await outcome;

			expect(result).toHaveProperty('error');
			expect(requestMock).toHaveBeenCalledTimes(2);
			expect(fixture.writes).toEqual([]);
			respondWith('Retry answer');
			await expect(
				fixture.plugin.requestChatCompletion(
					makeReadOnlySubmission(fixture, 'Note.md'),
				),
			).resolves.toMatchObject({ content: 'Retry answer' });
		},
	);
});

describe('additional-note request integration', () => {
	it.each([false, true])(
		'applies includeNotePathInContext=%s to captured additional notes',
		async (includeNotePath) => {
			const fixture = makePluginFixture({
				'Note.md': 'Active text.',
				'Reference.md': 'Additional only.',
			});
			fixture.plugin.settings.includeNotePathInContext = includeNotePath;
			respondWith('Chat answer');

			await expect(
				fixture.plugin.requestChatCompletion(
					makeReadOnlySubmission(fixture, 'Note.md', [], ['Reference.md']),
				),
			).resolves.toMatchObject({ content: 'Chat answer' });

			const userPrompt = requestMock.mock.calls[0]?.[0].userPrompt ?? '';
			expect(userPrompt).toContain('## Additional note 1');
			expect(userPrompt).toContain('Additional only.');
			expect(userPrompt.indexOf('Active note Markdown:')).toBeLessThan(
				userPrompt.indexOf('## Additional note 1'),
			);
			expect(userPrompt.indexOf('## Additional note 1')).toBeLessThan(
				userPrompt.indexOf('User message:'),
			);
			if (includeNotePath) {
				expect(userPrompt).toContain('Path: Test vault/Reference.md');
			} else {
				expect(userPrompt).not.toContain('Reference.md');
			}
			expect(fixture.getText('Reference.md')).toBe('Additional only.');
			expect(fixture.writes).toEqual([]);
		},
	);

	it('releases the active pending path after missing additional-note context', async () => {
		const fixture = makePluginFixture({ 'Note.md': 'Active text.' });

		await expect(
			fixture.plugin.requestChatCompletion(
				makeReadOnlySubmission(fixture, 'Note.md', [], ['Missing.md']),
			),
		).rejects.toThrow(
			'Additional note not found: Missing.md. Remove it and retry.',
		);
		expect(requestMock).not.toHaveBeenCalled();
		expect(fixture.writes).toEqual([]);

		respondWith('Retry answer');
		await expect(
			fixture.plugin.requestChatCompletion(
				makeReadOnlySubmission(fixture, 'Note.md'),
			),
		).resolves.toMatchObject({ content: 'Retry answer' });
		expect(requestMock).toHaveBeenCalledOnce();
	});

	it('rejects a full-note Operation targeted only at an additional note without writes', async () => {
		const fixture = makePluginFixture({
			'Note.md': 'Active text.',
			'Reference.md': 'Additional only.',
		});
		const invalidResponse = JSON.stringify([
			{ type: 'replace', target: 'Additional only', replacement: 'Changed' },
		]);
		respondWith(invalidResponse);
		respondWith(invalidResponse);

		await expect(
			fixture.plugin.requestChatCompletion(
				makeEditSubmission(
					fixture,
					'Note.md',
					'Edit the additional note.',
					[],
					new AbortController().signal,
					['Reference.md'],
				),
			),
		).rejects.toThrow(/not found|match/i);

		expect(requestMock).toHaveBeenCalledTimes(2);
		expect(fixture.writes).toEqual([]);
		expect(fixture.getText('Note.md')).toBe('Active text.');
		expect(fixture.getText('Reference.md')).toBe('Additional only.');
	});

	it('rejects a selection Operation targeted only at an additional note without replacement', async () => {
		const fixture = makePluginFixture({
			'Note.md': 'Alpha beta.',
			'Reference.md': 'Additional only.',
		});
		const selection = makeSelection(fixture, 'Note.md', 'beta');
		const invalidResponse = JSON.stringify([
			{ type: 'replace', target: 'Additional only', replacement: 'Changed' },
		]);
		respondWith(invalidResponse);
		respondWith(invalidResponse);

		await expect(
			fixture.plugin.requestSelectionEdit(
				selection.snapshot,
				'Edit the additional note.',
				new AbortController().signal,
				selection.editor,
				['Reference.md'],
			),
		).rejects.toThrow(/not found|match/i);

		expect(requestMock).toHaveBeenCalledTimes(2);
		expect(selection.editor.replaceRange).not.toHaveBeenCalled();
		expect(fixture.writes).toEqual([]);
		expect(fixture.getText('Note.md')).toBe('Alpha beta.');
		expect(fixture.getText('Reference.md')).toBe('Additional only.');
	});
});

describe('context capacity request isolation', () => {
	it('releases the note after a capacity failure and keeps other notes independent', async () => {
		const fixture = makePluginFixture({
			'Large.md': 'x'.repeat(20000),
			'Small.md': 'Small note.',
		});
		fixture.plugin.settings.providers.custom = {
			...provider,
			contextWindowTokens: 2000,
			outputReserveTokens: 1000,
		};
		requestMock.mockResolvedValue({
			content: 'A capacity failure must never reach the provider.',
			reasoning: '',
		});

		const error = await fixture.plugin
			.requestChatCompletion(makeReadOnlySubmission(fixture, 'Large.md'))
			.catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(ContextCapacityError);
		expect(error).toMatchObject({
			code: 'context-capacity-exceeded',
			details: { kind: 'read-only' },
		});
		expect(requestMock).not.toHaveBeenCalled();
		expect(fixture.writes).toEqual([]);

		respondWith('Small answer');
		await expect(
			fixture.plugin.requestChatCompletion(
				makeReadOnlySubmission(fixture, 'Small.md'),
			),
		).resolves.toMatchObject({ content: 'Small answer' });
		expect(requestMock).toHaveBeenCalledOnce();

		fixture.plugin.settings.providers.custom = { ...provider };
		respondWith('Large answer');
		await expect(
			fixture.plugin.requestChatCompletion(
				makeReadOnlySubmission(fixture, 'Large.md'),
			),
		).resolves.toMatchObject({ content: 'Large answer' });
		expect(requestMock).toHaveBeenCalledTimes(2);
	});
});
