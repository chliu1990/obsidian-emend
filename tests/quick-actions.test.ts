import { describe, expect, it, vi } from 'vitest';
import { EmendChatView } from '../src/chat-view';
import { areQuickActionsDisabled, QUICK_ACTIONS } from '../src/quick-actions';
import type { ChatMessage, Mode } from '../src/types';

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
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				requestChatCompletion: vi.fn(async () => ({ applied: true, changeCount: 2 })),
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
				content: 'Edit applied — 2 changes tracked. Review in Track Changes.',
				mode: 'edit',
			},
		]);
		expect(savedSnapshots).toHaveLength(2);
		expect(savedSnapshots[1]?.every((message) => message.status === 'ready')).toBe(true);
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
