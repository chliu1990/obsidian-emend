import { MarkdownRenderer, Menu, MenuItem, Notice } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSession } from '../src/chat-sessions';
import {
	buildFullNoteDraftEstimate,
	formatDraftCapacitySummary,
} from '../src/context-capacity-ui';
import type { LoadedChatConversation } from '../src/conversation-store';
import type EmendPlugin from '../src/main';
import type {
	ChatStreamResult,
	ReadOnlySubmission,
} from '../src/request-coordinator';
import type { ChatMessage, ProviderHistoryMessage } from '../src/types';
import { WEB_SEARCH_DISCLOSURE } from '../src/web-search';
import {
	closePublicChatViewFixtures,
	createPublicChatViewFixture,
	deferred,
	FakeElement,
	findChatInput,
	findElements,
	findMessageElements,
	findMessageNode,
	findSendButton,
	findSessionButton,
	findSessionSelect,
	loadedConversation,
	makeSession,
	messageContentElements,
	textOf,
	type PublicChatViewFixture,
} from './helpers/chat-view-public-fixture';

function noticeMessages(): string[] {
	return (Notice as unknown as { messages: string[] }).messages;
}

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

type SessionChatResult = Pick<ChatStreamResult, 'content' | 'reasoning'> &
	Partial<ChatStreamResult>;

type ChatViewMenu = Menu & {
	items: Array<ChatViewMenuItem | 'separator'>;
};

type ChatViewMenuItem = MenuItem & {
	title: string;
	clickHandler: (event: MouseEvent | KeyboardEvent) => unknown;
};

const chatViewMenus = Menu as unknown as { instances: ChatViewMenu[] };

function findWritingTrigger(contentEl: FakeElement): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) => element.className.split(' ').includes('emend-chat-writing-trigger'),
	)[0];
}

function findSubmissionButton(
	contentEl: FakeElement,
	label: 'Send' | 'Stop' | 'Stopping',
): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) => element.tagName === 'button' && element.attributes['aria-label'] === label,
	)[0];
}

function chooseWritingMenuItem(contentEl: FakeElement, title: string): void {
	findWritingTrigger(contentEl)?.dispatch('click');
	const menu = chatViewMenus.instances.at(-1);
	if (!menu) {
		throw new Error('The writing trigger did not open a menu.');
	}
	const item = menu.items.find(
		(candidate): candidate is ChatViewMenuItem =>
			candidate instanceof MenuItem && candidate.title === title,
	);
	if (!item) {
		throw new Error(`Missing writing menu item: ${title}`);
	}
	item.clickHandler({} as MouseEvent);
}

function findCapacitySummary(contentEl: FakeElement): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) => element.className.split(' ').includes('emend-context-capacity-summary'),
	)[0];
}

function relatedNotePaths(contentEl: FakeElement): string[] {
	return findElements(
		contentEl,
		(element) => element.className.split(' ').includes('emend-chat-related-notes-path'),
	).map((element) => element.textContent);
}

