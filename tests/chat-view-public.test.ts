import { MarkdownRenderer, Menu, MenuItem, Notice } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSession } from '../src/chat-sessions';
import {
	buildFullNoteDraftEstimate,
	formatDraftCapacitySummary,
} from '../src/context-capacity-ui';
import type { LoadedChatConversation } from '../src/conversation-store';
import type EmendPlugin from '../src/main';
import { operationEditStrategy } from '../src/operation-edit-strategy';
import type {
	AiProviderRequest,
	StreamEvent,
	StreamResult,
} from '../src/provider-stream';
import { QUICK_ACTIONS } from '../src/quick-actions';
import {
	EditRequestCoordinator,
	type ChatStreamResult,
	type EditSubmission,
	type ReadOnlySubmission,
} from '../src/request-coordinator';
import type {
	ChatMessage,
	ProviderConfig,
	ProviderHistoryMessage,
} from '../src/types';
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
	findMessagesScroller,
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

function findQuickActionButton(
	contentEl: FakeElement,
	id: string,
): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) => element.attributes['data-action-id'] === id,
	)[0];
}

function setChatInput(fixture: PublicChatViewFixture, value: string): FakeElement {
	const input = findChatInput(fixture.contentEl);
	if (!input) {
		throw new Error('Chat input missing.');
	}
	input.value = value;
	input.dispatch('input');
	return input;
}

