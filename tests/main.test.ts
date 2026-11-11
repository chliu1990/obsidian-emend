import { MarkdownView, TFile } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmendChatView } from '../src/chat-view';
import type { ConversationDataAdapter } from '../src/conversation-store';
import EmendPlugin from '../src/main';
import type { ReadOnlySubmission } from '../src/request-coordinator';
import type { SelectionEditorAdapter } from '../src/selection-editor';
import { DEFAULT_SETTINGS } from '../src/settings';
import type {
	ChatMessage,
	EmendSettings,
	ProviderHistoryMessage,
} from '../src/types';

class MemoryAdapter implements ConversationDataAdapter {
	readonly files = new Map<string, string>();
	readonly directories = new Set<string>();
	beforeRead: ((path: string) => Promise<void>) | undefined;

	async exists(path: string) {
		return this.files.has(path) || this.directories.has(path);
	}

	async read(path: string) {
		await this.beforeRead?.(path);
		const contents = this.files.get(path);
		if (contents === undefined) {
			throw new Error(`Missing file: ${path}`);
		}
		return contents;
	}

	async write(path: string, data: string) {
		this.files.set(path, data);
	}

	async mkdir(path: string) {
		this.directories.add(path);
	}

	async remove(path: string) {
		this.files.delete(path);
	}

	async rename(oldPath: string, newPath: string) {
		const contents = this.files.get(oldPath);
		if (contents === undefined || this.files.has(newPath)) {
			throw new Error('Rename failed.');
		}
		this.files.delete(oldPath);
		this.files.set(newPath, contents);
	}

	async process(path: string, update: (data: string) => string) {
		const contents = update(this.files.get(path) ?? '');
		this.files.set(path, contents);
		return contents;
	}

	async copy(oldPath: string, newPath: string) {
		const contents = this.files.get(oldPath);
		if (contents === undefined) {
			throw new Error('Copy failed.');
		}
		this.files.set(newPath, contents);
	}
}

