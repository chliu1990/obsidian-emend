import { MarkdownView, TFile, TFolder } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveActiveSession } from '../src/chat-sessions';
import { EmendChatView } from '../src/chat-view';
import type { ConversationDataAdapter } from '../src/conversation-store';
import { formatVaultQualifiedPath } from '../src/context';
import {
	buildSelectionDraftEstimate,
	type DraftCapacityEstimate,
} from '../src/context-capacity-ui';
import EmendPlugin from '../src/main';
import type { ReadOnlySubmission } from '../src/request-coordinator';
import type { SelectionContextPolicy } from '../src/selection-focus';
import { SelectionModal } from '../src/selection-modal';
import { createSelectionPresentation } from '../src/selection-presentation';
import {
	SelectionEditRequestCoordinator,
	type SelectionEditorAdapter,
} from '../src/selection-editor';
import { DEFAULT_SETTINGS, normalizeContextLimit } from '../src/settings';
import type {
	ChatMessage,
	EmendSettings,
	ProviderHistoryMessage,
	SelectionSnapshot,
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
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
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
			registerEditorExtension: vi.fn(),
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
			conversationGeneration: 0,
			sessions: [],
			activeSessionId: null,
			activeRequest: null,
			isSessionMutating: false,
			transientSessionIds: new Set<string>(),
			transientSessions: new Map(),
			messages: [] as ChatMessage[],
			selectedMode: 'ask',
			isThreadLoading: false,
			isSending: false,
			activeController: null,
			closed: false,
			inputEl: { value: '' },
			drafts: new Map<string, Map<string, string>>(),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
		});
		leaf.view = view;
		await plugin.onload();
		await plugin.conversationStore.createSession('A.md', {
			id: 'a', title: 'A chat', titleSource: 'auto', createdAt: 1, updatedAt: 1,
			messages: [message('A saved', 'A.md')],
		});
		await plugin.conversationStore.createSession('B.md', {
			id: 'b', title: 'B chat', titleSource: 'auto', createdAt: 1, updatedAt: 1,
			messages: [message('B saved', 'B.md')],
		});
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
			conversationGeneration: number;
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

		const generation = state.conversationGeneration;
		fileOpen?.();
		activeLeafChange?.();
		expect(state.conversationGeneration).toBe(generation);

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
		const bStored = resolveActiveSession(
			(await plugin.conversationStore.loadConversation('B.md')).conversation,
		)?.messages ?? [];
		expect(bStored.map((item) => item.content)).toEqual([
			'B saved content',
			'B prompt',
			'B streamed answer',
		]);
		expect(bStored.some((item) => item.sourcePath === 'A.md')).toBe(false);
		const aStored = resolveActiveSession(
			(await plugin.conversationStore.loadConversation('A.md')).conversation,
		)?.messages ?? [];
		expect(aStored.map((item) => item.id)).toEqual(['A saved']);
	});
});