function captureReadyMessageSaves(
	fixture: PublicChatViewFixture,
	session: ChatSession,
): ChatMessage[][] {
	const savedMessages = session.messages.map((item) => ({ ...item }));
	const savedSnapshots: ChatMessage[][] = [];
	fixture.conversationStore.loadConversation.mockResolvedValue(
		loadedConversation([session]),
	);
	fixture.conversationStore.appendReadyMessage.mockImplementation(
		async (_notePath, _sessionId, appended, appendOptions) => {
			appendOptions?.signal?.throwIfAborted();
			savedMessages.push({ ...appended });
			savedSnapshots.push(savedMessages.map((item) => ({ ...item })));
			return {
				...session,
				messages: savedMessages.map((item) => ({ ...item })),
			};
		},
	);
	return savedSnapshots;
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


describe('EmendChatView public modification submission and persistence', () => {
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

	it('saves the ready user message and completed assistant message with usage', async () => {
		const fixture = createPublicChatViewFixture();
		const savedSnapshots = captureReadyMessageSaves(fixture, makeSession());
		fixture.requestChatCompletion.mockImplementation((async (
			submission: ReadOnlySubmission,
		) => {
			submission.callbacks.onContent('Answer');
			return {
				content: 'Answer',
				reasoning: '',
				usage: {
					promptTokens: 3,
					completionTokens: 1,
					totalTokens: 4,
					source: 'provider',
				},
			};
		}) as unknown as EmendPlugin['requestChatCompletion']);
		await fixture.open();

		setChatInput(fixture, 'Question');
		findSendButton(fixture.contentEl)?.dispatch('click');
		await vi.waitFor(() => expect(savedSnapshots).toHaveLength(2));

		expect(savedSnapshots.map((snapshot) => snapshot.map(
			({ role, status, content }) => ({ role, status, content }),
		))).toEqual([
			[{ role: 'user', status: 'ready', content: 'Question' }],
			[
				{ role: 'user', status: 'ready', content: 'Question' },
				{ role: 'assistant', status: 'ready', content: 'Answer' },
			],
		]);
		expect(savedSnapshots[1]?.[1]?.usage).toEqual({
			promptTokens: 3,
			completionTokens: 1,
			totalTokens: 4,
			source: 'provider',
		});
		expect(savedSnapshots.flat().every((item) => item.timestamp > 0)).toBe(true);
		const usageFooters = findElements(
			fixture.contentEl,
			(element) => element.className.split(' ').includes('emend-chat-message-usage'),
		);
		expect(usageFooters).toHaveLength(1);
		expect(usageFooters[0]?.textContent).toBe(
			'Provider usage · 4 total · 3 prompt · 1 completion',
		);
	});

	it('persists one concise corrected Edit summary with aggregate usage and clean later history', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			defaultMode: 'edit',
		});
		const savedSnapshots = captureReadyMessageSaves(fixture, makeSession());
		const validResponse = JSON.stringify([
			{ type: 'replace', target: 'beta', replacement: 'delta' },
		]);
		const invalidReasoning = 'INVALID_ROUND_REASONING';
		const validReasoning = 'VALID_ROUND_REASONING';
		const request = vi.fn(async (
			_request: AiProviderRequest,
			callbacks: { onEvent(event: StreamEvent): void },
		): Promise<StreamResult> => {
			callbacks.onEvent({ type: 'reasoning', text: invalidReasoning });
			return { content: 'private invalid response', reasoning: invalidReasoning };
		});
		request
			.mockImplementationOnce(async (_request, callbacks) => {
				callbacks.onEvent({ type: 'reasoning', text: invalidReasoning });
				return {
					content: 'private invalid response',
					reasoning: invalidReasoning,
					usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
				};
			})
			.mockImplementationOnce(async (_request, callbacks) => {
				callbacks.onEvent({ type: 'reasoning', text: validReasoning });
				return {
					content: validResponse,
					reasoning: validReasoning,
					usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
				};
			});
		const editProvider: ProviderConfig = {
			name: 'Local test provider',
			baseUrl: 'http://127.0.0.1:8787/v1',
			apiKey: 'dummy-test-key',
			model: 'dummy-model',
			reasoningEffort: 'low',
			requestUsage: true,
			discoveredModels: [],
			contextWindowTokens: null,
			outputReserveTokens: null,
			contextCapacityInvalid: false,
		};
		const writer = {
			readCurrentText: vi.fn(async () => 'Alpha beta.'),
			write: vi.fn(async () => undefined),
			isTargetCurrent: vi.fn(() => true),
		};
		const editCoordinator = new EditRequestCoordinator({
			provider: editProvider,
			loadAdditionalNotes: async () => [],
			loadInstructions: async () => ({ skillTexts: new Map() }),
			request,
			writer,
			editStrategy: operationEditStrategy,
		});
		fixture.requestChatCompletion.mockImplementation((async (
			submission: EditSubmission | ReadOnlySubmission,
		) => {
			if (submission.mode === 'edit') {
				return editCoordinator.submit(submission);
			}
			submission.callbacks.onContent('Answer');
			return {
				content: 'Answer',
				reasoning: '',
				usage: {
					promptTokens: 3,
					completionTokens: 1,
					totalTokens: 4,
					source: 'provider',
				},
			};
		}) as unknown as EmendPlugin['requestChatCompletion']);
		const summary = 'Edit applied — 1 changes tracked. Review in Track Changes.\nTarget: Full note.\n\n- Replaced line 1.';
		await fixture.open();

		setChatInput(fixture, 'Edit note');
		await fixture.view.submitPrompt();

		expect(request).toHaveBeenCalledTimes(2);
		const editSubmission = fixture.requestChatCompletion.mock.calls[0]?.[0];
		if (!editSubmission || editSubmission.mode !== 'edit') {
			throw new Error('Full-note Edit submission missing.');
		}
		expect(writer.write).toHaveBeenCalledExactlyOnceWith(
			editSubmission.context.file,
			'Alpha {~~beta~>delta~~}.',
		);
		expect(savedSnapshots).toHaveLength(2);
		const savedUser = savedSnapshots[0]?.[0];
		const savedEdit = savedSnapshots[1]?.[1];
		if (!savedUser || !savedEdit) {
			throw new Error('Corrected Edit persistence snapshots missing.');
		}
		const expectedUser = {
			id: savedUser.id,
			role: 'user',
			content: 'Edit note',
			reasoning: '',
			mode: 'edit',
			sourcePath: 'Note.md',
			status: 'ready',
			timestamp: savedUser.timestamp,
		};
		const expectedEdit = {
			id: savedEdit.id,
			role: 'assistant',
			content: summary,
			reasoning: validReasoning,
			mode: 'edit',
			sourcePath: 'Note.md',
			status: 'ready',
			timestamp: savedEdit.timestamp,
			usage: {
				promptTokens: 30,
				completionTokens: 7,
				totalTokens: 37,
				source: 'provider',
			},
		};
		expect(savedSnapshots[0]).toEqual([expectedUser]);
		expect(savedSnapshots[1]).toEqual([expectedUser, expectedEdit]);
		const persistedEdit = JSON.stringify(savedSnapshots);
		expect(persistedEdit).not.toContain('private invalid response');
		expect(persistedEdit).not.toContain(validResponse);
		expect(persistedEdit).not.toContain(invalidReasoning);
		const editMessageId = savedSnapshots[1]?.[1]?.id;
		if (!editMessageId) {
			throw new Error('Persisted Edit assistant message missing.');
		}
		await vi.waitFor(() => {
			expect(textOf(findMessageNode(fixture.contentEl, editMessageId)!)).toContain(summary);
		});
		const renderedEdit = textOf(findMessageNode(fixture.contentEl, editMessageId)!);
		expect(renderedEdit).toContain(validReasoning);
		expect(renderedEdit).not.toContain('private invalid response');
		expect(renderedEdit).not.toContain(validResponse);
		expect(renderedEdit).not.toContain(invalidReasoning);

		chooseWritingMenuItem(fixture.contentEl, 'Chat');
		setChatInput(fixture, 'Next question');
		await fixture.view.submitPrompt();

		const nextSubmission = fixture.requestChatCompletion.mock.calls[1]?.[0];
		expect(nextSubmission?.history.map((item) => item.content)).toEqual([
			'Edit note',
			summary,
		]);
		expect(nextSubmission?.history.map((item) => item.content).join('\n')).not.toContain(
			'invalid-json',
		);
		const finalSnapshot = savedSnapshots.at(-1);
		expect(finalSnapshot?.filter((item) => item.role === 'assistant').map(
			(item) => item.content,
		)).toEqual([summary, 'Answer']);
		const persisted = JSON.stringify(savedSnapshots);
		expect(persisted).not.toContain('private invalid response');
		expect(persisted).not.toContain(validResponse);
		expect(persisted).not.toContain(invalidReasoning);
	});

	it('routes automatic displayed Selection through the exact native-editor request and normal saves', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
			defaultMode: 'edit',
		});
		const savedSnapshots = captureReadyMessageSaves(fixture, makeSession());
		fixture.additionalNotesStore.add('Note.md', 'Reference.md');
		fixture.requestSelectionEdit.mockImplementation(async (
			_snapshot,
			_prompt,
			_signal,
			_editor,
			_additionalNotePaths,
			_history,
			callbacks,
		) => {
			callbacks?.onReasoning?.('REJECTED raw JSON and diagnostics');
			callbacks?.onRetry?.();
			callbacks?.onReasoning?.('Successful reasoning');
			return {
				applied: true,
				changeCount: 2,
				summaryItems: [{ type: 'replace', start: 0, end: 4 }],
				usage: {
					promptTokens: 30,
					completionTokens: 7,
					totalTokens: 37,
					source: 'provider',
				},
			};
		});
		fixture.requestChatCompletion.mockImplementation((async (
			submission: ReadOnlySubmission,
		) => {
			submission.callbacks.onContent('Answer');
			return {
				content: 'Answer',
				reasoning: '',
				usage: {
					promptTokens: 3,
					completionTokens: 1,
					totalTokens: 4,
					source: 'provider',
				},
			};
		}) as unknown as EmendPlugin['requestChatCompletion']);
		const summary = 'Edit applied — 2 changes tracked. Review in Track Changes.\nTarget: Selection.\n\n- Replaced line 1.';
		const captureTarget = fixture.captureSelectionEditTarget.getMockImplementation();
		if (!captureTarget) {
			throw new Error('Selection capture double missing.');
		}
		const capturedTargets: Array<ReturnType<typeof captureTarget>> = [];
		fixture.captureSelectionEditTarget.mockImplementation(() => {
			const target = captureTarget();
			capturedTargets.push(target);
			return target;
		});
		await fixture.open();

		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Selection');
		setChatInput(fixture, 'Edit selection');
		findSendButton(fixture.contentEl)?.dispatch('click');
		await vi.waitFor(() => expect(savedSnapshots).toHaveLength(2));

		expect(fixture.captureSelectionEditTarget).toHaveBeenCalled();
		expect(fixture.captureChatContext).not.toHaveBeenCalled();
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.requestSelectionEdit).toHaveBeenCalledOnce();
		const args = fixture.requestSelectionEdit.mock.calls[0];
		const capturedTarget = capturedTargets.find(
			(target) => target.snapshot === args?.[0],
		);
		if (!capturedTarget || !args) {
			throw new Error('Selection target or request missing.');
		}
		expect(capturedTarget.snapshot).toMatchObject({
			fullText: 'Alpha beta.',
			selectedText: 'beta',
			from: 6,
			to: 10,
		});
		expect(capturedTarget.snapshot.file.path).toBe('Note.md');
		expect(args[0]).toBe(capturedTarget.snapshot);
		expect(args[1]).toBe('Edit selection');
		expect(args[2]).toBeInstanceOf(AbortSignal);
		expect(args[2].aborted).toBe(false);
		expect(args[3]).toBe(capturedTarget.editor);
		expect(args[4]).toEqual(['Reference.md']);
		expect(args[5]).toEqual([]);
		expect(typeof args[6]?.onReasoning).toBe('function');
		expect(typeof args[6]?.onRetry).toBe('function');
		expect(args[7]).toBe('default');
		expect(savedSnapshots[1]?.[1]).toMatchObject({
			status: 'ready',
			content: summary,
			reasoning: 'Successful reasoning',
			usage: {
				promptTokens: 30,
				completionTokens: 7,
				totalTokens: 37,
				source: 'provider',
			},
		});
		const persisted = JSON.stringify(savedSnapshots);
		expect(persisted).not.toContain('REJECTED raw JSON');
		expect(persisted).not.toContain('Alpha beta.');
		expect(persisted).not.toContain('"from":6');
		expect(persisted).not.toContain('"to":10');

		chooseWritingMenuItem(fixture.contentEl, 'Chat');
		setChatInput(fixture, 'Next question');
		await fixture.view.submitPrompt();

		expect(fixture.requestChatCompletion.mock.calls[0]?.[0].history.map(
			(item) => item.content,
		)).toEqual([
			'Edit selection',
			summary,
		]);
	});

	it('preserves the typed draft after a successful quick action', async () => {
		const fixture = createPublicChatViewFixture({ defaultMode: 'edit' });
		fixture.requestChatCompletion.mockResolvedValue({
			applied: false,
			changeCount: 0,
			summaryItems: [],
			usage: {
				promptTokens: 3,
				completionTokens: 1,
				totalTokens: 4,
				source: 'provider',
			},
		});
		await fixture.open();

		setChatInput(fixture, 'Keep this');
		const quickAction = findQuickActionButton(fixture.contentEl, 'fix-grammar');
		expect(quickAction).toBeDefined();
		quickAction?.dispatch('click');
		await vi.waitFor(() => expect(fixture.requestChatCompletion).toHaveBeenCalledOnce());
		await vi.waitFor(() => {
			const readyAssistants = findMessageElements(fixture.contentEl).filter(
				(element) => element.className.split(' ').includes('is-assistant')
					&& element.className.split(' ').includes('is-ready'),
			);
			expect(readyAssistants).toHaveLength(1);
		});

		expect(fixture.requestChatCompletion.mock.calls[0]?.[0]).toMatchObject({
			mode: 'edit',
			prompt: QUICK_ACTIONS[0].prompt,
		});
		expect(findChatInput(fixture.contentEl)?.value).toBe('Keep this');
	});

	it('persists an applied edit result when Stop races the ready snapshot', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
			defaultMode: 'edit',
		});
		const session = makeSession('session-1');
		const savedSnapshots = captureReadyMessageSaves(fixture, session);
		let requestSignal: AbortSignal | undefined;
		let stopClicked = false;
		fixture.requestSelectionEdit.mockImplementationOnce(async (
			_snapshot,
			_prompt,
			signal,
		) => {
			requestSignal = signal;
			queueMicrotask(() => {
				const stop = findSubmissionButton(fixture.contentEl, 'Stop');
				if (!stop) {
					throw new Error('Stop button missing when the Selection result settled.');
				}
				stop.dispatch('click');
				stopClicked = true;
			});
			return {
				applied: true,
				changeCount: 1,
				summaryItems: [{ type: 'replace', start: 0, end: 4 }],
				summary: 'Tightened the wording.',
				usage: {
					promptTokens: 4,
					completionTokens: 2,
					totalTokens: 6,
					source: 'provider',
				},
			};
		});
		await fixture.open();

		setChatInput(fixture, 'Edit selection');
		await fixture.view.submitPrompt();

		expect(stopClicked).toBe(true);
		expect(requestSignal?.aborted).toBe(true);
		expect(savedSnapshots.map((snapshot) => snapshot.at(-1)).map(
			(entry) => [entry?.role, entry?.status],
		)).toEqual([
			['user', 'ready'],
			['assistant', 'ready'],
		]);
		const assistant = savedSnapshots[1]?.[1];
		expect(assistant?.content).toContain('Edit applied — 1 changes tracked.');
		expect(assistant?.content).toContain('Tightened the wording.');
		expect(assistant?.status).toBe('ready');
		const assistantSave = fixture.conversationStore.appendReadyMessage.mock.calls[1];
		expect(assistantSave?.[2].role).toBe('assistant');
		expect(assistantSave?.[3]).toEqual({
			titlePrompt: 'Edit selection',
			signal: undefined,
		});
		expect(assistantSave?.[3]?.signal).toBeUndefined();
		if (!assistant?.id) {
			throw new Error('Committed assistant message missing.');
		}
		const committed = findMessageNode(fixture.contentEl, assistant.id);
		expect(committed?.className.split(' ')).toContain('is-ready');
		expect(textOf(committed!)).toContain('Tightened the wording.');
		expect(findSubmissionButton(fixture.contentEl, 'Send')?.disabled).toBe(false);
		expect(findSubmissionButton(fixture.contentEl, 'Stopping')).toBeUndefined();
	});
});