function message(id: string, notePath: string): ChatMessage {
	return {
		id,
		role: 'assistant',
		content: `${id} content`,
		reasoning: '',
		mode: 'ask',
		sourcePath: notePath,
		status: 'ready',
		timestamp: 1,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

async function waitFor(condition: () => boolean) {
	for (let attempt = 0; attempt < 50; attempt++) {
		if (condition()) {
			return;
		}
		// eslint-disable-next-line obsidianmd/prefer-window-timers -- Vitest runs in Node without a window.
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error('Condition did not become true.');
}

describe('EmendPlugin workspace conversation events', () => {
	it('loads B on same-leaf file-open without leaking or winning stale A state', async () => {
		const adapter = new MemoryAdapter();
		const handlers = new Map<string, () => void>();
		const requestChatCompletion = vi.fn(
			async (submission: ReadOnlySubmission) => {
				submission.callbacks.onContent('B streamed answer');
				return { content: 'B streamed answer', reasoning: '' };
			},
		);
		let activeNotePath = 'A.md';
		const leaf: { view?: EmendChatView } = {};
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(plugin, {
			app: {
				vault: { adapter, configDir: '.test-config', on: () => ({}) },
				workspace: {
					on: (event: string, handler: () => void) => {
						handlers.set(event, handler);
						return {};
					},
					getLeavesOfType: () => [leaf],
				},
			},
			loadSettings: vi.fn().mockResolvedValue(undefined),
			registerView: vi.fn(),
			registerEvent: vi.fn(),
			rememberActiveMarkdownView: vi.fn(),
			addRibbonIcon: vi.fn(),
			addCommand: vi.fn(),
			addSettingTab: vi.fn(),
			getActiveNotePath: () => activeNotePath,
			captureChatContext: () => ({ file: { path: activeNotePath } }),
			requestChatCompletion,
			settings: structuredClone(DEFAULT_SETTINGS),
		});
		const view = Object.create(EmendChatView.prototype) as EmendChatView;
		Object.assign(view, {
			plugin,
			notePath: null,
			noteLoadGeneration: 0,
			messages: [] as ChatMessage[],
			selectedMode: 'ask',
			isThreadLoading: false,
			isSending: false,
			activeController: null,
			closed: false,
			inputEl: { value: '' },
			drafts: new Map<string, string>(),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
		});
		leaf.view = view;
		await plugin.onload();
		await plugin.conversationStore.save('A.md', [message('A saved', 'A.md')]);
		await plugin.conversationStore.save('B.md', [message('B saved', 'B.md')]);
		const aPath = Array.from(adapter.files.keys()).find((path) =>
			path.includes('/A-'),
		);
		if (!aPath) {
			throw new Error('A thread path missing.');
		}
		const aReadStarted = deferred<void>();
		const aReadFinished = deferred<void>();
		const releaseARead = deferred<void>();
		let shouldBlockA = true;
		adapter.beforeRead = async (path) => {
			if (path === aPath && shouldBlockA) {
				shouldBlockA = false;
				aReadStarted.resolve();
				await releaseARead.promise;
				aReadFinished.resolve();
			}
		};
		const state = view as unknown as {
			notePath: string | null;
			isThreadLoading: boolean;
			messages: ChatMessage[];
			noteLoadGeneration: number;
			inputEl: { value: string } | null;
		};

		const fileOpen = handlers.get('file-open');
		const activeLeafChange = handlers.get('active-leaf-change');
		expect(fileOpen).toBeDefined();
		expect(fileOpen).toBe(activeLeafChange);
		activeLeafChange?.();
		await aReadStarted.promise;
		expect(state.isThreadLoading).toBe(true);

		activeNotePath = 'B.md';
		fileOpen?.();
		await waitFor(() => state.notePath === 'B.md' && !state.isThreadLoading);
		expect(state.messages.map((item) => item.id)).toEqual(['B saved']);
		releaseARead.resolve();
		await aReadFinished.promise;
		await Promise.resolve();
		expect(state.messages.map((item) => item.id)).toEqual(['B saved']);

		const generation = state.noteLoadGeneration;
		fileOpen?.();
		activeLeafChange?.();
		expect(state.noteLoadGeneration).toBe(generation);

		if (!state.inputEl) {
			throw new Error('Composer missing.');
		}
		state.inputEl.value = 'B prompt';
		await (view as unknown as { submitPrompt(): Promise<void> }).submitPrompt.call(view);

		expect(requestChatCompletion).toHaveBeenCalledOnce();
		const submission = requestChatCompletion.mock.calls[0]?.[0];
		expect(submission?.history).toEqual([
			{ role: 'assistant', content: 'B saved content', mode: 'ask', origin: 'model' },
		]);
		expect(submission?.context.file.path).toBe('B.md');
		const bStored = await plugin.conversationStore.load('B.md');
		expect(bStored.map((item) => item.content)).toEqual([
			'B saved content',
			'B prompt',
			'B streamed answer',
		]);
		expect(bStored.some((item) => item.sourcePath === 'A.md')).toBe(false);
		expect(
			(await plugin.conversationStore.load('A.md')).map((item) => item.id),
		).toEqual(['A saved']);
	});
});

describe('EmendPlugin discovered model cache invalidation', () => {
	it('clears only the updated provider cache and persists sanitized API keys', async () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.providers.deepseek.discoveredModels = [
			{ id: 'deepseek-model', displayName: 'DeepSeek model' },
		];
		settings.providers.kimi.discoveredModels = [
			{ id: 'kimi-model', displayName: 'Kimi model' },
		];
		const setSecret = vi.fn();
		const saveData = vi.fn(async (_data: unknown) => undefined);
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(plugin, {
			settings,
			app: {
				secretStorage: { setSecret, getSecret: vi.fn(() => null) },
				workspace: { getLeavesOfType: () => [] },
			},
			saveData,
		});

		await plugin.setApiKey('deepseek', 'new-key');

		expect(plugin.settings.providers.deepseek.discoveredModels).toEqual([]);
		expect(plugin.settings.providers.kimi.discoveredModels).toEqual([
			{ id: 'kimi-model', displayName: 'Kimi model' },
		]);
		expect(setSecret).toHaveBeenCalledWith('emend-api-key-deepseek', 'new-key');
		expect(saveData).toHaveBeenCalledOnce();
		const persisted = saveData.mock.calls[0]?.[0] as EmendSettings | undefined;
		expect(persisted?.providers.deepseek.apiKey).toBe('');
		expect(persisted?.providers.kimi.apiKey).toBe('');
		expect(persisted?.providers.custom.apiKey).toBe('');
	});
});

describe('EmendPlugin selection capture', () => {
	function makeView(selectedText: string) {
		const file = new TFile();
		file.path = 'Selection.md';
		const fullText = `Before${selectedText}After`;
		const from = 6;
		const to = from + selectedText.length;
		const editor = {
			getSelection: () => selectedText,
			getValue: () => fullText,
			getCursor: (which: 'from' | 'to') => ({
				offset: which === 'from' ? from : to,
			}),
			posToOffset: (position: { offset: number }) => position.offset,
			offsetToPos: (offset: number) => ({ offset }),
			replaceRange: vi.fn(),
		};
		const view = Object.assign(
			Object.create(MarkdownView.prototype) as MarkdownView,
			{ file, editor },
		);
		return { file, fullText, from, to, view };
	}

	it('captures the last open Markdown view when chat has focus', () => {
		const { file, fullText, from, to, view } = makeView('beta');
		const otherView = makeView('other').view;
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(plugin, {
			app: {
				workspace: {
					getActiveViewOfType: () => null,
					iterateAllLeaves: (
						callback: (leaf: { view: MarkdownView }) => void,
					) => {
						callback({ view: otherView });
						callback({ view });
					},
				},
			},
			lastMarkdownView: view,
		});

		const target = plugin.captureSelectionEditTarget();

		expect(target.snapshot).toEqual({
			file,
			fullText,
			selectedText: 'beta',
			from,
			to,
		});
		expect(target.editor.readCurrentText()).toBe(fullText);
		expect(target.editor.isTargetCurrent()).toBe(true);
	});

	it('reports only non-whitespace selections as usable', () => {
		let target: MarkdownView | null = makeView('beta').view;
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(plugin, { getTargetMarkdownView: () => target });

		expect(plugin.hasUsableSelection()).toBe(true);
		target = makeView('').view;
		expect(plugin.hasUsableSelection()).toBe(false);
		target = makeView(' \n\t').view;
		expect(plugin.hasUsableSelection()).toBe(false);
		target = null;
		expect(plugin.hasUsableSelection()).toBe(false);
	});

	it('retains missing-target and selection capture errors', () => {
		let target: MarkdownView | null = null;
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(plugin, { getTargetMarkdownView: () => target });

		expect(() => plugin.captureSelectionEditTarget()).toThrow(
			'Open a Markdown note first.',
		);
		target = makeView(' \n\t').view;
		expect(() => plugin.captureSelectionEditTarget()).toThrow(
			'Select non-whitespace text first.',
		);
		target = makeView('beta').view;
		target.file = null;
		expect(() => plugin.captureSelectionEditTarget()).toThrow(
			'Open a saved Markdown note first.',
		);
	});
});

describe('EmendPlugin mode keyboard commands', () => {
	interface RegisteredCommand {
		id: string;
		hotkeys?: Array<{ modifiers: string[]; key: string }>;
		callback?: () => void;
	}

	async function createCommandHarness() {
		const commands: RegisteredCommand[] = [];
		const setMode = vi.fn();
		const view = Object.create(EmendChatView.prototype) as EmendChatView;
		Object.assign(view, { setMode });
		const leaf = { view };
		const activateChatView = vi.fn().mockResolvedValue(undefined);
		const requestChatCompletion = vi.fn();
		const requestSelectionEdit = vi.fn();
		const modify = vi.fn();
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(plugin, {
			app: {
				vault: {
					adapter: new MemoryAdapter(),
					configDir: '.test-config',
					on: () => ({}),
					modify,
				},
				workspace: {
					on: () => ({}),
					getLeavesOfType: () => [leaf],
				},
			},
			loadSettings: vi.fn().mockResolvedValue(undefined),
			registerView: vi.fn(),
			registerEvent: vi.fn(),
			rememberActiveMarkdownView: vi.fn(),
			addRibbonIcon: vi.fn(),
			addCommand: vi.fn((command: RegisteredCommand) => commands.push(command)),
			addSettingTab: vi.fn(),
			activateChatView,
			requestChatCompletion,
			requestSelectionEdit,
		});
		await plugin.onload();
		return {
			commands,
			setMode,
			activateChatView,
			requestChatCompletion,
			requestSelectionEdit,
			modify,
		};
	}

	it('registers Ask and Edit commands with platform Mod default hotkeys', async () => {
		const { commands } = await createCommandHarness();

		expect(commands.find((command) => command.id === 'emend:switch-to-ask-mode')).toMatchObject({
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'A' }],
		});
		expect(commands.find((command) => command.id === 'emend:switch-to-edit-mode')).toMatchObject({
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'E' }],
		});
	});

	it('opens chat and switches mode without submitting, requesting, or writing', async () => {
		const {
			commands,
			setMode,
			activateChatView,
			requestChatCompletion,
			requestSelectionEdit,
			modify,
		} = await createCommandHarness();

		commands.find((command) => command.id === 'emend:switch-to-ask-mode')?.callback?.();
		commands.find((command) => command.id === 'emend:switch-to-edit-mode')?.callback?.();
		await vi.waitFor(() => expect(setMode).toHaveBeenCalledTimes(2));

		expect(activateChatView).toHaveBeenCalledTimes(2);
		expect(setMode.mock.calls).toEqual([['ask'], ['edit']]);
		expect(requestChatCompletion).not.toHaveBeenCalled();
		expect(requestSelectionEdit).not.toHaveBeenCalled();
		expect(modify).not.toHaveBeenCalled();
	});
});