describe('EmendPlugin selection presentation registration', () => {
	it('registers one live-selection extension without requests, writes, or selection mutation', async () => {
		const registerEditorExtension = vi.fn();
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
					getLeavesOfType: () => [],
				},
			},
			loadSettings: vi.fn().mockResolvedValue(undefined),
			registerView: vi.fn(),
			registerEditorExtension,
			registerEvent: vi.fn(),
			rememberActiveMarkdownView: vi.fn(),
			addRibbonIcon: vi.fn(),
			addCommand: vi.fn(),
			addSettingTab: vi.fn(),
			requestChatCompletion,
			requestSelectionEdit,
		});

		await plugin.onload();

		expect(registerEditorExtension).toHaveBeenCalledTimes(1);
		expect(registerEditorExtension).toHaveBeenCalledWith(createSelectionPresentation());
		expect(requestChatCompletion).not.toHaveBeenCalled();
		expect(requestSelectionEdit).not.toHaveBeenCalled();
		expect(modify).not.toHaveBeenCalled();
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

	function makeChatSelectionView(selectedText: string) {
		const file = new TFile();
		file.path = 'Chat Selection.md';
		const leading = 'Leading context line. '.repeat(80);
		const trailing = 'Trailing context line. '.repeat(80);
		const sourceText = `${leading}${selectedText}${trailing}`;
		const from = leading.length;
		const to = from + selectedText.length;
		const getValue = vi.fn(() => sourceText);
		const getCursor = vi.fn((which: 'from' | 'to') => ({
			offset: which === 'from' ? from : to,
		}));
		const view = Object.assign(
			Object.create(MarkdownView.prototype) as MarkdownView,
			{
				file,
				app: { vault: { getName: () => 'TestVault' } },
				editor: {
					getValue,
					getCursor,
					posToOffset: (position: { offset: number }) => position.offset,
				},
			},
		);
		return { file, from, getCursor, getValue, sourceText, to, view };
	}

	it.each([true, false])(
		'captures one complete Chat Selection context with path privacy=%s',
		(includeNotePath) => {
			const selectedText = 'Focused first line.\nFocused second line with Unicode 🌱.';
			const { file, from, getCursor, getValue, sourceText, to, view } =
				makeChatSelectionView(selectedText);
			const settings = structuredClone(DEFAULT_SETTINGS);
			settings.maxContextCharacters = 0;
			settings.includeNotePathInContext = includeNotePath;
			const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
			Object.assign(plugin, { getTargetMarkdownView: () => view, settings });

			const context = plugin.captureChatSelectionContext();

			expect(getValue).toHaveBeenCalledOnce();
			expect(getCursor).toHaveBeenCalledTimes(2);
			expect(context.file).toBe(file);
			expect(context.sourceText).toBe(sourceText);
			expect(context.selection).toEqual({ from, to });
			expect(context.sourceText.slice(from, to)).toBe(selectedText);
			expect(context.noteLabel).toBe('Chat Selection.md');
			expect(context.notePath).toBe(
				includeNotePath ? 'TestVault/Chat Selection.md' : undefined,
			);
			expect(context.markdown).not.toBe(sourceText);
			expect(context.markdown).toContain(selectedText);
			expect(context.markdown).toContain('[...]');
		},
	);

	it.each([
		{ selectedText: '', caseName: 'vanished' },
		{ selectedText: ' \n\t', caseName: 'whitespace-only' },
	])('rejects a $caseName Chat Selection before any provider request', ({ selectedText }) => {
		const { getValue, view } = makeChatSelectionView(selectedText);
		const requestChatCompletion = vi.fn();
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(plugin, {
			getTargetMarkdownView: () => view,
			settings: structuredClone(DEFAULT_SETTINGS),
			requestChatCompletion,
		});

		expect(() => plugin.captureChatSelectionContext()).toThrow(
			'Select non-whitespace text first.',
		);
		expect(getValue).toHaveBeenCalledOnce();
		expect(requestChatCompletion).not.toHaveBeenCalled();
	});

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
		name: string;
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
			registerEditorExtension: vi.fn(),
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

	it('registers Chat and Edit commands with stable IDs, names, and platform Mod default hotkeys', async () => {
		const { commands } = await createCommandHarness();

		expect(commands.find((command) => command.id === 'emend:switch-to-ask-mode')).toMatchObject({
			name: 'Switch to chat mode',
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'A' }],
		});
		expect(commands.find((command) => command.id === 'emend:switch-to-edit-mode')).toMatchObject({
			name: 'Switch to edit mode',
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
	it('routes file and folder rename/delete events without discovery, refresh, reads, or requests', async () => {
		type VaultHandler = (file: unknown, oldPath?: string) => void;
		const handlers = new Map<string, VaultHandler>();
		const renameEvent = {};
		const deleteEvent = {};
		const registerEvent = vi.fn();
		const read = vi.fn();
		const getMarkdownFiles = vi.fn();
		const metadataDiscovery = vi.fn();
		const requestChatCompletion = vi.fn();
		const requestSelectionEdit = vi.fn();
		const vaultOn = vi.fn((event: string, handler: VaultHandler) => {
			handlers.set(event, handler);
			return event === 'rename' ? renameEvent : deleteEvent;
		});
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(plugin, {
			app: {
				vault: {
					adapter: new MemoryAdapter(),
					configDir: '.test-config',
					on: vaultOn,
					read,
					getMarkdownFiles,
				},
				metadataCache: {
					get resolvedLinks() {
						metadataDiscovery();
						return {};
					},
					getFileCache: metadataDiscovery,
					on: metadataDiscovery,
				},
				workspace: {
					on: () => ({}),
					getLeavesOfType: () => [],
				},
			},
			loadSettings: vi.fn().mockResolvedValue(undefined),
			registerView: vi.fn(),
			registerEditorExtension: vi.fn(),
			registerEvent,
			rememberActiveMarkdownView: vi.fn(),
			addRibbonIcon: vi.fn(),
			addCommand: vi.fn(),
			addSettingTab: vi.fn(),
			requestChatCompletion,
			requestSelectionEdit,
		});

		await plugin.onload();
		const refresh = vi.spyOn(plugin.additionalNotesStore, 'refresh');
		expect(plugin.additionalNotesStore.list('A.md')).toEqual([]);
		expect(vaultOn.mock.calls.map(([event]) => event)).toEqual(['rename', 'delete']);
		expect(registerEvent).toHaveBeenCalledWith(renameEvent);
		expect(registerEvent).toHaveBeenCalledWith(deleteEvent);
		expect(read).not.toHaveBeenCalled();
		expect(getMarkdownFiles).not.toHaveBeenCalled();
		expect(metadataDiscovery).not.toHaveBeenCalled();
		expect(requestChatCompletion).not.toHaveBeenCalled();
		expect(requestSelectionEdit).not.toHaveBeenCalled();

		plugin.additionalNotesStore.addHelper('A.md', {
			type: 'links',
			targetPath: 'B.md',
		}, ['B.md']);
		plugin.additionalNotesStore.add('B.md', 'C.md');
		handlers.get('rename')?.({ path: 'ignored.md' }, 'A.md');
		expect(plugin.additionalNotesStore.list('A.md')).toEqual(['B.md']);
		expect(plugin.additionalNotesStore.listHelpers('A.md')).toEqual([
			{ type: 'links', targetPath: 'B.md' },
		]);
		expect(plugin.additionalNotesStore.list('B.md')).toEqual(['C.md']);

		const renamedFile = new TFile();
		renamedFile.path = 'D.md';
		handlers.get('rename')?.(renamedFile, 'B.md');
		expect(plugin.additionalNotesStore.list('A.md')).toEqual(['D.md']);
		expect(plugin.additionalNotesStore.listHelpers('A.md')).toEqual([
			{ type: 'links', targetPath: 'D.md' },
		]);
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
		expect(plugin.additionalNotesStore.listHelpers('A.md')).toEqual([]);
		expect(plugin.additionalNotesStore.list('D.md')).toEqual([]);

		plugin.additionalNotesStore.addHelper('Folder/Target.md', {
			type: 'folder',
			path: 'Folder',
			scope: { type: 'links', targetPath: 'Folder/Linked.md' },
		}, ['Folder/Linked.md']);
		plugin.additionalNotesStore.add('Other.md', 'Folder/Keep.md');
		plugin.additionalNotesStore.add('Outside.md', 'Outside/Keep.md');
		const renamedFolder = new TFolder();
		renamedFolder.path = 'Renamed';
		handlers.get('rename')?.(renamedFolder, 'Folder');
		expect(plugin.additionalNotesStore.list('Folder/Target.md')).toEqual([]);
		expect(plugin.additionalNotesStore.list('Renamed/Target.md')).toEqual(['Renamed/Linked.md']);
		expect(plugin.additionalNotesStore.listHelpers('Renamed/Target.md')).toEqual([{
			type: 'folder',
			path: 'Renamed',
			scope: { type: 'links', targetPath: 'Renamed/Linked.md' },
		}]);
		expect(plugin.additionalNotesStore.list('Other.md')).toEqual(['Renamed/Keep.md']);
		expect(plugin.additionalNotesStore.list('Outside.md')).toEqual(['Outside/Keep.md']);

		handlers.get('delete')?.({ path: 'Renamed' });
		expect(plugin.additionalNotesStore.list('Renamed/Target.md')).toEqual(['Renamed/Linked.md']);
		const deletedFolder = new TFolder();
		deletedFolder.path = 'Renamed';
		handlers.get('delete')?.(deletedFolder);
		expect(plugin.additionalNotesStore.list('Renamed/Target.md')).toEqual([]);
		expect(plugin.additionalNotesStore.listHelpers('Renamed/Target.md')).toEqual([]);
		expect(plugin.additionalNotesStore.list('Other.md')).toEqual([]);
		expect(plugin.additionalNotesStore.list('Outside.md')).toEqual(['Outside/Keep.md']);

		plugin.additionalNotesStore.add('A.md', 'Ephemeral.md');
		const reloadedPlugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(reloadedPlugin, {
			app: plugin.app,
			loadSettings: vi.fn().mockResolvedValue(undefined),
			registerView: vi.fn(),
			registerEditorExtension: vi.fn(),
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

		expect(refresh).not.toHaveBeenCalled();
		expect(read).not.toHaveBeenCalled();
		expect(getMarkdownFiles).not.toHaveBeenCalled();
		expect(metadataDiscovery).not.toHaveBeenCalled();
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
			chatTarget: 'note',
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

	it('keeps Full-note-context Operations confined with zero native or vault writes', async () => {
		const response = JSON.stringify([
			{ type: 'replace', target: 'Outside only', replacement: 'Changed' },
		]);
		const event = JSON.stringify({ choices: [{ delta: { content: response } }] });
		const encoder = new TextEncoder();
		const fetchMock = vi.fn().mockImplementation(async () => {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(encoder.encode(`data: ${event}\n\n`));
					controller.enqueue(encoder.encode('data: [DONE]\n\n'));
					controller.close();
				},
			});
			return new Response(stream);
		});
		vi.stubGlobal('fetch', fetchMock);
		const file = new TFile();
		file.path = 'Selection.md';
		const fullText = 'Outside only\nAlpha beta gamma.';
		const from = fullText.indexOf('beta');
		const snapshot: SelectionSnapshot = {
			file,
			fullText,
			selectedText: 'beta',
			from,
			to: from + 4,
		};
		const editor: SelectionEditorAdapter = {
			readCurrentText: () => fullText,
			isTargetCurrent: () => true,
			replaceRange: vi.fn(),
		};
		const vaultModify = vi.fn();
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(plugin, {
			settings: structuredClone(DEFAULT_SETTINGS),
			app: {
				vault: {
					getAbstractFileByPath: () => null,
					modify: vaultModify,
				},
			},
			getApiKey: () => 'dummy-key',
		});

		await expect(plugin.requestSelectionEdit(
			snapshot,
			'Improve this selection.',
			new AbortController().signal,
			editor,
			[],
			[],
			undefined,
			'full-note',
		)).rejects.toThrow(/not found|match/i);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		const body = JSON.parse(init.body as string) as {
			messages: Array<{ content: string }>;
		};
		expect(body.messages.at(-1)?.content).toContain(
			`Full note (supporting context):\n${fullText}\n\nSelected text (the only edit target):\nbeta`,
		);
		expect(editor.replaceRange).not.toHaveBeenCalled();
		expect(vaultModify).not.toHaveBeenCalled();
		expect(snapshot.fullText).toBe(fullText);
	});
});

describe('EmendPlugin edit freshness', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('wires an editor reader scoped to the target file', async () => {
		const response = JSON.stringify([
			{ type: 'replace', target: 'beta', replacement: 'delta' },
		]);
		const event = JSON.stringify({ choices: [{ delta: { content: response } }] });
		const encoder = new TextEncoder();
		const fetchMock = vi.fn().mockImplementation(async () => {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(encoder.encode(`data: ${event}\n\n`));
					controller.enqueue(encoder.encode('data: [DONE]\n\n'));
					controller.close();
				},
			});
			return new Response(stream);
		});
		vi.stubGlobal('fetch', fetchMock);
		const sourceText = '# Note\nAlpha beta.';
		const file = new TFile();
		file.path = 'Note.md';
		const targetGetValue = vi.fn(() => sourceText);
		const targetView = Object.assign(
			Object.create(MarkdownView.prototype) as MarkdownView,
			{ file, editor: { getValue: targetGetValue } },
		);
		const otherFile = new TFile();
		otherFile.path = 'Other.md';
		const otherGetValue = vi.fn(() => '# Other\nUnsaved typing.');
		const otherView = Object.assign(
			Object.create(MarkdownView.prototype) as MarkdownView,
			{ file: otherFile, editor: { getValue: otherGetValue } },
		);
		const vaultModify = vi.fn(async () => undefined);
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(plugin, {
			settings: structuredClone(DEFAULT_SETTINGS),
			getTargetMarkdownView: () => targetView,
			app: {
				vault: {
					getAbstractFileByPath: () => null,
					read: async () => sourceText,
					modify: vaultModify,
				},
				workspace: {
					iterateAllLeaves: (
						callback: (leaf: { view: MarkdownView }) => void,
					) => {
						callback({ view: otherView });
					},
				},
			},
			getApiKey: () => 'dummy-key',
		});

		const result = await plugin.requestChatCompletion({
			context: {
				file,
				sourceText,
				selection: { from: 0, to: 0 },
				noteLabel: file.path,
				markdown: sourceText,
			},
			mode: 'edit',
			prompt: 'Replace beta with delta.',
			history: [],
			callbacks: { onReasoning: vi.fn() },
			signal: new AbortController().signal,
		});

		expect(result).toMatchObject({ applied: true, changeCount: 1 });
		expect(targetGetValue).toHaveBeenCalledOnce();
		expect(otherGetValue).not.toHaveBeenCalled();
		expect(vaultModify).toHaveBeenCalledExactlyOnceWith(
			file,
			'# Note\nAlpha {~~beta~>delta~~}.',
		);
	});

	it('rejects an edit when another open view of the target file has different text', async () => {
		const response = JSON.stringify([
			{ type: 'replace', target: 'beta', replacement: 'delta' },
		]);
		const event = JSON.stringify({ choices: [{ delta: { content: response } }] });
		const encoder = new TextEncoder();
		const fetchMock = vi.fn().mockImplementation(async () => {
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(encoder.encode(`data: ${event}\n\n`));
					controller.enqueue(encoder.encode('data: [DONE]\n\n'));
					controller.close();
				},
			});
			return new Response(stream);
		});
		vi.stubGlobal('fetch', fetchMock);
		const sourceText = '# Note\nAlpha beta.';
		const file = new TFile();
		file.path = 'Note.md';
		const targetView = Object.assign(
			Object.create(MarkdownView.prototype) as MarkdownView,
			{ file, editor: { getValue: vi.fn(() => sourceText) } },
		);
		const otherView = Object.assign(
			Object.create(MarkdownView.prototype) as MarkdownView,
			{ file, editor: { getValue: vi.fn(() => `${sourceText} Unsaved typing.`) } },
		);
		const vaultModify = vi.fn(async () => undefined);
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(plugin, {
			settings: structuredClone(DEFAULT_SETTINGS),
			getTargetMarkdownView: () => targetView,
			app: {
				vault: {
					getAbstractFileByPath: () => null,
					read: async () => sourceText,
					modify: vaultModify,
				},
				workspace: {
					iterateAllLeaves: (
						callback: (leaf: { view: MarkdownView }) => void,
					) => {
						callback({ view: targetView });
						callback({ view: otherView });
					},
				},
			},
			getApiKey: () => 'dummy-key',
		});

		await expect(plugin.requestChatCompletion({
			context: {
				file,
				sourceText,
				selection: { from: 0, to: 0 },
				noteLabel: file.path,
				markdown: sourceText,
			},
			mode: 'edit',
			prompt: 'Replace beta with delta.',
			history: [],
			callbacks: { onReasoning: vi.fn() },
			signal: new AbortController().signal,
		})).rejects.toThrow(
			'The note changed while Emend was responding. No edits were applied.',
		);

		expect(vaultModify).not.toHaveBeenCalled();
	});
});

