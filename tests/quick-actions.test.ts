import { TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { EmendChatView } from '../src/chat-view';
import { areQuickActionsDisabled, QUICK_ACTIONS } from '../src/quick-actions';
import type {
	SelectionEditCallbacks,
	SelectionEditorAdapter,
} from '../src/selection-editor';
import type {
	ChatMessage,
	Mode,
	ProviderHistoryMessage,
	SelectionSnapshot,
} from '../src/types';

const viewPrototype = EmendChatView.prototype as unknown as {
	submitPrompt(this: unknown, prompt?: string): Promise<void>;
	submitQuickAction(this: unknown, action: (typeof QUICK_ACTIONS)[number]): Promise<void>;
};

describe('quick action catalog', () => {
	it('provides the exact stable IDs, labels, and forced Edit mode', () => {
		expect(QUICK_ACTIONS.map(({ id, label, mode }) => ({ id, label, mode }))).toEqual([
			{ id: 'fix-grammar', label: 'Fix grammar', mode: 'edit' },
			{ id: 'make-concise', label: 'Make concise', mode: 'edit' },
			{ id: 'add-examples', label: 'Add examples', mode: 'edit' },
		]);
	});

	it.each(QUICK_ACTIONS)('$id has a deterministic nonempty prompt', (action) => {
		expect(action.prompt.trim()).not.toBe('');
		expect(action.prompt).toBe(QUICK_ACTIONS.find(({ id }) => id === action.id)?.prompt);
	});
});

describe('quick action submission', () => {
	it.each(QUICK_ACTIONS)('$id uses the normal submission path exactly once from a non-Edit mode', async (action) => {
		const context = {
			selectedMode: 'brainstorm' as Mode,
			notePath: 'Note.md',
			isSending: false,
			isThreadLoading: false,
			submitPrompt: vi.fn(async (_prompt: string) => {}),
		};

		await viewPrototype.submitQuickAction.call(context, action);

		expect(context.selectedMode).toBe('edit');
		expect(context.submitPrompt).toHaveBeenCalledTimes(1);
		expect(context.submitPrompt).toHaveBeenCalledWith(action.prompt);
	});

	it('displays and persists the prompt and concise Edit result through normal submission', async () => {
		const action = QUICK_ACTIONS[0];
		const savedSnapshots: ChatMessage[][] = [];
		const context = {
			inputEl: { value: 'Unrelated composer text' },
			selectedMode: 'ask' as Mode,
			notePath: 'Note.md',
			isSending: false,
			isThreadLoading: false,
			messages: [] as ChatMessage[],
			plugin: {
				captureChatContext: () => ({
					file: { path: 'Note.md' },
					sourceText: 'Alpha beta.',
				}),
				requestChatCompletion: vi.fn(async () => ({
					applied: true,
					changeCount: 2,
					summaryItems: [{ type: 'replace', start: 0, end: 5 }],
				})),
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(async (_path: string, messages: ChatMessage[]) => {
				savedSnapshots.push(messages.map((message) => ({ ...message })));
			}),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			submitPrompt: vi.fn(),
		};
		context.submitPrompt = vi.fn((prompt?: string) =>
			viewPrototype.submitPrompt.call(context, prompt),
		);

		await viewPrototype.submitQuickAction.call(context, action);

		expect(context.submitPrompt).toHaveBeenCalledTimes(1);
		expect(context.plugin.requestChatCompletion).toHaveBeenCalledTimes(1);
		expect(context.plugin.requestChatCompletion).toHaveBeenCalledWith(
			expect.objectContaining({ mode: 'edit', prompt: action.prompt, history: [] }),
		);
		expect(context.messages.map(({ role, content, mode }) => ({ role, content, mode }))).toEqual([
			{ role: 'user', content: action.prompt, mode: 'edit' },
			{
				role: 'assistant',
				content: 'Edit applied — 2 changes tracked. Review in Track Changes.\nTarget: Full note.\n\n- Replaced line 1.',
				mode: 'edit',
			},
		]);
		expect(savedSnapshots).toHaveLength(2);
		expect(savedSnapshots[1]?.every((message) => message.status === 'ready')).toBe(true);
	});

	it.each(QUICK_ACTIONS)('$id follows visible Selection once with Web off', async (action) => {
		const file = new TFile();
		file.path = 'Note.md';
		const snapshot = {
			file,
			fullText: 'Alpha beta.',
			selectedText: 'beta',
			from: 6,
			to: 10,
		};
		const editor = {
			readCurrentText: () => snapshot.fullText,
			isTargetCurrent: () => true,
			replaceRange: vi.fn(),
		};
		const requestSelectionEdit = vi.fn(async (
			_snapshot: SelectionSnapshot,
			_prompt: string,
			_signal: AbortSignal,
			_editor: SelectionEditorAdapter,
			_additionalNotePaths: readonly string[],
			_history: readonly ProviderHistoryMessage[],
			_callbacks?: SelectionEditCallbacks,
		) => ({
			applied: true,
			changeCount: 1,
			usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
		}));
		const requestChatCompletion = vi.fn(async () => ({ applied: false, changeCount: 0 }));
		const captureChatContext = vi.fn(() => ({ file: { path: 'Note.md' } }));
		const context = {
			inputEl: { value: 'Unrelated composer text' },
			selectedMode: 'ask' as Mode,
			webSearchMode: 'auto' as const,
			displayedEditTarget: 'selection' as const,
			notePath: 'Note.md',
			isSending: false,
			isThreadLoading: false,
			messages: [] as ChatMessage[],
			plugin: {
				captureChatContext,
				captureSelectionEditTarget: vi.fn(() => ({ snapshot, editor })),
				requestChatCompletion,
				requestSelectionEdit,
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(async () => undefined),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			submitPrompt: vi.fn(),
		};
		context.submitPrompt = vi.fn((prompt?: string) =>
			viewPrototype.submitPrompt.call(context, prompt),
		);

		await viewPrototype.submitQuickAction.call(context, action);

		expect(context.submitPrompt).toHaveBeenCalledTimes(1);
		expect(context.submitPrompt).toHaveBeenCalledWith(action.prompt);
		expect(context.selectedMode).toBe('edit');
		expect(requestSelectionEdit).toHaveBeenCalledTimes(1);
		const args = requestSelectionEdit.mock.calls[0];
		expect(args?.[0]).toBe(snapshot);
		expect(args?.[1]).toBe(action.prompt);
		expect(args?.[2]).toBeInstanceOf(AbortSignal);
		expect(args?.[3]).toBe(editor);
		expect(args?.[4]).toEqual([]);
		expect(args?.[5]).toEqual([]);
		expect(typeof args?.[6]?.onReasoning).toBe('function');
		expect(typeof args?.[6]?.onRetry).toBe('function');
		expect(requestChatCompletion).not.toHaveBeenCalled();
		expect(captureChatContext).not.toHaveBeenCalled();
		expect(context.messages).toHaveLength(2);
		expect(context.messages[0]).toMatchObject({
			role: 'user',
			mode: 'edit',
			content: action.prompt,
		});
		expect(context.messages[0]?.webSearchMode).toBeUndefined();
	});
});

describe('quick action availability', () => {
	it.each([
		{ notePath: null, isSending: false, isThreadLoading: false },
		{ notePath: 'Note.md', isSending: true, isThreadLoading: false },
		{ notePath: 'Note.md', isSending: false, isThreadLoading: true },
	])('disables actions for unavailable state %#', (state) => {
		expect(areQuickActionsDisabled(state)).toBe(true);
	});

	it('enables actions only with a loaded note and no pending work', () => {
		expect(areQuickActionsDisabled({
			notePath: 'Note.md',
			isSending: false,
			isThreadLoading: false,
		})).toBe(false);
	});

	it.each([
		{ notePath: null, isSending: false, isThreadLoading: false },
		{ notePath: 'Note.md', isSending: true, isThreadLoading: false },
		{ notePath: 'Note.md', isSending: false, isThreadLoading: true },
	])('does not submit while unavailable %#', async (state) => {
		const context = {
			...state,
			selectedMode: 'discuss' as Mode,
			submitPrompt: vi.fn(async (_prompt: string) => {}),
		};

		await viewPrototype.submitQuickAction.call(context, QUICK_ACTIONS[0]);

		expect(context.submitPrompt).not.toHaveBeenCalled();
		expect(context.selectedMode).toBe('discuss');
	});
});