function expectedFullNoteCapacity(
	fixture: PublicChatViewFixture,
	session: ChatSession,
	prompt: string,
): string {
	const history: ProviderHistoryMessage[] = session.messages
		.filter((item) => item.status === 'ready')
		.map((item) => ({
			role: item.role,
			content: item.content,
			mode: item.mode,
			origin: item.role === 'user'
				? 'user'
				: item.mode === 'edit' ? 'local-edit-status' : 'model',
		}));
	return formatDraftCapacitySummary(buildFullNoteDraftEstimate({
		provider: fixture.settings.providers[fixture.settings.activeProvider],
		context: fixture.captureChatContext(),
		prompt,
		history,
	}));
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

describe('EmendChatView public session and stream generation', () => {
	beforeEach(() => {
		vi.stubGlobal('window', { setTimeout, clearTimeout });
		vi.spyOn(MarkdownRenderer, 'render').mockImplementation(
			async (_app, markdown, element) => {
				element.textContent = markdown;
			},
		);
		noticeMessages().length = 0;
		chatViewMenus.instances.length = 0;
	});

	afterEach(async () => {
		await closePublicChatViewFixtures();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('applies only the latest note load during rapid note switches', async () => {
		const fixture = createPublicChatViewFixture({ activePath: 'First.md' });
		const first = deferred<LoadedChatConversation>();
		const second = deferred<LoadedChatConversation>();
		fixture.conversationStore.loadConversation.mockImplementation(
			async (path: string) => path === 'First.md' ? first.promise : second.promise,
		);

		const firstLoad = fixture.open();
		fixture.setActivePath('Second.md');
		const secondLoad = fixture.view.refreshTargetNote();
		second.resolve(loadedConversation([
			makeSession('second-session', [message('second', 'Second.md')]),
			makeSession('second-other'),
		]));
		await secondLoad;
		first.resolve(loadedConversation([
			makeSession('first-session', [message('first', 'First.md')]),
		]));
		await firstLoad;

		const context = findElements(
			fixture.contentEl,
			(element) => element.className.split(' ').includes('emend-chat-context'),
		)[0];
		expect(context?.textContent).toContain('Second.md');
		expect(findSessionSelect(fixture.contentEl)?.value).toBe('second-session');
		expect(findMessageNode(fixture.contentEl, 'second')).toBeDefined();
		expect(findMessageNode(fixture.contentEl, 'first')).toBeUndefined();
		expect(findMessageElements(fixture.contentEl).map(textOf).join('\n')).not.toContain('first');
		const input = findChatInput(fixture.contentEl);
		expect(input?.disabled).toBe(false);
		expect(findSessionSelect(fixture.contentEl)?.disabled).toBe(false);
		expect(findWritingTrigger(fixture.contentEl)?.disabled).toBe(false);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(false);
	});

	it('does not apply a pending load after the view closes', async () => {
		const fixture = createPublicChatViewFixture();
		const pending = deferred<LoadedChatConversation>();
		fixture.conversationStore.loadConversation.mockReturnValue(pending.promise);

		const opening = fixture.open();
		await fixture.close();
		pending.resolve(loadedConversation([
			makeSession('stale-session', [message('stale', 'Note.md')]),
		]));
		await opening;

		expect(findMessageElements(fixture.contentEl)).toEqual([]);
		expect(textOf(fixture.contentEl)).not.toContain('stale');
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.contentEl.children).toEqual([]);
		expect(fixture.contentEl.textContent).toBe('');
	});

	it('restores active session drafts, policies, Related notes, capacity, and origin history through the public view', async () => {
		const fixture = createPublicChatViewFixture({
			activePath: 'A.md',
			sourceText: 'Source selected text',
			selectedText: 'selected text',
		});
		const first = makeSession('a1', [message('first-answer', 'A.md')]);
		const second = makeSession('a2', [message('second-answer', 'A.md')]);
		fixture.conversationStore.loadConversation.mockResolvedValue(
			loadedConversation([first, second], 'a2'),
		);
		fixture.conversationStore.appendReadyMessage.mockImplementation(
			async (_notePath, sessionId, appended) => {
				const session = sessionId === 'a1' ? first : second;
				return { ...session, messages: [...session.messages, appended] };
			},
		);
		fixture.requestChatCompletion.mockImplementation((async (
			submission: ReadOnlySubmission,
		) => {
			submission.callbacks.onContent('Follow-up answer');
			return { content: 'Follow-up answer', reasoning: '' };
		}) as unknown as EmendPlugin['requestChatCompletion']);
		await fixture.open();

		chooseWritingMenuItem(fixture.contentEl, 'Chat · Selection');
		chooseWritingMenuItem(fixture.contentEl, 'Web Auto');
		chooseWritingMenuItem(fixture.contentEl, 'Edit · Selection · Full note');
		const selectionContextTooltip =
			`Full note is sent; only the selection is edited.\n${WEB_SEARCH_DISCLOSURE}`;
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe(
			'Edit · Selection · Full note',
		);
		expect(findWritingTrigger(fixture.contentEl)?.title).toBe(selectionContextTooltip);
		const input = findChatInput(fixture.contentEl);
		if (!input) {
			throw new Error('Chat input missing.');
		}
		input.value = 'Second draft';
		input.dispatch('input');
		fixture.additionalNotesStore.add('A.md', 'Reference.md');

		await fixture.view.switchActiveSession('a1');
		expect(findSessionSelect(fixture.contentEl)?.value).toBe('a1');
		expect(findChatInput(fixture.contentEl)?.value).toBe('');
		expect(findMessageNode(fixture.contentEl, 'first-answer')).toBeDefined();
		expect(findMessageNode(fixture.contentEl, 'second-answer')).toBeUndefined();
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe(
			'Edit · Selection · Full note',
		);
		expect(findWritingTrigger(fixture.contentEl)?.title).toBe(selectionContextTooltip);
		expect(relatedNotePaths(fixture.contentEl)).toEqual(['Reference.md']);
		expect(fixture.additionalNotesStore.list('A.md')).toEqual(['Reference.md']);
		const firstInput = findChatInput(fixture.contentEl);
		if (!firstInput) {
			throw new Error('Chat input missing after session switch.');
		}
		firstInput.value = 'First draft';
		firstInput.dispatch('input');

		await fixture.view.switchActiveSession('a2');
		expect(findSessionSelect(fixture.contentEl)?.value).toBe('a2');
		expect(findChatInput(fixture.contentEl)?.value).toBe('Second draft');
		expect(findMessageNode(fixture.contentEl, 'second-answer')).toBeDefined();
		expect(findMessageNode(fixture.contentEl, 'first-answer')).toBeUndefined();
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe(
			'Edit · Selection · Full note',
		);
		expect(findWritingTrigger(fixture.contentEl)?.title).toBe(selectionContextTooltip);

		chooseWritingMenuItem(fixture.contentEl, 'Edit · Full note');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Full note');
		const firstCapacity = expectedFullNoteCapacity(fixture, first, 'First draft');
		const secondCapacity = expectedFullNoteCapacity(fixture, second, 'Second draft');
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(secondCapacity);

		await fixture.view.switchActiveSession('a1');
		expect(findSessionSelect(fixture.contentEl)?.value).toBe('a1');
		expect(findChatInput(fixture.contentEl)?.value).toBe('First draft');
		expect(findMessageNode(fixture.contentEl, 'first-answer')).toBeDefined();
		expect(findMessageNode(fixture.contentEl, 'second-answer')).toBeUndefined();
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Full note');
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(firstCapacity);
		expect(relatedNotePaths(fixture.contentEl)).toEqual(['Reference.md']);

		await fixture.view.switchActiveSession('a2');
		expect(findSessionSelect(fixture.contentEl)?.value).toBe('a2');
		expect(findChatInput(fixture.contentEl)?.value).toBe('Second draft');
		expect(findMessageNode(fixture.contentEl, 'second-answer')).toBeDefined();
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Full note');
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(secondCapacity);

		await fixture.view.switchActiveSession('a1');
		expect(findChatInput(fixture.contentEl)?.value).toBe('First draft');
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(firstCapacity);
		await fixture.view.switchActiveSession('a2');
		expect(findChatInput(fixture.contentEl)?.value).toBe('Second draft');
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(secondCapacity);

		fixture.view.setMode('ask');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe(
			'Chat · Selection · Auto search',
		);
		fixture.view.setMode('edit');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Full note');
		fixture.view.setMode('ask');
		const followUpInput = findChatInput(fixture.contentEl);
		if (!followUpInput) {
			throw new Error('Chat input missing before follow-up.');
		}
		followUpInput.value = 'Follow-up question';
		await fixture.view.submitPrompt();

		const submission = fixture.requestChatCompletion.mock.calls[0]?.[0];
		if (!submission || submission.mode === 'edit') {
			throw new Error('Session follow-up was not submitted.');
		}
		expect(submission.history).toEqual([
			{ role: 'assistant', content: 'second-answer', mode: 'ask', origin: 'model' },
		]);
		expect(submission.history).not.toContainEqual(
			expect.objectContaining({ content: 'first-answer' }),
		);
	});

	it('isolates stale stream callbacks and finally cleanup from a newer request after A → B → A', async () => {
		const fixture = createPublicChatViewFixture({ activePath: 'A.md' });
		const first = makeSession('a1');
		const second = makeSession('a2');
		const other = makeSession('b1');
		fixture.conversationStore.loadConversation.mockImplementation(async (notePath: string) =>
			notePath === 'A.md'
				? loadedConversation([first, second], 'a1')
				: loadedConversation([other]),
		);
		fixture.conversationStore.appendReadyMessage.mockImplementation(
			async (_notePath, sessionId, appended) => {
				const session = sessionId === 'a1' ? first : sessionId === 'a2' ? second : other;
				return { ...session, messages: [...session.messages, appended] };
			},
		);
		const oldResponse = deferred<SessionChatResult>();
		const newResponse = deferred<SessionChatResult>();
		let oldCallbacks: ReadOnlySubmission['callbacks'] | undefined;
		let newCallbacks: ReadOnlySubmission['callbacks'] | undefined;
		let oldSignal: AbortSignal | undefined;
		let newSignal: AbortSignal | undefined;
		fixture.requestChatCompletion
			.mockImplementationOnce((async (submission: ReadOnlySubmission) => {
				oldCallbacks = submission.callbacks;
				oldSignal = submission.signal;
				return oldResponse.promise;
			}) as unknown as EmendPlugin['requestChatCompletion'])
			.mockImplementationOnce((async (submission: ReadOnlySubmission) => {
				newCallbacks = submission.callbacks;
				newSignal = submission.signal;
				return newResponse.promise;
			}) as unknown as EmendPlugin['requestChatCompletion']);
		await fixture.open();

		const oldSubmission = fixture.view.submitPrompt('Old question');
		await vi.waitFor(() => expect(fixture.requestChatCompletion).toHaveBeenCalledOnce());
		const oldLoading = findMessageElements(fixture.contentEl).filter(
			(element) => element.className.split(' ').includes('is-loading'),
		);
		expect(oldLoading).toHaveLength(1);
		const oldLoadingId = oldLoading[0]?.attributes['data-message-id'];
		expect(oldLoadingId).toBeDefined();
		expect(oldSignal?.aborted).toBe(false);

		fixture.setActivePath('B.md');
		await fixture.view.refreshTargetNote();
		fixture.setActivePath('A.md');
		await fixture.view.refreshTargetNote();
		const newSubmission = fixture.view.submitPrompt('New question');
		await vi.waitFor(() => expect(fixture.requestChatCompletion).toHaveBeenCalledTimes(2));
		const newLoadingId = findMessageElements(fixture.contentEl)
			.filter((element) => element.className.split(' ').includes('is-loading'))
			.map((element) => element.attributes['data-message-id'])
			.find((id) => id !== oldLoadingId);
		expect(newLoadingId).toBeDefined();
		if (!oldLoadingId || !newLoadingId) {
			throw new Error('Loading message IDs missing.');
		}
		const oldNodeBeforeStaleCallback = findMessageNode(fixture.contentEl, oldLoadingId);
		expect(oldNodeBeforeStaleCallback).toBeDefined();
		expect(messageContentElements(oldNodeBeforeStaleCallback!)).toHaveLength(1);
		expect(findMessageNode(fixture.contentEl, newLoadingId)).toBeDefined();

		oldCallbacks?.onContent('STALE_STREAM_CONTENT');
		fixture.flushAnimationFrame();
		oldResponse.resolve({ content: 'STALE_STREAM_CONTENT', reasoning: '' });
		await oldSubmission;

		const oldNode = findMessageNode(fixture.contentEl, oldLoadingId);
		const newNode = findMessageNode(fixture.contentEl, newLoadingId);
		expect(textOf(oldNode!)).not.toContain('STALE_STREAM_CONTENT');
		expect(textOf(newNode!)).not.toContain('STALE_STREAM_CONTENT');
		expect(textOf(fixture.contentEl)).not.toContain('STALE_STREAM_CONTENT');
		for (const call of fixture.conversationStore.appendReadyMessage.mock.calls) {
			expect(call[2].content).not.toContain('STALE_STREAM_CONTENT');
		}
		expect(newSignal?.aborted).toBe(false);
		expect(findSubmissionButton(fixture.contentEl, 'Stop')).toBeDefined();
		expect(findSubmissionButton(fixture.contentEl, 'Send')).toBeUndefined();

		newCallbacks?.onContent('New answer');
		fixture.flushAnimationFrame();
		newResponse.resolve({ content: 'New answer', reasoning: '' });
		await newSubmission;

		const readyAnswers = findMessageElements(fixture.contentEl).filter(
			(element) => element.className.split(' ').includes('is-assistant')
				&& element.className.split(' ').includes('is-ready'),
		);
		expect(readyAnswers).toHaveLength(1);
		expect(readyAnswers[0]?.attributes['data-message-id']).toBe(newLoadingId);
		expect(textOf(readyAnswers[0]!)).toContain('New answer');
		expect(findMessageNode(fixture.contentEl, oldLoadingId)?.className.split(' '))
			.toContain('is-stopped');
	});

	it('refuses a session switch while a request is in flight', async () => {
		const fixture = createPublicChatViewFixture({ activePath: 'A.md' });
		const first = makeSession('a1');
		const second = makeSession('a2');
		fixture.conversationStore.loadConversation.mockResolvedValue(
			loadedConversation([first, second], 'a1'),
		);
		fixture.conversationStore.appendReadyMessage.mockImplementation(
			async (_notePath, _sessionId, appended) => ({
				...first,
				messages: [...first.messages, appended],
			}),
		);
		const response = deferred<SessionChatResult>();
		let requestSignal: AbortSignal | undefined;
		let streamContent: ((text: string) => void) | undefined;
		fixture.requestChatCompletion.mockImplementationOnce((async (
			submission: ReadOnlySubmission,
		) => {
			requestSignal = submission.signal;
			streamContent = submission.callbacks.onContent;
			return response.promise;
		}) as unknown as EmendPlugin['requestChatCompletion']);
		await fixture.open();

		const submission = fixture.view.submitPrompt('Streaming question');
		await vi.waitFor(() => expect(fixture.requestChatCompletion).toHaveBeenCalledOnce());
		const sessionSelect = findSessionSelect(fixture.contentEl);
		if (!sessionSelect) {
			throw new Error('Chat session selector missing.');
		}
		expect(sessionSelect.value).toBe('a1');
		const loading = findMessageElements(fixture.contentEl).filter(
			(element) => element.className.split(' ').includes('is-loading'),
		);
		expect(loading).toHaveLength(1);
		const loadingId = loading[0]?.attributes['data-message-id'];
		sessionSelect.value = 'a2';

		await fixture.view.switchActiveSession('a2');

		expect(sessionSelect.value).toBe('a1');
		expect(sessionSelect.disabled).toBe(true);
		expect(fixture.conversationStore.setActiveSession).not.toHaveBeenCalled();
		expect(requestSignal?.aborted).toBe(false);
		expect(findSubmissionButton(fixture.contentEl, 'Stop')).toBeDefined();
		expect(findMessageNode(fixture.contentEl, loadingId!)).toBe(loading[0]);

		streamContent?.('Streamed answer');
		response.resolve({ content: 'Streamed answer', reasoning: '' });
		await submission;

		const answer = findMessageNode(fixture.contentEl, loadingId!);
		expect(answer?.className.split(' ')).toContain('is-ready');
		expect(textOf(answer!)).toContain('Streamed answer');
		expect(findSessionSelect(fixture.contentEl)?.value).toBe('a1');
	});
});