describe('EmendPlugin additional-note lifecycle', () => {
	it('routes TFile rename and delete events without vault reads or requests', async () => {
		type VaultHandler = (file: unknown, oldPath?: string) => void;
		const handlers = new Map<string, VaultHandler>();
		const renameEvent = {};
		const deleteEvent = {};
		const registerEvent = vi.fn();
		const read = vi.fn();
		const getMarkdownFiles = vi.fn();
		const requestChatCompletion = vi.fn();
		const requestSelectionEdit = vi.fn();
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(plugin, {
			app: {
				vault: {
					adapter: new MemoryAdapter(),
					configDir: '.test-config',
					on: (event: string, handler: VaultHandler) => {
						handlers.set(event, handler);
						return event === 'rename' ? renameEvent : deleteEvent;
					},
					read,
					getMarkdownFiles,
				},
				workspace: {
					on: () => ({}),
					getLeavesOfType: () => [],
				},
			},
			loadSettings: vi.fn().mockResolvedValue(undefined),
			registerView: vi.fn(),
			registerEvent,
			rememberActiveMarkdownView: vi.fn(),
			addRibbonIcon: vi.fn(),
			addCommand: vi.fn(),
			addSettingTab: vi.fn(),
			requestChatCompletion,
			requestSelectionEdit,
		});

		await plugin.onload();
		expect(plugin.additionalNotesStore.list('A.md')).toEqual([]);
		expect(registerEvent).toHaveBeenCalledWith(renameEvent);
		expect(registerEvent).toHaveBeenCalledWith(deleteEvent);
		expect(read).not.toHaveBeenCalled();
		expect(getMarkdownFiles).not.toHaveBeenCalled();
		expect(requestChatCompletion).not.toHaveBeenCalled();
		expect(requestSelectionEdit).not.toHaveBeenCalled();

		plugin.additionalNotesStore.add('A.md', 'B.md');
		plugin.additionalNotesStore.add('B.md', 'C.md');
		handlers.get('rename')?.({ path: 'ignored.md' }, 'A.md');
		expect(plugin.additionalNotesStore.list('A.md')).toEqual(['B.md']);
		expect(plugin.additionalNotesStore.list('B.md')).toEqual(['C.md']);

		const renamedFile = new TFile();
		renamedFile.path = 'D.md';
		handlers.get('rename')?.(renamedFile, 'B.md');
		expect(plugin.additionalNotesStore.list('A.md')).toEqual(['D.md']);
		expect(plugin.additionalNotesStore.list('B.md')).toEqual([]);
		expect(plugin.additionalNotesStore.list('D.md')).toEqual(['C.md']);

		const deletedIncludedFile = new TFile();
		deletedIncludedFile.path = 'C.md';
		handlers.get('delete')?.(deletedIncludedFile);
		expect(plugin.additionalNotesStore.list('A.md')).toEqual(['D.md']);
		expect(plugin.additionalNotesStore.list('D.md')).toEqual([]);

		handlers.get('delete')?.({ path: 'D.md' });
		expect(plugin.additionalNotesStore.list('A.md')).toEqual(['D.md']);
		handlers.get('delete')?.(renamedFile);
		expect(plugin.additionalNotesStore.list('A.md')).toEqual([]);
		expect(plugin.additionalNotesStore.list('D.md')).toEqual([]);

		plugin.additionalNotesStore.add('A.md', 'Ephemeral.md');
		const reloadedPlugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(reloadedPlugin, {
			app: plugin.app,
			loadSettings: vi.fn().mockResolvedValue(undefined),
			registerView: vi.fn(),
			registerEvent: vi.fn(),
			rememberActiveMarkdownView: vi.fn(),
			addRibbonIcon: vi.fn(),
			addCommand: vi.fn(),
			addSettingTab: vi.fn(),
			requestChatCompletion,
			requestSelectionEdit,
		});
		await reloadedPlugin.onload();
		expect(reloadedPlugin.additionalNotesStore).not.toBe(plugin.additionalNotesStore);
		expect(reloadedPlugin.additionalNotesStore.list('A.md')).toEqual([]);

		expect(read).not.toHaveBeenCalled();
		expect(getMarkdownFiles).not.toHaveBeenCalled();
		expect(requestChatCompletion).not.toHaveBeenCalled();
		expect(requestSelectionEdit).not.toHaveBeenCalled();
	});
});