describe('EmendPlugin settings capacity refresh', () => {
	function makeSaveFixture(saveData: ReturnType<typeof vi.fn>) {
		const refreshModelControl = vi.fn();
		const refreshCapacityEstimate = vi.fn();
		const otherRefreshModelControl = vi.fn();
		const otherRefreshCapacityEstimate = vi.fn();
		const view = Object.create(EmendChatView.prototype) as EmendChatView;
		Object.assign(view, { refreshModelControl, refreshCapacityEstimate });
		const otherView = Object.create(EmendChatView.prototype) as EmendChatView;
		Object.assign(otherView, {
			refreshModelControl: otherRefreshModelControl,
			refreshCapacityEstimate: otherRefreshCapacityEstimate,
		});
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(plugin, {
			settings: structuredClone(DEFAULT_SETTINGS),
			saveData,
			app: {
				workspace: {
					getLeavesOfType: () => [
						{ view },
						{ view: otherView },
						{ view: {} },
					],
				},
			},
		});
		return {
			plugin,
			refreshModelControl,
			refreshCapacityEstimate,
			otherRefreshModelControl,
			otherRefreshCapacityEstimate,
		};
	}

	it('retains no-argument saves and refreshes every open chat view', async () => {
		const saveData = vi.fn(async (_data: unknown) => undefined);
		const fixture = makeSaveFixture(saveData);

		await fixture.plugin.saveSettings();

		expect(saveData).toHaveBeenCalledOnce();
		expect(fixture.refreshModelControl).toHaveBeenCalledOnce();
		expect(fixture.refreshCapacityEstimate).toHaveBeenCalledOnce();
		expect(fixture.otherRefreshModelControl).toHaveBeenCalledOnce();
		expect(fixture.otherRefreshCapacityEstimate).toHaveBeenCalledOnce();
	});

	it('sanitizes a candidate once, applies it in place after saving, and refreshes both views', async () => {
		const pendingSave = deferred<void>();
		const saveData = vi.fn((_data: unknown) => pendingSave.promise);
		const fixture = makeSaveFixture(saveData);
		const original = fixture.plugin.settings;
		const originalProviders = original.providers;
		const originalConfigs = {
			deepseek: original.providers.deepseek,
			kimi: original.providers.kimi,
			custom: original.providers.custom,
		};
		const candidate = structuredClone(DEFAULT_SETTINGS);
		candidate.activeProvider = 'custom';
		candidate.defaultMode = 'edit';
		candidate.historyMessageLimit = 13;
		candidate.providers.deepseek.apiKey = 'deepseek-secret';
		candidate.providers.kimi.apiKey = 'kimi-secret';
		candidate.providers.custom.apiKey = 'custom-secret';
		candidate.providers.custom.name = 'Local';
		candidate.providers.custom.model = 'Candidate model';
		candidate.providers.custom.baseUrl = 'https://candidate.invalid/v1';

		const saving = fixture.plugin.saveSettings(candidate);

		await waitFor(() => saveData.mock.calls.length === 1);
		expect(saveData).toHaveBeenCalledOnce();
		expect(fixture.plugin.settings).toBe(original);
		const persisted = saveData.mock.calls[0]?.[0] as EmendSettings;
		expect(persisted).not.toBe(candidate);
		expect(persisted.activeProvider).toBe('custom');
		expect(persisted.defaultMode).toBe('edit');
		expect(persisted.historyMessageLimit).toBe(13);
		expect(persisted.providers.custom.model).toBe('Candidate model');
		expect(persisted.providers.custom.baseUrl).toBe('https://candidate.invalid/v1');
		expect(persisted.providers.deepseek.apiKey).toBe('');
		expect(persisted.providers.kimi.apiKey).toBe('');
		expect(persisted.providers.custom.apiKey).toBe('');
		expect(candidate.providers.custom.apiKey).toBe('custom-secret');
		expect(fixture.refreshModelControl).not.toHaveBeenCalled();
		expect(fixture.refreshCapacityEstimate).not.toHaveBeenCalled();

		pendingSave.resolve();
		await saving;

		expect(saveData).toHaveBeenCalledOnce();
		expect(fixture.plugin.settings).toBe(original);
		expect(fixture.plugin.settings).toEqual(candidate);
		expect(fixture.plugin.settings).not.toBe(candidate);
		expect(fixture.plugin.settings.providers).toBe(originalProviders);
		for (const providerId of ['deepseek', 'kimi', 'custom'] as const) {
			expect(fixture.plugin.settings.providers[providerId]).toBe(
				originalConfigs[providerId],
			);
		}
		expect(fixture.refreshModelControl).toHaveBeenCalledOnce();
		expect(fixture.refreshCapacityEstimate).toHaveBeenCalledOnce();
		expect(fixture.otherRefreshModelControl).toHaveBeenCalledOnce();
		expect(fixture.otherRefreshCapacityEstimate).toHaveBeenCalledOnce();
	});

	it('leaves live settings and every view unchanged when a candidate save rejects', async () => {
		const saveData = vi.fn(async (_data: unknown) => {
			throw new Error('Disk full');
		});
		const fixture = makeSaveFixture(saveData);
		const original = fixture.plugin.settings;
		const candidate = structuredClone(DEFAULT_SETTINGS);
		candidate.activeProvider = 'kimi';
		candidate.providers.kimi.model = 'candidate-kimi';

		await expect(fixture.plugin.saveSettings(candidate)).rejects.toThrow('Disk full');

		expect(saveData).toHaveBeenCalledOnce();
		expect(fixture.plugin.settings).toBe(original);
		expect(fixture.refreshModelControl).not.toHaveBeenCalled();
		expect(fixture.refreshCapacityEstimate).not.toHaveBeenCalled();
		expect(fixture.otherRefreshModelControl).not.toHaveBeenCalled();
		expect(fixture.otherRefreshCapacityEstimate).not.toHaveBeenCalled();
	});

	it('serializes two deferred model selections and rebases the second updater', async () => {
		const firstDiskSave = deferred<void>();
		const saveData = vi.fn()
			.mockImplementationOnce(() => firstDiskSave.promise)
			.mockImplementation(async () => undefined);
		const fixture = makeSaveFixture(saveData);
		fixture.plugin.settings.activeProvider = 'custom';
		fixture.plugin.settings.providers.custom.baseUrl = 'https://newer.invalid/v1';
		fixture.plugin.settings.providers.custom.discoveredModels = [
			{ id: 'newer-cache', displayName: 'Newer cache' },
		];

		const first = fixture.plugin.saveSettings((current) => ({
			...current,
			activeProvider: 'deepseek',
			providers: {
				...current.providers,
				deepseek: {
					...current.providers.deepseek,
					model: 'deepseek-v4-pro',
					reasoningEffort: 'low',
				},
			},
		}));
		const second = fixture.plugin.saveSettings((current) => ({
			...current,
			activeProvider: 'kimi',
			providers: {
				...current.providers,
				kimi: {
					...current.providers.kimi,
					model: 'k3.1-pro',
					reasoningEffort: 'medium',
				},
			},
		}));
		void first.catch(() => undefined);
		void second.catch(() => undefined);

		await waitFor(() => saveData.mock.calls.length === 1);
		expect(saveData).toHaveBeenCalledOnce();
		expect(fixture.plugin.settings.activeProvider).toBe('custom');
		firstDiskSave.resolve();
		await first;
		await second;

		expect(saveData).toHaveBeenCalledTimes(2);
		const firstPersisted = saveData.mock.calls[0]?.[0] as EmendSettings;
		const secondPersisted = saveData.mock.calls[1]?.[0] as EmendSettings;
		expect(firstPersisted.activeProvider).toBe('deepseek');
		expect(firstPersisted.providers.deepseek.model).toBe('deepseek-v4-pro');
		expect(firstPersisted.providers.deepseek.reasoningEffort).toBe('low');
		expect(secondPersisted.activeProvider).toBe('kimi');
		expect(secondPersisted.providers.deepseek.model).toBe('deepseek-v4-pro');
		expect(secondPersisted.providers.deepseek.reasoningEffort).toBe('low');
		expect(secondPersisted.providers.kimi.reasoningEffort).toBe('medium');
		expect(secondPersisted.providers.custom.baseUrl).toBe('https://newer.invalid/v1');
		expect(secondPersisted.providers.custom.discoveredModels).toEqual([
			{ id: 'newer-cache', displayName: 'Newer cache' },
		]);
	});

	it('rebases a pending composer candidate around a later no-argument Settings save', async () => {
		const firstDiskSave = deferred<void>();
		const saveData = vi.fn()
			.mockImplementationOnce(() => firstDiskSave.promise)
			.mockImplementation(async () => undefined);
		const fixture = makeSaveFixture(saveData);
		const originalRoot = fixture.plugin.settings;
		const originalProviders = originalRoot.providers;
		const originalDeepSeek = originalProviders.deepseek;

		const composerSave = fixture.plugin.saveSettings((current) => ({
			...current,
			activeProvider: 'deepseek',
			providers: {
				...current.providers,
				deepseek: {
					...current.providers.deepseek,
					model: 'deepseek-v4-pro',
					reasoningEffort: 'low',
				},
			},
		}));
		void composerSave.catch(() => undefined);
		await waitFor(() => saveData.mock.calls.length === 1);
		originalDeepSeek.baseUrl = 'https://settings-open.invalid/v1';
		originalDeepSeek.contextWindowTokens = 98765;
		originalProviders.kimi.model = 'settings-open-kimi';
		originalRoot.historyMessageLimit = 17;
		const settingsSave = fixture.plugin.saveSettings();

		expect(saveData).toHaveBeenCalledOnce();
		firstDiskSave.resolve();
		await composerSave;
		await settingsSave;

		expect(saveData).toHaveBeenCalledTimes(2);
		const firstPersisted = saveData.mock.calls[0]?.[0] as EmendSettings;
		expect(firstPersisted.providers.deepseek.model).toBe('deepseek-v4-pro');
		expect(firstPersisted.providers.deepseek.baseUrl).toBe('https://api.deepseek.com');
		const finalPersisted = saveData.mock.calls[1]?.[0] as EmendSettings;
		expect(finalPersisted.providers.deepseek.model).toBe('deepseek-v4-pro');
		expect(finalPersisted.providers.deepseek.baseUrl).toBe('https://settings-open.invalid/v1');
		expect(finalPersisted.providers.deepseek.contextWindowTokens).toBe(98765);
		expect(finalPersisted.providers.kimi.model).toBe('settings-open-kimi');
		expect(finalPersisted.historyMessageLimit).toBe(17);
		expect(fixture.plugin.settings).toBe(originalRoot);
		expect(fixture.plugin.settings.providers).toBe(originalProviders);
		expect(fixture.plugin.settings.providers.deepseek).toBe(originalDeepSeek);
	});

	it('continues the settings queue after a rejected save without a failure refresh', async () => {
		const firstDiskSave = deferred<void>();
		const saveData = vi.fn()
			.mockImplementationOnce(() => firstDiskSave.promise)
			.mockImplementation(async () => undefined);
		const fixture = makeSaveFixture(saveData);
		const rejected = structuredClone(fixture.plugin.settings);
		rejected.activeProvider = 'kimi';
		const accepted = structuredClone(fixture.plugin.settings);
		accepted.activeProvider = 'custom';
		accepted.providers.custom.model = 'accepted-model';

		const first = fixture.plugin.saveSettings(rejected);
		void first.catch(() => undefined);
		const second = fixture.plugin.saveSettings(accepted);
		void second.catch(() => undefined);
		await waitFor(() => saveData.mock.calls.length === 1);
		expect(saveData).toHaveBeenCalledOnce();
		firstDiskSave.reject(new Error('Disk full'));

		await expect(first).rejects.toThrow('Disk full');
		await second;
		expect(saveData).toHaveBeenCalledTimes(2);
		expect((saveData.mock.calls[1]?.[0] as EmendSettings).activeProvider).toBe('custom');
		expect(fixture.plugin.settings.activeProvider).toBe('custom');
		expect(fixture.plugin.settings.providers.custom.model).toBe('accepted-model');
		expect(fixture.refreshModelControl).toHaveBeenCalledOnce();
		expect(fixture.refreshCapacityEstimate).toHaveBeenCalledOnce();
	});
});

