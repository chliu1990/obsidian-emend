import { TFile } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmendChatView } from '../src/chat-view';
import type { RequestContext } from '../src/context';
import EmendPlugin from '../src/main';
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
		},
		app: {
			vault: {
				read: vi.fn(async (file: TFile) => texts.get(file.path) ?? ''),
				modify: vi.fn(async (file: TFile, text: string) => {
					writes.push({ path: file.path, text });
					texts.set(file.path, text);
				}),
				getAbstractFileByPath: () => null,
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
): EditSubmission {
	return {
		context: fixture.makeContext(path),
		mode: 'edit',
		prompt,
		history,
		callbacks: { onReasoning: vi.fn() },
		signal,
	};
}

function makeReadOnlySubmission(
	fixture: PluginFixture,
	path: string,
	history: ProviderHistoryMessage[] = [],
): ReadOnlySubmission {
	return {
		context: fixture.makeContext(path),
		mode: 'ask',
		prompt: 'Answer in chat.',
		history,
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
		const summary = 'Edit applied — 1 changes tracked. Review in Track Changes.';
		expect(requests[0]?.history).toEqual([]);
		expect(requests[1]?.history).toEqual([
			{ role: 'user', content: 'First edit' },
			{ role: 'assistant', content: summary },
		]);
		expect(requests[2]?.history).toEqual([
			{ role: 'user', content: 'First edit' },
			{ role: 'assistant', content: summary },
			{ role: 'user', content: 'Second edit' },
			{ role: 'assistant', content: summary },
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
			summary,
		]);
		expect(
			savedSnapshots.flat().every((message) => !message.content.includes('{~~')),
		).toBe(true);
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
		).resolves.toEqual({ applied: true, changeCount: 1 });
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
		await expect(pending).resolves.toEqual({ applied: true, changeCount: 1 });
		respondWith('Chat answer');
		await expect(
			fixture.plugin.requestChatCompletion(
				makeReadOnlySubmission(fixture, 'Note.md'),
			),
		).resolves.toMatchObject({ content: 'Chat answer' });
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
				{ role: 'assistant', content: 'A history' },
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
					{ role: 'assistant', content: 'B history' },
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
			{ role: 'assistant', content: 'A history' },
		]);
		expect(requestMock.mock.calls[1]?.[0].history).toEqual([
			{ role: 'assistant', content: 'B history' },
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