describe('EmendPlugin web provider guard', () => {
	it.each([
		['custom', 'deepseek-flash'],
		['kimi', 'k3.1-pro'],
		['deepseek', 'unsupported-model'],
	] as const)('rejects web mode for %s model %s before any request', async (activeProvider, model) => {
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.activeProvider = activeProvider;
		settings.providers[activeProvider].model = model;
		Object.assign(plugin, { settings });

		await expect(plugin.requestChatCompletion({
			context: { file: { path: 'Note.md' } } as ReadOnlySubmission['context'],
			mode: 'ask',
			prompt: 'Research this',
			history: [],
			callbacks: { onContent: vi.fn(), onReasoning: vi.fn() },
			webSearch: {
				mode: 'auto',
				maxToolCalls: 8,
				maxContentCharactersPerCall: 20000,
				reviewCalls: async (calls) => calls,
				onActivity: vi.fn(),
			},
			signal: new AbortController().signal,
		})).rejects.toThrow('only available for DeepSeek deepseek-flash and deepseek-v4-pro');
	});
});

describe('EmendPlugin Selection history', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('forwards the captured ready history into the Selection provider request', async () => {
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(
					'data: {"choices":[{"delta":{"content":"[]"}}]}\n\n',
				));
				controller.enqueue(encoder.encode('data: [DONE]\n\n'));
				controller.close();
			},
		});
		const fetchMock = vi.fn().mockResolvedValue(new Response(stream));
		vi.stubGlobal('fetch', fetchMock);
		const file = new TFile();
		file.path = 'Selection.md';
		const fullText = 'BeforebetaAfter';
		const editor: SelectionEditorAdapter = {
			readCurrentText: () => fullText,
			isTargetCurrent: () => true,
			replaceRange: vi.fn(),
		};
		const snapshot = {
			file,
			fullText,
			selectedText: 'beta',
			from: 6,
			to: 10,
		};
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(plugin, {
			settings: structuredClone(DEFAULT_SETTINGS),
			app: {
				vault: {
					getAbstractFileByPath: () => null,
				},
			},
			getApiKey: () => 'dummy-key',
		});
		const history: ProviderHistoryMessage[] = Array.from(
			{ length: 12 },
			(_, index) => ({
				role: index % 2 === 0 ? 'user' : 'assistant',
				content: `ready ${index}`,
				mode: 'ask',
				origin: index % 2 === 0 ? 'user' : 'model',
			}),
		);

		const result = await plugin.requestSelectionEdit(
			snapshot,
			'Improve this selection.',
			new AbortController().signal,
			editor,
			[],
			history,
		);

		expect(result.applied).toBe(false);
		expect(fetchMock).toHaveBeenCalledOnce();
		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		const body = JSON.parse(init.body as string) as {
			messages: Array<{ role: string; content: string }>;
		};
		const historical = body.messages.filter((item) =>
			item.content.startsWith('[Historical'),
		);
		expect(historical).toHaveLength(12);
		expect(historical[0]?.content).toContain('ready 0');
		expect(historical.at(-1)?.content).toContain('ready 11');
		const current = body.messages.at(-1);
		expect(current?.role).toBe('user');
		expect(current?.content).toContain('User message:');
	});
});
