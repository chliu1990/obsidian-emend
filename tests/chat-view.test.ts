import { Scope } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { ShortcutEvent } from '../src/chat-shortcuts';
import { EmendChatView } from '../src/chat-view';
import type { ChatMessage, Mode } from '../src/types';

const viewPrototype = EmendChatView.prototype as unknown as {
	refreshTargetNote(this: unknown): Promise<void>;
	submitPrompt(this: unknown): Promise<void>;
	handleComposerKeydown(
		this: unknown,
		event: ShortcutEvent & { preventDefault(): void },
	): void;
	setMode(this: unknown, mode: Mode): void;
	registerComposerScope(this: unknown): void;
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

describe('EmendChatView keyboard shortcuts', () => {
	function keyboardEvent(overrides: Partial<ShortcutEvent> = {}) {
		return {
			key: 'Enter',
			metaKey: false,
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
			preventDefault: vi.fn(),
			...overrides,
		};
	}

	it.each([{}, { metaKey: true }, { ctrlKey: true }])(
		'submits and prevents the default for Enter and Mod+Enter: %o',
		(modifiers) => {
			const context = {
				isSending: false,
				isThreadLoading: false,
				submitPrompt: vi.fn().mockResolvedValue(undefined),
			};
			const event = keyboardEvent(modifiers);

			viewPrototype.handleComposerKeydown.call(context, event);

			expect(event.preventDefault).toHaveBeenCalledOnce();
			expect(context.submitPrompt).toHaveBeenCalledOnce();
		},
	);

	it('leaves Shift+Enter to the textarea for a newline', () => {
		const context = {
			isSending: false,
			isThreadLoading: false,
			submitPrompt: vi.fn(),
		};
		const event = keyboardEvent({ shiftKey: true });

		viewPrototype.handleComposerKeydown.call(context, event);

		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(context.submitPrompt).not.toHaveBeenCalled();
	});

	it.each([
		{ isSending: true, isThreadLoading: false },
		{ isSending: false, isThreadLoading: true },
	])('does not submit through a shortcut while controls are unavailable: %o', (state) => {
		const context = { ...state, submitPrompt: vi.fn() };
		const event = keyboardEvent({ metaKey: true });

		viewPrototype.handleComposerKeydown.call(context, event);

		expect(context.submitPrompt).not.toHaveBeenCalled();
	});

	it('ignores modified-key conflicts in the real key handler', () => {
		const context = {
			isSending: false,
			isThreadLoading: false,
			submitPrompt: vi.fn(),
		};
		const event = keyboardEvent({ metaKey: true, shiftKey: true });

		viewPrototype.handleComposerKeydown.call(context, event);

		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(context.submitPrompt).not.toHaveBeenCalled();
	});

	it('shows a newly selected mode immediately and preserves the draft without aborting', () => {
		const context = {
			selectedMode: 'ask' as Mode,
			inputEl: { value: 'Keep this draft' } as { value: string } | null,
			isSending: true,
			activeController: { abort: vi.fn() },
			render: vi.fn(() => {
				context.inputEl = { value: '' };
			}),
		};

		viewPrototype.setMode.call(context, 'edit');

		expect(context.selectedMode).toBe('edit');
		expect(context.inputEl?.value).toBe('Keep this draft');
		expect(context.render).toHaveBeenCalledOnce();
		expect(context.activeController.abort).not.toHaveBeenCalled();
	});

	it('changes only the next request mode while a submission is pending', async () => {
		const pending = deferred<{ content: string; reasoning: string }>();
		const requestChatCompletion = vi.fn((_submission: { mode: Mode }) => pending.promise);
		const context = {
			inputEl: { value: 'First prompt' } as { value: string } | null,
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as Mode,
			messages: [] as ChatMessage[],
			plugin: {
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn().mockResolvedValue(undefined),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null as AbortController | null,
		};

		const submission = viewPrototype.submitPrompt.call(context);
		await vi.waitFor(() => expect(requestChatCompletion).toHaveBeenCalledOnce());
		const controller = context.activeController;
		if (!controller) {
			throw new Error('Request controller missing.');
		}
		const abort = vi.spyOn(controller, 'abort');
		context.inputEl = { value: 'Next prompt' };

		viewPrototype.setMode.call(context, 'edit');

		expect(requestChatCompletion.mock.calls[0]?.[0].mode).toBe('ask');
		expect(context.selectedMode).toBe('edit');
		expect(context.inputEl.value).toBe('Next prompt');
		expect(abort).not.toHaveBeenCalled();
		pending.resolve({ content: 'Answer', reasoning: '' });
		await submission;
	});

	it('registers Mod+Enter on the Obsidian view scope only for the composer', () => {
		const parent = new Scope();
		const context = {
			app: { scope: parent },
			scope: null as Scope | null,
			inputEl: { value: 'Prompt' },
			handleComposerKeydown: vi.fn(),
		};

		viewPrototype.registerComposerScope.call(context);

		expect(context.scope).toBeInstanceOf(Scope);
		const scope = context.scope as unknown as {
			keys: Array<{
				modifiers: string[] | null;
				key: string | null;
				func(event: KeyboardEvent): unknown;
			}>;
		};
		const registration = scope.keys[0];
		expect(registration).toMatchObject({ modifiers: ['Mod'], key: 'Enter' });
		if (!registration) {
			throw new Error('Composer scope registration missing.');
		}
		const composerEvent = { target: context.inputEl } as unknown as KeyboardEvent;
		expect(registration.func(composerEvent)).toBe(false);
		expect(context.handleComposerKeydown).toHaveBeenCalledWith(composerEvent);
		expect(registration.func({ target: {} } as unknown as KeyboardEvent)).toBeUndefined();
		expect(context.handleComposerKeydown).toHaveBeenCalledOnce();
	});
});
