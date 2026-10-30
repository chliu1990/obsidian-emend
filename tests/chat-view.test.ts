import { describe, expect, it, vi } from 'vitest';
import { EmendChatView } from '../src/chat-view';
import type { ChatMessage } from '../src/types';

const viewPrototype = EmendChatView.prototype as unknown as {
	refreshTargetNote(this: unknown): Promise<void>;
	submitPrompt(this: unknown): Promise<void>;
	onClose(this: unknown): Promise<void>;
};

function message(id: string, sourcePath: string): ChatMessage {
	return {
		id,
		role: 'assistant',
		content: id,
		reasoning: '',
		mode: 'ask',
		sourcePath,
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

describe('EmendChatView conversation loading', () => {
	it('applies only the latest note load during rapid note switches', async () => {
		let activePath = 'First.md';
		const first = deferred<ChatMessage[]>();
		const second = deferred<ChatMessage[]>();
		const context = {
			plugin: {
				getActiveNotePath: () => activePath,
				conversationStore: {
					load: vi.fn((path: string) =>
						path === 'First.md' ? first.promise : second.promise,
					),
				},
			},
			notePath: null,
			noteLoadGeneration: 0,
			messages: [] as ChatMessage[],
			selectedMode: 'brainstorm',
			isThreadLoading: false,
			isSending: false,
			activeController: null,
			closed: false,
			render: vi.fn(),
		};

		const firstLoad = viewPrototype.refreshTargetNote.call(context);
		activePath = 'Second.md';
		const secondLoad = viewPrototype.refreshTargetNote.call(context);
		second.resolve([message('second', 'Second.md')]);
		await secondLoad;
		first.resolve([message('first', 'First.md')]);
		await firstLoad;

		expect(context.messages.map((item) => item.id)).toEqual(['second']);
		expect(context.notePath).toBe('Second.md');
		expect(context.selectedMode).toBe('brainstorm');
		expect(context.isThreadLoading).toBe(false);
	});

	it('does not apply a pending load after the view closes', async () => {
		const pending = deferred<ChatMessage[]>();
		const context = {
			plugin: {
				getActiveNotePath: () => 'Note.md',
				conversationStore: { load: vi.fn(() => pending.promise) },
			},
			notePath: null,
			noteLoadGeneration: 0,
			messages: [] as ChatMessage[],
			isThreadLoading: false,
			isSending: false,
			activeController: null,
			closed: false,
			render: vi.fn(),
		};

		const loading = viewPrototype.refreshTargetNote.call(context);
		context.closed = true;
		context.noteLoadGeneration++;
		pending.resolve([message('stale', 'Note.md')]);
		await loading;

		expect(context.messages).toEqual([]);
	});

	it('clears the thread-loading state when the view closes', async () => {
		const context = {
			closed: false,
			isThreadLoading: true,
			noteLoadGeneration: 0,
			notePath: 'Note.md',
			activeController: null,
			cancelPendingRender: vi.fn(),
			pendingMessages: new Set(),
			messageBodyEls: new Map(),
			activeModelEl: null,
			inputEl: null,
			contentEl: { empty: vi.fn() },
		};

		await viewPrototype.onClose.call(context);

		expect(context.isThreadLoading).toBe(false);
	});
});

describe('EmendChatView conversation saving', () => {
	it('saves the ready user message and completed assistant message with usage', async () => {
		const savedSnapshots: Array<Array<{ role: string; status: string; content: string }>> = [];
		const context = {
			inputEl: { value: 'Question' },
			isSending: false,
			selectedMode: 'ask' as const,
			messages: [] as ChatMessage[],
			plugin: {
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				requestChatCompletion: vi.fn(
					async ({ callbacks }: { callbacks: { onContent: (text: string) => void } }) => {
						callbacks.onContent('Answer');
						return {
							content: 'Answer',
							reasoning: '',
							usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4 },
						};
					},
				),
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(async (_path: string, messages: ChatMessage[]) => {
				savedSnapshots.push(
					messages.map(({ role, status, content }) => ({ role, status, content })),
				);
			}),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
		};

		await viewPrototype.submitPrompt.call(context);

		expect(savedSnapshots).toEqual([
			[{ role: 'user', status: 'ready', content: 'Question' }],
			[
				{ role: 'user', status: 'ready', content: 'Question' },
				{ role: 'assistant', status: 'ready', content: 'Answer' },
			],
		]);
		expect(context.messages[1]?.usage).toEqual({
			promptTokens: 3,
			completionTokens: 1,
			totalTokens: 4,
		});
		expect(context.messages.every((item) => item.timestamp > 0)).toBe(true);
	});
});