describe('EmendChatView public streaming rendering and completion scroll', () => {
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

	function savedAssistantId(fixture: PublicChatViewFixture): string {
		const assistant = fixture.conversationStore.appendReadyMessage.mock.calls
			.map((call) => call[2])
			.find((entry) => entry.role === 'assistant');
		if (!assistant) {
			throw new Error('Saved assistant message missing.');
		}
		return assistant.id;
	}

	function reasoningParts(container: FakeElement) {
		const details = findElements(container, (element) => element.tagName === 'details')[0];
		const content = findElements(
			container,
			(element) => element.className.split(' ').includes('emend-chat-reasoning-content'),
		)[0];
		if (!details || !content) {
			throw new Error('Reasoning panel missing.');
		}
		return { details, content };
	}

	it('keeps the streamed answer through the terminal Markdown transition', async () => {
		const pendingMarkdown = deferred<void>();
		vi.spyOn(MarkdownRenderer, 'render').mockImplementation(
			(_app, markdown, element) => {
				(element as unknown as FakeElement).textContent = `Rendered:${markdown}`;
				return pendingMarkdown.promise;
			},
		);
		const fixture = createPublicChatViewFixture();
		fixture.requestChatCompletion.mockImplementation((async (
			submission: ReadOnlySubmission,
		) => {
			submission.callbacks.onContent('Streamed **full** answer');
			return { content: 'Streamed **full** answer', reasoning: '' };
		}) as unknown as EmendPlugin['requestChatCompletion']);
		await fixture.open();

		await fixture.view.submitPrompt('Question');

		const assistantId = savedAssistantId(fixture);
		const assistant = findMessageNode(fixture.contentEl, assistantId);
		if (!assistant) {
			throw new Error('Assistant element missing.');
		}
		expect(assistant.className.split(' ')).toContain('is-ready');
		expect(textOf(assistant)).toContain('Streamed **full** answer');
		expect(messageContentElements(assistant)).toHaveLength(1);

		pendingMarkdown.resolve();
		await vi.waitFor(() => {
			expect(textOf(assistant)).toContain('Rendered:Streamed **full** answer');
		});
		const rendered = messageContentElements(assistant);
		expect(rendered).toHaveLength(1);
		expect(rendered[0]?.className.split(' ')).toContain('emend-chat-message-markdown');
	});

	it('keeps the plain answer when Markdown rendering fails', async () => {
		const pendingMarkdown = deferred<void>();
		vi.spyOn(MarkdownRenderer, 'render').mockReturnValue(pendingMarkdown.promise);
		const content = 'Plain **answer** that survives a render failure.';
		const fixture = createPublicChatViewFixture();
		fixture.conversationStore.loadConversation.mockResolvedValue(loadedConversation([
			makeSession('session-1', [{
				...message('ready-answer', 'Note.md'),
				content,
			}]),
		]));

		await fixture.open();

		const assistant = findMessageNode(fixture.contentEl, 'ready-answer');
		if (!assistant) {
			throw new Error('Ready assistant element missing.');
		}
		expect(textOf(assistant)).toContain(content);
		expect(messageContentElements(assistant)).toHaveLength(1);

		pendingMarkdown.reject(new Error('Markdown failed'));
		await Promise.resolve();
		await Promise.resolve();

		expect(textOf(assistant)).toContain(content);
		expect(messageContentElements(assistant)).toHaveLength(1);
	});

	it('keeps an opened reasoning panel and its scroll while streaming', async () => {
		const fixture = createPublicChatViewFixture();
		const response = deferred<SessionChatResult>();
		let callbacks: ReadOnlySubmission['callbacks'] | undefined;
		fixture.requestChatCompletion.mockImplementation((async (
			submission: ReadOnlySubmission,
		) => {
			callbacks = submission.callbacks;
			return response.promise;
		}) as unknown as EmendPlugin['requestChatCompletion']);
		await fixture.open();

		const submission = fixture.view.submitPrompt('Streaming question');
		await vi.waitFor(() => expect(fixture.requestChatCompletion).toHaveBeenCalledOnce());
		if (!callbacks) {
			throw new Error('Provider callbacks missing.');
		}
		callbacks.onReasoning('First thought');
		callbacks.onContent('First delta');
		fixture.flushAnimationFrame();
		const assistant = findMessageElements(fixture.contentEl).find(
			(element) => element.className.split(' ').includes('is-assistant')
				&& element.className.split(' ').includes('is-loading'),
		);
		if (!assistant) {
			throw new Error('Streaming assistant element missing.');
		}
		const { details, content } = reasoningParts(assistant);
		details.open = true;
		content.scrollTop = 120;

		callbacks.onContent('First delta and second');
		fixture.flushAnimationFrame();
		callbacks.onContent('First delta and second and third');
		fixture.flushAnimationFrame();

		const current = reasoningParts(assistant);
		expect(current.details).toBe(details);
		expect(current.content).toBe(content);
		expect(details.open).toBe(true);
		expect(content.scrollTop).toBe(120);
		expect(textOf(assistant)).toContain('First delta and second and third');

		response.resolve({
			content: 'First delta and second and third',
			reasoning: 'First thought',
		});
		await submission;
	});

	it('keeps the opened reasoning panel when the first answer content arrives', async () => {
		const fixture = createPublicChatViewFixture();
		const response = deferred<SessionChatResult>();
		let callbacks: ReadOnlySubmission['callbacks'] | undefined;
		fixture.requestChatCompletion.mockImplementation((async (
			submission: ReadOnlySubmission,
		) => {
			callbacks = submission.callbacks;
			return response.promise;
		}) as unknown as EmendPlugin['requestChatCompletion']);
		await fixture.open();

		const submission = fixture.view.submitPrompt('Streaming question');
		await vi.waitFor(() => expect(fixture.requestChatCompletion).toHaveBeenCalledOnce());
		if (!callbacks) {
			throw new Error('Provider callbacks missing.');
		}
		callbacks.onReasoning('Thinking');
		fixture.flushAnimationFrame();
		const assistant = findMessageElements(fixture.contentEl).find(
			(element) => element.className.split(' ').includes('is-assistant')
				&& element.className.split(' ').includes('is-loading'),
		);
		if (!assistant) {
			throw new Error('Streaming assistant element missing.');
		}
		const { details, content } = reasoningParts(assistant);
		details.open = true;
		content.scrollTop = 64;

		callbacks.onContent('The answer starts here.');
		fixture.flushAnimationFrame();

		const current = reasoningParts(assistant);
		expect(current.details).toBe(details);
		expect(current.content).toBe(content);
		expect(details.open).toBe(true);
		expect(content.scrollTop).toBe(64);
		expect(textOf(assistant)).toContain('The answer starts here.');

		response.resolve({ content: 'The answer starts here.', reasoning: 'Thinking' });
		await submission;
	});

	it('restores the reader position when an unrelated render follows a completion', async () => {
		const completionMarkdown = deferred<void>();
		const unrelatedMarkdown = deferred<void>();
		vi.spyOn(MarkdownRenderer, 'render')
			.mockImplementationOnce(() => completionMarkdown.promise)
			.mockImplementationOnce(() => unrelatedMarkdown.promise);
		const fixture = createPublicChatViewFixture();
		fixture.requestChatCompletion.mockImplementation((async (
			submission: ReadOnlySubmission,
		) => {
			submission.callbacks.onContent('Streamed **answer**');
			return { content: 'Streamed **answer**', reasoning: '' };
		}) as unknown as EmendPlugin['requestChatCompletion']);
		await fixture.open();

		await fixture.view.submitPrompt('Question');
		const assistantId = savedAssistantId(fixture);
		const previousScroller = findMessagesScroller(fixture.contentEl);
		if (!previousScroller) {
			throw new Error('Messages scroller missing before mode change.');
		}
		previousScroller.scrollTop = 275;

		fixture.view.setMode('edit');

		const scroller = findMessagesScroller(fixture.contentEl);
		const assistant = findMessageNode(fixture.contentEl, assistantId);
		if (!scroller || !assistant) {
			throw new Error('Current completion elements missing after mode change.');
		}
		scroller.scrollTop = 275;
		Object.assign(scroller, { getBoundingClientRect: () => ({ top: 100 }) });
		Object.assign(assistant, { getBoundingClientRect: () => ({ top: 25 }) });

		completionMarkdown.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(scroller.scrollTop).toBe(275);

		unrelatedMarkdown.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(scroller.scrollTop).toBe(275);
	});

	it('aligns a real completion only after its own Markdown generation settles', async () => {
		const pendingMarkdown = deferred<void>();
		vi.spyOn(MarkdownRenderer, 'render').mockReturnValue(pendingMarkdown.promise);
		const fixture = createPublicChatViewFixture();
		fixture.requestChatCompletion.mockImplementation((async (
			submission: ReadOnlySubmission,
		) => {
			submission.callbacks.onContent('Streamed **answer**');
			return { content: 'Streamed **answer**', reasoning: '' };
		}) as unknown as EmendPlugin['requestChatCompletion']);
		await fixture.open();

		await fixture.view.submitPrompt('Question');

		const assistantId = savedAssistantId(fixture);
		const scroller = findMessagesScroller(fixture.contentEl);
		const assistant = findMessageNode(fixture.contentEl, assistantId);
		if (!scroller || !assistant) {
			throw new Error('Completed answer elements missing.');
		}
		scroller.scrollTop = 40;
		Object.assign(scroller, { getBoundingClientRect: () => ({ top: 100 }) });
		Object.assign(assistant, { getBoundingClientRect: () => ({ top: 260 }) });

		await Promise.resolve();
		expect(scroller.scrollTop).toBe(40);

		pendingMarkdown.resolve();
		await vi.waitFor(() => expect(scroller.scrollTop).toBe(200));
	});
});
