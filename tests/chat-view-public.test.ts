import { MarkdownRenderer, Notice } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type EmendPlugin from '../src/main';
import type {
	ChatStreamResult,
	ReadOnlySubmission,
} from '../src/request-coordinator';
import {
	closePublicChatViewFixtures,
	createPublicChatViewFixture,
	findChatInput,
	findElements,
	findMessageElements,
	findSendButton,
	findSessionButton,
	findSessionSelect,
	textOf,
} from './helpers/chat-view-public-fixture';

function noticeMessages(): string[] {
	return (Notice as unknown as { messages: string[] }).messages;
}

describe('EmendChatView public thread-load recovery', () => {
	beforeEach(() => {
		vi.stubGlobal('window', { setTimeout, clearTimeout });
		vi.spyOn(MarkdownRenderer, 'render').mockImplementation(
			async (_app, markdown, element) => {
				element.textContent = markdown;
			},
		);
		noticeMessages().length = 0;
	});

	afterEach(async () => {
		await closePublicChatViewFixtures();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('recovers a usable transient session when the thread load fails', async () => {
		const fixture = createPublicChatViewFixture();
		fixture.conversationStore.loadConversation.mockRejectedValue(
			new Error('Unreadable thread'),
		);
		const respond = async (submission: ReadOnlySubmission): Promise<ChatStreamResult> => {
			submission.callbacks.onContent('Answer');
			return {
				content: 'Answer',
				reasoning: '',
				usage: {
					promptTokens: 2,
					completionTokens: 1,
					totalTokens: 3,
					source: 'provider',
				},
				failedExtractions: 0,
				failedSearches: 0,
				maxToolCalls: 0,
				skippedWebCalls: 0,
				omittedEvidence: false,
			};
		};
		fixture.requestChatCompletion.mockImplementation(
			respond as unknown as EmendPlugin['requestChatCompletion'],
		);

		await fixture.open();

		const input = findChatInput(fixture.contentEl);
		expect(input).toBeDefined();
		expect(noticeMessages()).toEqual([
			'Emend: Could not load this chat. Unreadable thread',
		]);
		if (!input) {
			throw new Error('Chat input missing.');
		}
		input.value = 'Question';
		input.dispatch('input');
		const send = findSendButton(fixture.contentEl);
		expect(send?.disabled).toBe(false);
		send?.dispatch('click');

		await vi.waitFor(() => {
			expect(fixture.conversationStore.appendReadyMessage).toHaveBeenCalledOnce();
		});
		await vi.waitFor(() => {
			const answer = findMessageElements(fixture.contentEl).find((element) =>
				element.className.split(' ').includes('is-assistant')
				&& element.className.split(' ').includes('is-ready')
			);
			expect(answer).toBeDefined();
			expect(textOf(answer!)).toContain('Answer');
		});

		expect(fixture.requestChatCompletion).toHaveBeenCalledOnce();
		const created = fixture.conversationStore.createSession.mock.calls[0]?.[1];
		expect(created?.messages).toHaveLength(1);
		expect(created?.messages[0]).toMatchObject({
			role: 'user',
			content: 'Question',
			status: 'ready',
		});
		expect(
			fixture.conversationStore.appendReadyMessage.mock.calls[0]?.[2],
		).toMatchObject({ role: 'assistant', content: 'Answer', status: 'ready' });
		const createOrder = fixture.conversationStore.createSession.mock.invocationCallOrder[0]!;
		const requestOrder = fixture.requestChatCompletion.mock.invocationCallOrder[0]!;
		const appendOrder = fixture.conversationStore.appendReadyMessage.mock.invocationCallOrder[0]!;
		expect(createOrder).toBeLessThan(requestOrder);
		expect(requestOrder).toBeLessThan(appendOrder);
	});

	it('shows New chat as usable after a failed thread load', async () => {
		const fixture = createPublicChatViewFixture();
		fixture.conversationStore.loadConversation.mockRejectedValue(
			new Error('Unreadable thread'),
		);

		await fixture.open();

		const sessionSelect = findSessionSelect(fixture.contentEl);
		expect(sessionSelect).toBeDefined();
		expect(
			findElements(fixture.contentEl, (element) => element.tagName === 'option')
				.map((element) => element.textContent),
		).toEqual(['New chat']);
		expect(findSessionButton(fixture.contentEl, 'New chat session')?.disabled).toBe(false);
		expect(findSessionButton(fixture.contentEl, 'Rename chat session')?.disabled).toBe(false);
		expect(findSessionButton(fixture.contentEl, 'Delete chat session')?.disabled).toBe(false);
		const input = findChatInput(fixture.contentEl);
		if (!input) {
			throw new Error('Chat input missing.');
		}
		input.value = 'Question';
		input.dispatch('input');
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(false);
	});
});
