import { describe, expect, it, vi } from 'vitest';
import { EmendChatView } from '../src/chat-view';
import type { ConversationDataAdapter } from '../src/conversation-store';
import EmendPlugin from '../src/main';
import type { ReadOnlySubmission } from '../src/request-coordinator';
import type { ChatMessage } from '../src/types';

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
				vault: { adapter, configDir: '.test-config' },
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
			{ role: 'assistant', content: 'B saved content' },
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