describe('EmendPlugin Selection modal capacity estimate', () => {
	function makeSelectionView(selectedText: string) {
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
		return { file, fullText, from, to, view, editor };
	}

	function selectionSettings() {
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.activeProvider = 'custom';
		settings.providers.custom.contextWindowTokens = 1000;
		settings.providers.custom.outputReserveTokens = 100;
		settings.maxContextCharacters = 0;
		settings.smartSelectionContext = false;
		settings.includeNotePathInContext = true;
		return settings;
	}

	it('uses the captured snapshot, normalized settings, privacy path, and empty history', () => {
		const settings = selectionSettings();
		const file = new TFile();
		file.path = 'Selection.md';
		const fullText = `Alpha ${'word '.repeat(600)}beta ${'tail '.repeat(200)}`;
		const from = fullText.indexOf('beta');
		const to = from + 'beta'.length;
		const snapshot: SelectionSnapshot = {
			file,
			fullText,
			selectedText: 'beta',
			from,
			to,
		};
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(plugin, {
			settings,
			app: { vault: { getName: () => 'Vault' } },
		});

		const estimate = plugin.estimateSelectionDraft(snapshot, 'Tighten this.');

		expect(estimate).toEqual(buildSelectionDraftEstimate({
			provider: settings.providers.custom,
			snapshot,
			prompt: 'Tighten this.',
			maxContextCharacters: normalizeContextLimit(0),
			smartSelectionContext: false,
			selectionContext: 'default',
			notePath: formatVaultQualifiedPath('Vault', file.path),
			history: [],
		}));
		expect(estimate.categories.history).toBe(0);
		expect(normalizeContextLimit(0)).toBe(1000);
		expect(
			buildSelectionDraftEstimate({
				provider: settings.providers.custom,
				snapshot,
				prompt: 'Tighten this.',
				maxContextCharacters: 12000,
				smartSelectionContext: false,
				selectionContext: 'default',
				notePath: formatVaultQualifiedPath('Vault', file.path),
				history: [],
			}).categories.user,
		).not.toBe(estimate.categories.user);

		settings.providers.custom.contextWindowTokens = 100;
		settings.providers.custom.outputReserveTokens = 100;

		expect(plugin.estimateSelectionDraft(snapshot, 'Tighten this.').capacity.kind).toBe(
			'invalid',
		);
	});

	it('forwards trailing Full-note policy to both Selection submission and draft estimation', async () => {
		const settings = selectionSettings();
		const file = new TFile();
		file.path = 'Selection.md';
		const fullText = 'BeforebetaAfter';
		const snapshot: SelectionSnapshot = {
			file,
			fullText,
			selectedText: 'beta',
			from: 6,
			to: 10,
		};
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(plugin, {
			settings,
			app: { vault: { getName: () => 'Vault' } },
			getApiKey: () => 'dummy-key',
		});
		let captured:
			| {
				maxContextCharacters: number;
				smartSelectionContext: boolean;
				selectionContext: 'default' | 'full-note';
				notePath?: string;
			}
			| undefined;
		const submitSpy = vi
			.spyOn(SelectionEditRequestCoordinator.prototype, 'submit')
			.mockImplementation(async (submission) => {
				captured = submission;
				return {
					applied: false,
					changeCount: 0,
					summaryItems: [],
					usage: {
						promptTokens: 1,
						completionTokens: 1,
						totalTokens: 2,
						source: 'provider' as const,
					},
				};
			});
		try {
			const editor: SelectionEditorAdapter = {
				readCurrentText: () => fullText,
				isTargetCurrent: () => true,
				replaceRange: vi.fn(),
			};

			await plugin.requestSelectionEdit(
				snapshot,
				'Tighten this.',
				new AbortController().signal,
				editor,
				[],
				[],
				undefined,
				'full-note',
			);

			expect(captured).toBeDefined();
			expect(captured).toMatchObject({
				maxContextCharacters: 1000,
				smartSelectionContext: false,
				selectionContext: 'full-note',
				notePath: 'Vault/Selection.md',
			});
			const estimate = plugin.estimateSelectionDraft(
				snapshot,
				'Tighten this.',
				'full-note',
			);
			expect(estimate).toEqual(buildSelectionDraftEstimate({
				provider: settings.providers[settings.activeProvider],
				snapshot,
				prompt: 'Tighten this.',
				maxContextCharacters: captured?.maxContextCharacters ?? 0,
				smartSelectionContext: captured?.smartSelectionContext ?? true,
				selectionContext: 'full-note',
				notePath: captured?.notePath,
				history: [],
			}));
			expect(estimate.categories.history).toBe(0);
		} finally {
			submitSpy.mockRestore();
		}
	});

	it('forwards identical modal policies after capturing the selection once', async () => {
		interface RegisteredCommand {
			id: string;
			editorCheckCallback?: (
				checking: boolean,
				editor: unknown,
				view: unknown,
			) => boolean;
		}

		const commands: RegisteredCommand[] = [];
		const settings = selectionSettings();
		const { view, editor } = makeSelectionView('beta');
		const getValue = vi.fn(editor.getValue);
		editor.getValue = getValue;
		const plugin = Object.create(EmendPlugin.prototype) as EmendPlugin;
		Object.assign(plugin, {
			app: {
				vault: {
					adapter: new MemoryAdapter(),
					configDir: '.test-config',
					on: () => ({}),
					getAbstractFileByPath: () => null,
					getName: () => 'Vault',
				},
				workspace: {
					on: () => ({}),
					getLeavesOfType: () => [],
				},
				secretStorage: { setSecret: vi.fn(), getSecret: vi.fn(() => null) },
			},
			settings,
			loadSettings: vi.fn().mockResolvedValue(undefined),
			registerView: vi.fn(),
			registerEditorExtension: vi.fn(),
			registerEvent: vi.fn(),
			rememberActiveMarkdownView: vi.fn(),
			addRibbonIcon: vi.fn(),
			addCommand: vi.fn((command: RegisteredCommand) => commands.push(command)),
			addSettingTab: vi.fn(),
			register: vi.fn(),
			getTargetMarkdownView: () => view,
		});
		await plugin.onload();
		const snapshot: SelectionSnapshot = {
			file: view.file,
			fullText: 'BeforebetaAfter',
			selectedText: 'beta',
			from: 6,
			to: 10,
		};
		const estimateResult = plugin.estimateSelectionDraft(
			snapshot,
			'Tighten this.',
			'default',
		);
		const estimateSelectionDraft = vi.fn(() => estimateResult);
		const requestSelectionEdit = vi.fn(async () => ({
			applied: false,
			changeCount: 0,
			summaryItems: [],
			usage: {
				promptTokens: 1,
				completionTokens: 1,
				totalTokens: 2,
				source: 'provider' as const,
			},
		}));
		Object.assign(plugin, { estimateSelectionDraft, requestSelectionEdit });

		const opened: SelectionModal[] = [];
		const prototype = SelectionModal.prototype as unknown as {
			open?: () => void;
		};
		const originalOpen = prototype.open;
		prototype.open = function (this: SelectionModal) {
			opened.push(this);
		};
		try {
			const modifyCommand = commands.find(
				(command) => command.id === 'emend:modify-selected-text',
			);
			expect(modifyCommand).toBeDefined();
			expect(modifyCommand?.editorCheckCallback?.(false, editor, view)).toBe(true);
			expect(getValue).toHaveBeenCalledTimes(1);
			const modal = opened[0];
			if (!modal) {
				throw new Error('Selection modal was not opened.');
			}
			const callbacks = modal as unknown as {
				smartSelectionContext: boolean;
				submitSelection: (
					prompt: string,
					signal: AbortSignal,
					additionalNotePaths: readonly string[],
					selectionContext: SelectionContextPolicy,
				) => Promise<unknown>;
				estimateDraft: (
					prompt: string,
					selectionContext: SelectionContextPolicy,
				) => DraftCapacityEstimate;
			};
			const signal = new AbortController().signal;

			await callbacks.submitSelection(
				'Tighten this.',
				signal,
				['Context.md'],
				'full-note',
			);
			const estimate = callbacks.estimateDraft('Tighten this.', 'full-note');

			expect(callbacks.smartSelectionContext).toBe(false);
			expect(requestSelectionEdit).toHaveBeenCalledOnce();
			expect(requestSelectionEdit).toHaveBeenCalledWith(
				snapshot,
				'Tighten this.',
				signal,
				expect.any(Object),
				['Context.md'],
				[],
				undefined,
				'full-note',
			);
			expect(requestSelectionEdit.mock.calls[0]).toHaveLength(8);
			expect(estimateSelectionDraft).toHaveBeenCalledOnce();
			expect(estimateSelectionDraft).toHaveBeenCalledWith(
				snapshot,
				'Tighten this.',
				'full-note',
			);
			expect(estimate).toBe(estimateResult);
			expect(getValue).toHaveBeenCalledTimes(1);
		} finally {
			if (originalOpen) {
				prototype.open = originalOpen;
			} else {
				delete prototype.open;
			}
		}
	});
});
