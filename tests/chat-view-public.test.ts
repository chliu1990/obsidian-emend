import { MarkdownRenderer, Menu, MenuItem, Notice, Scope } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSession } from '../src/chat-sessions';
import {
	buildFullNoteDraftEstimate,
	buildReadOnlyDraftEstimate,
	buildSelectionDraftEstimate,
	formatDraftCapacitySummary,
} from '../src/context-capacity-ui';
import { formatVaultQualifiedPath, type RequestContext } from '../src/context';
import type { LoadedChatConversation } from '../src/conversation-store';
import EmendPlugin from '../src/main';
import { ModificationController } from '../src/modification-controller';
import { operationEditStrategy } from '../src/operation-edit-strategy';
import type {
	AiProviderRequest,
	StreamEvent,
	StreamResult,
} from '../src/provider-stream';
import { QUICK_ACTIONS } from '../src/quick-actions';
import type { SelectionEditResult, SelectionEditTarget } from '../src/selection-editor';
import type { SelectionContextPolicy } from '../src/selection-focus';
import { normalizeContextLimit } from '../src/settings';
import {
	EditRequestCoordinator,
	type ChatStreamResult,
	type EditRequestResult,
	type EditSubmission,
	type ReadOnlySubmission,
} from '../src/request-coordinator';
import type {
	ChatMessage,
	ProviderConfig,
	ProviderHistoryMessage,
	SelectionSnapshot,
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
	checked: boolean | null;
	disabled: boolean;
	clickHandler: (event: MouseEvent | KeyboardEvent) => unknown;
};

const chatViewMenus = Menu as unknown as { instances: ChatViewMenu[] };

function findWritingTrigger(contentEl: FakeElement): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) => element.className.split(' ').includes('emend-chat-writing-trigger'),
	)[0];
}

function findModelTrigger(contentEl: FakeElement): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) => element.className.split(' ').includes('emend-chat-active-model'),
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

function findChatViewMenuItem(menu: ChatViewMenu, title: string): ChatViewMenuItem {
	const item = menu.items.find(
		(candidate): candidate is ChatViewMenuItem =>
			candidate instanceof MenuItem && candidate.title === title,
	);
	if (!item) {
		throw new Error(`Missing menu item: ${title}`);
	}
	return item;
}

function openWritingMenu(contentEl: FakeElement): ChatViewMenu {
	findWritingTrigger(contentEl)?.dispatch('click');
	const menu = chatViewMenus.instances.at(-1);
	if (!menu) {
		throw new Error('The writing trigger did not open a menu.');
	}
	return menu;
}

function chooseWritingMenuItem(contentEl: FakeElement, title: string): void {
	findChatViewMenuItem(openWritingMenu(contentEl), title).clickHandler({} as MouseEvent);
}

function chooseModelMenuItem(contentEl: FakeElement, title: string): ChatViewMenuItem {
	findModelTrigger(contentEl)?.dispatch('click');
	const menu = chatViewMenus.instances.at(-1);
	if (!menu) {
		throw new Error('The model trigger did not open a menu.');
	}
	const item = findChatViewMenuItem(menu, title);
	item.clickHandler({} as MouseEvent);
	return item;
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

function appliedSelectionResult(summary?: string): SelectionEditResult {
	return {
		applied: true,
		changeCount: 2,
		summaryItems: [{ type: 'replace', start: 0, end: 4 }],
		...(summary === undefined ? {} : { summary }),
		usage: {
			promptTokens: 30,
			completionTokens: 7,
			totalTokens: 37,
			source: 'provider',
		},
	};
}

function renderedMessageContent(
	fixture: PublicChatViewFixture,
	messageId: string,
): string | undefined {
	const node = findMessageNode(fixture.contentEl, messageId);
	return node ? messageContentElements(node)[0]?.textContent : undefined;
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

function selectionCapacityEstimate(
	fixture: PublicChatViewFixture,
	snapshot: SelectionSnapshot,
	prompt: string,
	selectionContext: SelectionContextPolicy = 'default',
) {
	return buildSelectionDraftEstimate({
		provider: fixture.settings.providers[fixture.settings.activeProvider],
		snapshot,
		prompt,
		maxContextCharacters: normalizeContextLimit(fixture.settings.maxContextCharacters),
		smartSelectionContext: fixture.settings.smartSelectionContext,
		selectionContext,
		notePath: fixture.settings.includeNotePathInContext
			? formatVaultQualifiedPath('TestVault', snapshot.file.path)
			: undefined,
		history: [],
	});
}

function expectedSelectionCapacity(
	fixture: PublicChatViewFixture,
	snapshot: SelectionSnapshot,
	prompt: string,
	selectionContext: SelectionContextPolicy = 'default',
): string {
	return formatDraftCapacitySummary(selectionCapacityEstimate(
		fixture,
		snapshot,
		prompt,
		selectionContext,
	));
}

function capturedSelectionTargets(fixture: PublicChatViewFixture): SelectionEditTarget[] {
	return fixture.captureSelectionEditTarget.mock.results.flatMap((result) =>
		result.type === 'return' ? [result.value] : []
	);
}

function expectNoRequestsOrReads(fixture: PublicChatViewFixture): void {
	expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
	// eslint-disable-next-line @typescript-eslint/unbound-method -- Inspect the adapter mock without invoking it.
	expect(fixture.view.app.vault.adapter.read).not.toHaveBeenCalled();
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
		fixture.view.setMode('edit');
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
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Full note');
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

		const noticeStart = noticeMessages().length;
		oldCallbacks?.onContent('STALE_STREAM_CONTENT');
		fixture.flushAnimationFrame();
		oldResponse.resolve({ content: 'STALE_STREAM_CONTENT', reasoning: '' });
		await oldSubmission;

		expect(noticeMessages().slice(noticeStart)).toEqual([]);
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

	it('delegates Full-note Edit with the captured context, history, additional notes, and signal', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			defaultMode: 'edit',
		});
		const savedSnapshots = captureReadyMessageSaves(fixture, makeSession('session-1', [
			{
				...message('earlier-question', 'Note.md'),
				role: 'user',
				content: 'Earlier question',
			},
			{
				...message('earlier-answer', 'Note.md'),
				content: 'Earlier answer',
			},
		]));
		fixture.additionalNotesStore.add('Note.md', 'Reference.md');
		const controllerSubmit = vi.spyOn(ModificationController.prototype, 'submit');
		fixture.requestChatCompletion.mockResolvedValue({
			applied: true,
			changeCount: 1,
			summaryItems: [{ type: 'replace', start: 6, end: 10 }],
			usage: {
				promptTokens: 12,
				completionTokens: 8,
				totalTokens: 20,
				source: 'provider',
			},
		});
		await fixture.open();
		setChatInput(fixture, 'Edit note');

		await fixture.view.submitPrompt();

		expect(controllerSubmit).toHaveBeenCalledOnce();
		const submission = controllerSubmit.mock.calls[0]?.[0];
		if (!submission || submission.target.type !== 'full-note') {
			throw new Error('Full-note modification submission missing.');
		}
		const expectedHistory = [
			{ role: 'user', content: 'Earlier question', mode: 'ask', origin: 'user' },
			{ role: 'assistant', content: 'Earlier answer', mode: 'ask', origin: 'model' },
		];
		expect(submission.prompt).toBe('Edit note');
		expect(submission.history).toEqual(expectedHistory);
		expect(submission.additionalNotePaths).toEqual(['Reference.md']);
		expect(submission.signal).toBeInstanceOf(AbortSignal);
		expect(submission.signal.aborted).toBe(false);
		expect(submission.target.mode).toBe('edit');
		expect(submission.target.context.sourceText).toBe('Alpha beta.');
		expect(submission.target.context.file.path).toBe('Note.md');
		expect(fixture.requestChatCompletion).toHaveBeenCalledOnce();
		expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
		const request = fixture.requestChatCompletion.mock.calls[0]?.[0];
		if (!request || request.mode !== 'edit') {
			throw new Error('Full-note Edit request missing.');
		}
		expect(request).toMatchObject({
			mode: 'edit',
			prompt: 'Edit note',
			history: expectedHistory,
			additionalNotePaths: ['Reference.md'],
		});
		expect(request.context).toBe(submission.target.context);
		expect(request.callbacks).toBe(submission.callbacks);
		expect(request.signal).toBe(submission.signal);
		const expectedSummary = [
			'Edit applied — 1 changes tracked. Review in Track Changes.',
			'Target: Full note.',
			'',
			'- Replaced line 1.',
		].join('\n');
		expect(savedSnapshots).toHaveLength(2);
		const assistant = savedSnapshots.at(-1)?.at(-1);
		expect(assistant).toMatchObject({
			role: 'assistant',
			status: 'ready',
			content: expectedSummary,
		});
		if (!assistant) {
			throw new Error('Full-note Edit assistant message missing.');
		}
		expect(renderedMessageContent(fixture, assistant.id)).toBe(expectedSummary);
	});

	it('delegates Selection Edit with the captured target and Selection context policy', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
			defaultMode: 'edit',
		});
		const savedSnapshots = captureReadyMessageSaves(fixture, makeSession());
		const controllerSubmit = vi.spyOn(ModificationController.prototype, 'submit');
		fixture.requestSelectionEdit.mockResolvedValue(appliedSelectionResult());
		await fixture.open();
		chooseWritingMenuItem(fixture.contentEl, 'Edit · Selection · Full note');
		setChatInput(fixture, 'Edit selection');

		await fixture.view.submitPrompt();

		expect(controllerSubmit).toHaveBeenCalledOnce();
		const submission = controllerSubmit.mock.calls[0]?.[0];
		if (!submission || submission.target.type !== 'selection') {
			throw new Error('Selection modification submission missing.');
		}
		expect(submission.prompt).toBe('Edit selection');
		expect(submission.target.mode).toBe('edit');
		expect(submission.target.selectionContext).toBe('full-note');
		expect(capturedSelectionTargets(fixture)).toContain(submission.target.target);
		expect(submission.target.target.snapshot).toMatchObject({
			fullText: 'Alpha beta.',
			selectedText: 'beta',
			from: 6,
			to: 10,
		});
		expect(fixture.requestSelectionEdit).toHaveBeenCalledOnce();
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		const args = fixture.requestSelectionEdit.mock.calls[0];
		expect(args?.[0]).toBe(submission.target.target.snapshot);
		expect(args?.[1]).toBe('Edit selection');
		expect(args?.[2]).toBe(submission.signal);
		expect(args?.[3]).toBe(submission.target.target.editor);
		expect(args?.[6]).toBe(submission.callbacks);
		expect(args?.[7]).toBe('full-note');
		const expectedSummary = [
			'Edit applied — 2 changes tracked. Review in Track Changes.',
			'Target: Selection.',
			'',
			'- Replaced line 1.',
		].join('\n');
		const assistant = savedSnapshots.at(-1)?.at(-1);
		expect(assistant).toMatchObject({
			role: 'assistant',
			status: 'ready',
			content: expectedSummary,
		});
		if (!assistant) {
			throw new Error('Selection Edit assistant message missing.');
		}
		expect(renderedMessageContent(fixture, assistant.id)).toBe(expectedSummary);
	});

	it.each([
		{ label: 'Chat', menu: undefined, chatTarget: 'note', webMode: undefined },
		{ label: 'Chat Selection', menu: 'Chat · Selection', chatTarget: 'selection', webMode: undefined },
		{ label: 'Web Review', menu: 'Web Review', chatTarget: 'note', webMode: 'review' },
		{ label: 'Web Auto', menu: 'Web Auto', chatTarget: 'note', webMode: 'auto' },
	] as const)(
		'keeps Chat, Chat Selection, Web Review, and Web Auto outside the modification controller: $label',
		async (scenario) => {
			const fixture = createPublicChatViewFixture({
				sourceText: 'Alpha beta.',
				selectedText: 'beta',
			});
			const savedSnapshots = captureReadyMessageSaves(fixture, makeSession());
			const controllerSubmit = vi.spyOn(ModificationController.prototype, 'submit');
			fixture.requestChatCompletion.mockImplementation((async (
				submission: ReadOnlySubmission,
			) => {
				submission.callbacks.onContent('Provisional answer');
				submission.callbacks.onContentReset?.();
				submission.callbacks.onContent('Terminal answer');
				return {
					content: 'Terminal answer',
					reasoning: '',
					usage: {
						promptTokens: 3,
						completionTokens: 1,
						totalTokens: 4,
						source: 'provider',
					},
					sources: [],
					activities: [],
					failedExtractions: 0,
					failedSearches: 0,
					maxToolCalls: 4,
					skippedWebCalls: 0,
					omittedEvidence: false,
				};
			}) as unknown as EmendPlugin['requestChatCompletion']);
			await fixture.open();
			if (scenario.menu) {
				chooseWritingMenuItem(fixture.contentEl, scenario.menu);
			}
			setChatInput(fixture, 'Question');

			await fixture.view.submitPrompt();

			expect(controllerSubmit).not.toHaveBeenCalled();
			expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
			expect(fixture.requestChatCompletion).toHaveBeenCalledOnce();
			const request = fixture.requestChatCompletion.mock.calls[0]?.[0] as unknown as
				ReadOnlySubmission | undefined;
			if (!request) {
				throw new Error('Read-only request missing.');
			}
			expect(request.mode).toBe('ask');
			expect(request.chatTarget).toBe(scenario.chatTarget);
			expect(request.webSearch?.mode).toBe(scenario.webMode);
			if (scenario.label === 'Web Review') {
				expect(typeof request.webSearch?.reviewCalls).toBe('function');
			}
			expect(savedSnapshots).toHaveLength(2);
			const assistant = savedSnapshots.at(-1)?.at(-1);
			expect(assistant).toMatchObject({
				role: 'assistant',
				status: 'ready',
				content: 'Terminal answer',
			});
			for (const saved of savedSnapshots.flat()) {
				expect(Object.prototype.hasOwnProperty.call(saved, 'webDraft')).toBe(false);
				expect(saved.content).not.toContain('Edit applied');
				expect(saved.content).not.toContain('No changes were needed.');
			}
		},
	);

	it('isolates late Edit callbacks and non-applied completion after a note switch and newer Chat request', async () => {
		const fixture = createPublicChatViewFixture({
			activePath: 'A.md',
			defaultMode: 'edit',
		});
		const first = makeSession('a1');
		const second = makeSession('b1');
		fixture.conversationStore.loadConversation.mockImplementation(async (notePath) =>
			loadedConversation([notePath === 'A.md' ? first : second])
		);
		const oldResponse = deferred<EditRequestResult>();
		let oldCallbacks: EditSubmission['callbacks'] | undefined;
		let oldSignal: AbortSignal | undefined;
		let newSignal: AbortSignal | undefined;
		fixture.requestChatCompletion
			.mockImplementationOnce((async (submission: EditSubmission) => {
				oldCallbacks = submission.callbacks;
				oldSignal = submission.signal;
				return oldResponse.promise;
			}) as unknown as EmendPlugin['requestChatCompletion'])
			.mockImplementationOnce((async (submission: ReadOnlySubmission) => {
				newSignal = submission.signal;
				submission.callbacks.onReasoning('B reasoning');
				submission.callbacks.onContent('B answer');
				return {
					content: 'B answer',
					reasoning: 'B reasoning',
					usage: {
						promptTokens: 3,
						completionTokens: 1,
						totalTokens: 4,
						source: 'provider',
					},
					sources: [],
					activities: [],
					failedExtractions: 0,
					failedSearches: 0,
					maxToolCalls: 4,
					skippedWebCalls: 0,
					omittedEvidence: false,
				};
			}) as unknown as EmendPlugin['requestChatCompletion']);
		await fixture.open();

		const oldSubmission = fixture.view.submitPrompt('Edit A');
		await vi.waitFor(() => expect(fixture.requestChatCompletion).toHaveBeenCalledOnce());
		expect(oldSignal?.aborted).toBe(false);
		expect(fixture.conversationStore.appendReadyMessage).toHaveBeenCalledOnce();
		expect(fixture.conversationStore.appendReadyMessage.mock.calls[0]?.[0]).toBe('A.md');
		expect(fixture.conversationStore.appendReadyMessage.mock.calls[0]?.[2]).toMatchObject({
			role: 'user',
			content: 'Edit A',
			status: 'ready',
		});

		fixture.setActivePath('B.md');
		await fixture.view.refreshTargetNote();
		expect(oldSignal?.aborted).toBe(true);
		fixture.view.setMode('ask');
		await fixture.view.submitPrompt('Question B');
		expect(newSignal?.aborted).toBe(false);
		const bAssistant = fixture.conversationStore.appendReadyMessage.mock.calls
			.find(([notePath, , saved]) => notePath === 'B.md' && saved.role === 'assistant')?.[2];
		if (!bAssistant) {
			throw new Error('B assistant message missing.');
		}
		expect(textOf(findMessageNode(fixture.contentEl, bAssistant.id)!)).toContain('B answer');

		const noticeStart = noticeMessages().length;
		if (!oldCallbacks) {
			throw new Error('Edit callbacks missing.');
		}
		oldCallbacks.onReasoning('STALE_EDIT_REASONING');
		oldCallbacks.onRetry?.();
		oldCallbacks.onReasoning('STALE_EDIT_RETRY_REASONING');
		fixture.flushAnimationFrame();
		oldResponse.resolve({
			applied: false,
			changeCount: 0,
			summaryItems: [],
			summary: 'STALE_EDIT_SUMMARY',
			usage: {
				promptTokens: 2,
				completionTokens: 1,
				totalTokens: 3,
				source: 'provider',
			},
		});
		await oldSubmission;

		const currentText = textOf(fixture.contentEl);
		expect(currentText).not.toContain('STALE_EDIT_REASONING');
		expect(currentText).not.toContain('STALE_EDIT_RETRY_REASONING');
		expect(currentText).not.toContain('STALE_EDIT_SUMMARY');
		expect(noticeMessages().slice(noticeStart)).toEqual([]);
		const currentB = findMessageNode(fixture.contentEl, bAssistant.id);
		expect(currentB?.className.split(' ')).toContain('is-ready');
		expect(textOf(currentB!)).toContain('B answer');
		expect(textOf(currentB!)).toContain('B reasoning');
		expect(newSignal?.aborted).toBe(false);
		expect(findSubmissionButton(fixture.contentEl, 'Stop')).toBeUndefined();
		expect(findSubmissionButton(fixture.contentEl, 'Send')?.disabled).toBe(false);
		expect(fixture.requestChatCompletion).toHaveBeenCalledTimes(2);
		expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
		const saves = fixture.conversationStore.appendReadyMessage.mock.calls.map(
			([notePath, , saved]) => ({
				notePath,
				role: saved.role,
				content: saved.content,
				status: saved.status,
			}),
		);
		expect(saves).toEqual([
			{ notePath: 'A.md', role: 'user', content: 'Edit A', status: 'ready' },
			{ notePath: 'B.md', role: 'user', content: 'Question B', status: 'ready' },
			{ notePath: 'B.md', role: 'assistant', content: 'B answer', status: 'ready' },
		]);
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
		const persistedEdit = savedSnapshots.flat()
			.map((item) => `${item.content}\n${item.reasoning}`)
			.join('\n');
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
		const persisted = savedSnapshots.flat()
			.map((item) => `${item.content}\n${item.reasoning}`)
			.join('\n');
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

	it('keeps full-note Selection context on the native selection writer only', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
			defaultMode: 'edit',
		});
		const savedSnapshots = captureReadyMessageSaves(fixture, makeSession());
		fixture.requestSelectionEdit.mockResolvedValue(appliedSelectionResult());
		await fixture.open();
		chooseWritingMenuItem(fixture.contentEl, 'Edit · Selection · Full note');
		setChatInput(fixture, 'Edit selection');

		await fixture.view.submitPrompt();

		expect(fixture.requestSelectionEdit).toHaveBeenCalledOnce();
		expect(fixture.requestSelectionEdit.mock.calls[0]?.[7]).toBe('full-note');
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.captureChatContext).not.toHaveBeenCalled();
		expect(savedSnapshots[0]?.[0]?.mode).toBe('edit');
	});

	it('sends the same captured ready history as full-note and read-only requests', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
			defaultMode: 'edit',
		});
		captureReadyMessageSaves(fixture, makeSession('session-1', [
			{
				...message('earlier-question', 'Note.md'),
				role: 'user',
				content: 'Earlier question',
			},
			message('earlier-answer', 'Note.md'),
		]));
		fixture.requestSelectionEdit.mockResolvedValue(appliedSelectionResult());
		await fixture.open();
		setChatInput(fixture, 'Edit selection');

		await fixture.view.submitPrompt();

		const args = fixture.requestSelectionEdit.mock.calls[0];
		expect(args?.[5]).toEqual([
			{ role: 'user', content: 'Earlier question', mode: 'ask', origin: 'user' },
			{ role: 'assistant', content: 'earlier-answer', mode: 'ask', origin: 'model' },
		]);
	});

	it('adds the Selection start offset once to note-absolute summary lines', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Intro line.\nFirst target.\nSecond target.\nOutro line.',
			selectedText: 'First target.\nSecond target.',
			defaultMode: 'edit',
		});
		const savedSnapshots = captureReadyMessageSaves(fixture, makeSession());
		fixture.requestSelectionEdit.mockResolvedValue({
			...appliedSelectionResult(),
			summaryItems: [{ type: 'replace', start: 0, end: 28 }],
		});
		await fixture.open();
		setChatInput(fixture, 'Edit selection');

		await fixture.view.submitPrompt();

		const expected = 'Edit applied — 2 changes tracked. Review in Track Changes.\nTarget: Selection.\n\n- Replaced lines 2–3.';
		const assistant = savedSnapshots[1]?.[1];
		if (!assistant) {
			throw new Error('Selection Edit assistant message missing.');
		}
		expect(assistant.content).toBe(expected);
		expect(renderedMessageContent(fixture, assistant.id)).toBe(expected);
	});

	it('keeps the exact no-op text when a non-applied result carries summary items', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
			defaultMode: 'edit',
		});
		const savedSnapshots = captureReadyMessageSaves(fixture, makeSession());
		fixture.requestSelectionEdit.mockResolvedValueOnce({
			applied: false,
			changeCount: 0,
			summaryItems: [{ type: 'replace', start: 0, end: 4 }],
			usage: {
				promptTokens: 2,
				completionTokens: 1,
				totalTokens: 3,
				source: 'provider',
			},
		});
		await fixture.open();
		setChatInput(fixture, 'Edit selection');

		await fixture.view.submitPrompt();

		const assistant = savedSnapshots[1]?.[1];
		if (!assistant) {
			throw new Error('Selection no-op assistant message missing.');
		}
		expect(assistant.content).toBe('No changes were needed.');
		expect(assistant.content).not.toContain('- ');
		expect(renderedMessageContent(fixture, assistant.id)).toBe('No changes were needed.');
	});

	it('renders the Selection target and model summary as persisted plain content', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
			defaultMode: 'edit',
		});
		const savedSnapshots = captureReadyMessageSaves(fixture, makeSession());
		fixture.requestSelectionEdit.mockResolvedValue(
			appliedSelectionResult('Renamed **beta** to delta.'),
		);
		await fixture.open();
		setChatInput(fixture, 'Edit selection');

		await fixture.view.submitPrompt();

		const expected = [
			'Edit applied — 2 changes tracked. Review in Track Changes.',
			'Target: Selection.',
			'',
			'Renamed **beta** to delta.',
			'',
			'- Replaced line 1.',
		].join('\n');
		const saved = savedSnapshots[1]?.[1];
		if (!saved) {
			throw new Error('Selection Edit persistence snapshot missing.');
		}
		expect(saved.content).toBe(expected);
		expect(renderedMessageContent(fixture, saved.id)).toBe(expected);
		expect(Object.prototype.hasOwnProperty.call(saved, 'summary')).toBe(false);
	});

	it('renders a no-op summary after the exact no-op sentence', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
			defaultMode: 'edit',
		});
		const savedSnapshots = captureReadyMessageSaves(fixture, makeSession());
		fixture.requestSelectionEdit.mockResolvedValueOnce({
			applied: false,
			changeCount: 0,
			summaryItems: [],
			summary: 'Reviewed without changing the selection.',
			usage: {
				promptTokens: 2,
				completionTokens: 1,
				totalTokens: 3,
				source: 'provider',
			},
		});
		await fixture.open();
		setChatInput(fixture, 'Edit selection');

		await fixture.view.submitPrompt();

		const expected = 'No changes were needed.\n\nReviewed without changing the selection.';
		const assistant = savedSnapshots[1]?.[1];
		if (!assistant) {
			throw new Error('Selection no-op summary message missing.');
		}
		expect(assistant.content).toBe(expected);
		expect(renderedMessageContent(fixture, assistant.id)).toBe(expected);
	});

	it.each([
		['provider', 'Provider unavailable'],
		['validation', 'Invalid operation array'],
		['stale', 'The note changed while Emend was responding. No edits were applied.'],
	])('settles a %s failure and permits a selection retry without fallback', async (_kind, errorMessage) => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
			defaultMode: 'edit',
		});
		const savedSnapshots = captureReadyMessageSaves(fixture, makeSession());
		fixture.requestSelectionEdit
			.mockResolvedValue(appliedSelectionResult())
			.mockRejectedValueOnce(new Error(errorMessage));
		await fixture.open();
		setChatInput(fixture, 'Edit selection');

		await fixture.view.submitPrompt();

		const error = findMessageElements(fixture.contentEl).find(
			(element) => element.className.split(' ').includes('is-assistant')
				&& element.className.split(' ').includes('is-error'),
		);
		expect(error).toBeDefined();
		expect(messageContentElements(error!)[0]?.textContent).toBe(errorMessage);
		expect(findSubmissionButton(fixture.contentEl, 'Send')?.disabled).toBe(false);
		expect(findSubmissionButton(fixture.contentEl, 'Stop')).toBeUndefined();
		expect(findSubmissionButton(fixture.contentEl, 'Stopping')).toBeUndefined();
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(savedSnapshots.flat().some(
			(message) => message.status === 'error',
		)).toBe(false);

		setChatInput(fixture, 'Retry selection');
		await fixture.view.submitPrompt();

		expect(fixture.requestSelectionEdit).toHaveBeenCalledTimes(2);
		const retry = savedSnapshots.at(-1)?.at(-1);
		if (!retry) {
			throw new Error('Selection retry assistant message missing.');
		}
		expect(retry.status).toBe('ready');
		expect(findMessageNode(fixture.contentEl, retry.id)?.className.split(' '))
			.toContain('is-ready');
	});

	it('uses the existing stopped lifecycle and excludes the partial response from saves', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
			defaultMode: 'edit',
		});
		const savedSnapshots = captureReadyMessageSaves(fixture, makeSession());
		const response = deferred<SelectionEditResult>();
		fixture.requestSelectionEdit.mockImplementationOnce(() => response.promise);
		await fixture.open();
		setChatInput(fixture, 'Edit selection');
		const submission = fixture.view.submitPrompt();
		await vi.waitFor(() => expect(fixture.requestSelectionEdit).toHaveBeenCalledOnce());

		const stop = findSubmissionButton(fixture.contentEl, 'Stop');
		expect(stop).toBeDefined();
		stop?.dispatch('click');
		response.resolve({
			applied: false,
			changeCount: 0,
			summaryItems: [],
			usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3, source: 'provider' },
		});
		await submission;

		const stopped = findMessageElements(fixture.contentEl).find(
			(element) => element.className.split(' ').includes('is-assistant')
				&& element.className.split(' ').includes('is-stopped'),
		);
		expect(stopped).toBeDefined();
		expect(findSubmissionButton(fixture.contentEl, 'Send')?.disabled).toBe(false);
		expect(findSubmissionButton(fixture.contentEl, 'Stop')).toBeUndefined();
		expect(findSubmissionButton(fixture.contentEl, 'Stopping')).toBeUndefined();
		expect(savedSnapshots.flat().some(
			(message) => message.status === 'stopped' || message.status === 'error',
		)).toBe(false);
		for (const target of capturedSelectionTargets(fixture)) {
			expect(target.editor.replaceRange).not.toHaveBeenCalled();
		}
	});

	it('keeps an applied edit summary when its session was deleted during the request', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
			defaultMode: 'edit',
		});
		const session = makeSession('session-1');
		fixture.conversationStore.loadConversation.mockResolvedValue(
			loadedConversation([session]),
		);
		const appendReadyMessage = fixture.conversationStore.appendReadyMessage;
		appendReadyMessage.mockImplementation(async (_notePath, _sessionId, appended) => {
			if (appended.role === 'assistant') {
				throw new Error('Chat session does not exist.');
			}
			return { ...session, messages: [...session.messages, appended] };
		});
		fixture.requestSelectionEdit.mockImplementationOnce(async () => ({
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
		}));
		await fixture.open();
		setChatInput(fixture, 'Edit selection');

		await fixture.view.submitPrompt();

		const assistantAttempts = appendReadyMessage.mock.calls.filter(
			([, , appended]) => appended.role === 'assistant',
		);
		expect(assistantAttempts).toHaveLength(1);
		expect(appendReadyMessage).toHaveBeenCalledTimes(2);
		expect(noticeMessages()).toEqual([
			'Emend: Edit applied, but this chat could not be saved.',
		]);
		const assistant = findMessageElements(fixture.contentEl).find(
			(element) => element.className.split(' ').includes('is-assistant')
				&& element.className.split(' ').includes('is-ready'),
		);
		expect(assistant).toBeDefined();
		const content = messageContentElements(assistant!)[0]?.textContent;
		expect(content).toContain('Edit applied');
		expect(content).toContain('Target: Selection.');
		expect(content).toContain('Tightened the wording.');
		expect(findSubmissionButton(fixture.contentEl, 'Send')?.disabled).toBe(false);
	});

	it('reports a failed save after a committed edit when Stop raced completion', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
			defaultMode: 'edit',
		});
		const session = makeSession('session-1');
		fixture.conversationStore.loadConversation.mockResolvedValue(
			loadedConversation([session]),
		);
		fixture.conversationStore.appendReadyMessage.mockImplementation(async (
			_notePath,
			_sessionId,
			appended,
			options,
		) => {
			options?.signal?.throwIfAborted();
			if (appended.role === 'assistant') {
				throw new Error('Disk is full.');
			}
			return { ...session, messages: [...session.messages, appended] };
		});
		let stopClicked = false;
		fixture.requestSelectionEdit.mockImplementationOnce(async () => {
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
		expect(noticeMessages()).toEqual([
			'Emend: Could not save this chat. Disk is full.',
		]);
		const assistant = findMessageElements(fixture.contentEl).find(
			(element) => element.className.split(' ').includes('is-assistant')
				&& element.className.split(' ').includes('is-ready'),
		);
		expect(assistant).toBeDefined();
		const content = messageContentElements(assistant!)[0]?.textContent;
		expect(content).toContain('Edit applied');
		expect(content).toContain('Tightened the wording.');
		expect(findSubmissionButton(fixture.contentEl, 'Send')?.disabled).toBe(false);
		expect(findSubmissionButton(fixture.contentEl, 'Stop')).toBeUndefined();
		expect(findSubmissionButton(fixture.contentEl, 'Stopping')).toBeUndefined();
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


describe('EmendChatView public edit target controls', () => {
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

	it.each([
		['Edit · Selection', 'selection'],
		['Edit · Full note', 'full-note'],
	] as const)('applies %s atomically with one render and capacity calculation', async (title, target) => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
		});
		await fixture.open();
		const render = vi.spyOn(fixture.contentEl, 'empty');
		fixture.captureChatContext.mockClear();
		fixture.captureSelectionEditTarget.mockClear();

		chooseWritingMenuItem(fixture.contentEl, title);

		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe(title);
		expect(render).toHaveBeenCalledOnce();
		const capture = target === 'selection'
			? fixture.captureSelectionEditTarget
			: fixture.captureChatContext;
		const otherCapture = target === 'selection'
			? fixture.captureChatContext
			: fixture.captureSelectionEditTarget;
		expect(capture).toHaveBeenCalledOnce();
		expect(otherCapture).not.toHaveBeenCalled();
		expectNoRequestsOrReads(fixture);
	});

	it.each([
		{
			title: 'Chat · Selection',
			capture: 'chat',
		},
		{
			title: 'Edit · Selection · Full note',
			capture: 'selection',
		},
	] as const)('applies $title atomically with its targeting policy', async (scenario) => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
		});
		await fixture.open();
		const render = vi.spyOn(fixture.contentEl, 'empty');
		fixture.captureChatContext.mockClear();
		fixture.captureSelectionEditTarget.mockClear();

		chooseWritingMenuItem(fixture.contentEl, scenario.title);

		const trigger = findWritingTrigger(fixture.contentEl);
		expect(trigger?.textContent).toBe(scenario.title);
		if (scenario.title === 'Edit · Selection · Full note') {
			expect(trigger?.title).toBe(
				`Full note is sent; only the selection is edited.\n${WEB_SEARCH_DISCLOSURE}`,
			);
		}
		expect(render).toHaveBeenCalledOnce();
		const capture = scenario.capture === 'selection'
			? fixture.captureSelectionEditTarget
			: fixture.captureChatContext;
		const otherCapture = scenario.capture === 'selection'
			? fixture.captureChatContext
			: fixture.captureSelectionEditTarget;
		expect(capture).toHaveBeenCalledOnce();
		expect(otherCapture).not.toHaveBeenCalled();
		expectNoRequestsOrReads(fixture);
	});

	it('retains the explicit target and maintained Web choice through Edit and Chat', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
		});
		await fixture.open();
		chooseWritingMenuItem(fixture.contentEl, 'Web Review');
		chooseWritingMenuItem(fixture.contentEl, 'Edit · Full note');
		fixture.setSelectedText('');
		await fixture.view.refreshTargetNote();

		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Full note');
		const editMenu = openWritingMenu(fixture.contentEl);
		expect(findChatViewMenuItem(editMenu, 'Web Off').checked).toBe(true);
		for (const title of ['Web Off', 'Web Review', 'Web Auto']) {
			expect(findChatViewMenuItem(editMenu, title).disabled).toBe(true);
		}
		editMenu.hide();

		chooseWritingMenuItem(fixture.contentEl, 'Chat');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Chat · Review search');
		fixture.view.setMode('edit');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Full note');
	});

	it('retains Chat and Edit targeting policies across unrelated writing and mode choices', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
		});
		await fixture.open();
		chooseWritingMenuItem(fixture.contentEl, 'Chat · Selection');
		chooseWritingMenuItem(fixture.contentEl, 'Edit · Selection · Full note');

		chooseWritingMenuItem(fixture.contentEl, 'Chat · Selection');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Chat · Selection');
		fixture.view.setMode('edit');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe(
			'Edit · Selection · Full note',
		);
		fixture.view.setMode('ask');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Chat · Selection');

		chooseWritingMenuItem(fixture.contentEl, 'Chat');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Chat');
		fixture.view.setMode('edit');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe(
			'Edit · Selection · Full note',
		);
	});

	it('rejects stale menu and submission callbacks after rerender and close', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
		});
		await fixture.open();
		setChatInput(fixture, 'Must not submit');
		const staleMenu = openWritingMenu(fixture.contentEl);
		const staleChoice = findChatViewMenuItem(staleMenu, 'Edit · Selection');
		const staleSend = findSubmissionButton(fixture.contentEl, 'Send');
		fixture.view.setMode('ask');
		staleChoice.clickHandler({} as MouseEvent);
		staleSend?.dispatch('click');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Chat');
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();

		const closedMenu = openWritingMenu(fixture.contentEl);
		const closedChoice = findChatViewMenuItem(closedMenu, 'Edit · Full note');
		const closedSend = findSubmissionButton(fixture.contentEl, 'Send');
		await fixture.close();
		closedChoice.clickHandler({} as MouseEvent);
		closedSend?.dispatch('click');
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();

		await fixture.open();
		fixture.view.setMode('edit');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Selection');
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	});

	it('blocks submissions and duplicate choices during a deferred save without rerendering', async () => {
		const scopeRegister = vi.spyOn(Scope.prototype, 'register');
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
		});
		await fixture.open();
		chooseWritingMenuItem(fixture.contentEl, 'Web Review');
		chooseWritingMenuItem(fixture.contentEl, 'Edit · Full note');
		fixture.additionalNotesStore.add('Note.md', 'Related.md');
		const input = findChatInput(fixture.contentEl);
		if (!input) {
			throw new Error('Chat input missing.');
		}
		input.value = 'Preserve this draft';
		input.setSelectionRange(4, 11);
		input.focus();
		const sessionId = findSessionSelect(fixture.contentEl)?.value;
		const messages = findMessagesScroller(fixture.contentEl);
		const pendingSave = deferred<void>();
		const saveSettings = vi.spyOn(EmendPlugin.prototype, 'saveSettings')
			.mockImplementationOnce(() => pendingSave.promise);
		const render = vi.spyOn(fixture.contentEl, 'empty');
		fixture.captureChatContext.mockClear();
		const writingMenu = openWritingMenu(fixture.contentEl);
		const selectedItem = chooseModelMenuItem(fixture.contentEl, 'deepseek-v4-pro');

		expect(saveSettings).toHaveBeenCalledOnce();
		expect(findModelTrigger(fixture.contentEl)?.disabled).toBe(true);
		expect(findWritingTrigger(fixture.contentEl)?.disabled).toBe(true);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(true);
		for (const title of [
			'Chat',
			'Chat · Selection',
			'Edit · Selection',
			'Edit · Selection · Full note',
			'Edit · Full note',
			'Web Off',
			'Web Review',
			'Web Auto',
		]) {
			expect(findChatViewMenuItem(writingMenu, title).disabled).toBe(true);
		}
		for (const action of QUICK_ACTIONS) {
			expect(findQuickActionButton(fixture.contentEl, action.id)?.disabled).toBe(true);
		}
		selectedItem.clickHandler({} as MouseEvent);
		expect(saveSettings).toHaveBeenCalledOnce();
		const shortcut = scopeRegister.mock.calls.find(
			([modifiers, key]) => modifiers?.includes('Mod') && key === 'Enter',
		)?.[2];
		if (!shortcut) {
			throw new Error('Composer shortcut registration missing.');
		}
		for (const modifiers of [{}, { metaKey: true }, { ctrlKey: true }]) {
			const preventDefault = vi.fn();
			shortcut({
				key: 'Enter',
				target: input,
				metaKey: false,
				ctrlKey: false,
				shiftKey: false,
				altKey: false,
				...modifiers,
				preventDefault,
			} as unknown as KeyboardEvent, { vkey: 'Enter', modifiers: 'Mod', key: 'Enter' });
			expect(preventDefault).toHaveBeenCalledOnce();
		}
		findQuickActionButton(fixture.contentEl, 'fix-grammar')?.dispatch('click');
		await fixture.view.submitPrompt();

		expect(fixture.captureChatContext).not.toHaveBeenCalled();
		expectNoRequestsOrReads(fixture);
		expect(fixture.conversationStore.createSession).not.toHaveBeenCalled();
		expect(fixture.conversationStore.appendReadyMessage).not.toHaveBeenCalled();
		expect(findMessageElements(fixture.contentEl)).toEqual([]);
		expect(findMessagesScroller(fixture.contentEl)).toBe(messages);
		expect(input.disabled).toBe(false);
		expect(input.value).toBe('Preserve this draft');
		expect(input.selectionStart).toBe(4);
		expect(input.selectionEnd).toBe(11);
		expect(input.focused).toBe(true);
		expect(findSessionSelect(fixture.contentEl)?.value).toBe(sessionId);
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Full note');
		expect(fixture.additionalNotesStore.list('Note.md')).toEqual(['Related.md']);
		expect(render).not.toHaveBeenCalled();

		pendingSave.resolve();
		await vi.waitFor(() => expect(findModelTrigger(fixture.contentEl)?.disabled).toBe(false));

		expect(saveSettings).toHaveBeenCalledOnce();
		expect(findWritingTrigger(fixture.contentEl)?.disabled).toBe(false);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(false);
		for (const action of QUICK_ACTIONS) {
			expect(findQuickActionButton(fixture.contentEl, action.id)?.disabled).toBe(false);
		}
		expect(render).not.toHaveBeenCalled();
		chooseWritingMenuItem(fixture.contentEl, 'Chat');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Chat · Review search');
		fixture.view.setMode('edit');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Full note');
	});

	it('initially displays Selection when automatic targeting has usable text', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
		});

		await fixture.open();
		fixture.view.setMode('edit');

		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Selection');
	});

	it.each(['', ' \n\t'])(
		'initially displays Full note for an empty or whitespace selection: %j',
		async (selectedText) => {
			const fixture = createPublicChatViewFixture({
				sourceText: 'Alpha beta.',
				selectedText,
			});

			await fixture.open();
			fixture.view.setMode('edit');

			expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Full note');
		},
	);

	it.each([
		{ choice: 'full-note', selectedText: 'beta' },
		{ choice: 'selection', selectedText: '' },
	] as const)(
		'preserves explicit $choice targeting across renders and Chat/Edit switches',
		async ({ choice, selectedText }) => {
			const fixture = createPublicChatViewFixture({
				sourceText: 'Alpha beta.',
				selectedText,
			});
			await fixture.open();
			setChatInput(fixture, 'Keep this draft');
			chooseWritingMenuItem(
				fixture.contentEl,
				choice === 'selection' ? 'Edit · Selection' : 'Edit · Full note',
			);
			fixture.setSelectedText(choice === 'selection' ? 'beta' : '');
			await fixture.view.refreshTargetNote();

			expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe(
				choice === 'selection' ? 'Edit · Selection' : 'Edit · Full note',
			);
			chooseWritingMenuItem(fixture.contentEl, 'Chat');
			expect(findChatInput(fixture.contentEl)?.value).toBe('Keep this draft');
			fixture.view.setMode('edit');
			expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe(
				choice === 'selection' ? 'Edit · Selection' : 'Edit · Full note',
			);
			fixture.view.setMode('ask');
			fixture.view.setMode('edit');
			expect(findChatInput(fixture.contentEl)?.value).toBe('Keep this draft');
			expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe(
				choice === 'selection' ? 'Edit · Selection' : 'Edit · Full note',
			);
		},
	);

	it('resets to auto only for real note changes while preserving per-note drafts', async () => {
		const fixture = createPublicChatViewFixture({
			activePath: 'A.md',
			sourceText: 'Alpha beta.',
		});
		const first = makeSession('a1');
		const second = makeSession('a2');
		fixture.conversationStore.loadConversation.mockImplementation(async (notePath) =>
			notePath === 'A.md'
				? loadedConversation([first, second], 'a1')
				: loadedConversation([])
		);
		await fixture.open();
		setChatInput(fixture, 'A draft');
		fixture.setSelectedText('Alpha');
		await fixture.view.refreshTargetNote();
		fixture.view.setMode('edit');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Selection');

		await fixture.view.switchActiveSession('a2');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Selection');
		await fixture.view.switchActiveSession('a1');
		expect(findChatInput(fixture.contentEl)?.value).toBe('A draft');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Selection');

		chooseWritingMenuItem(fixture.contentEl, 'Chat · Selection');
		chooseWritingMenuItem(fixture.contentEl, 'Edit · Selection · Full note');
		chooseWritingMenuItem(fixture.contentEl, 'Edit · Full note');
		fixture.setActivePath('B.md');
		fixture.setSelectedText('beta');
		await fixture.view.refreshTargetNote();

		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Selection');
		expect(findChatInput(fixture.contentEl)?.value).toBe('');
		fixture.view.setMode('ask');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Chat');
		fixture.view.setMode('edit');
		setChatInput(fixture, 'B draft');
		chooseWritingMenuItem(fixture.contentEl, 'Edit · Full note');

		fixture.setActivePath('A.md');
		fixture.setSelectedText('');
		await fixture.view.refreshTargetNote();
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Full note');
		expect(findChatInput(fixture.contentEl)?.value).toBe('A draft');
		fixture.setActivePath('B.md');
		await fixture.view.refreshTargetNote();
		expect(findChatInput(fixture.contentEl)?.value).toBe('B draft');
	});

	it('updates automatic Selection-first targeting without replacing composer DOM or reloading chat', async () => {
		const fixture = createPublicChatViewFixture({ sourceText: 'Alpha beta.' });
		await fixture.open();
		fixture.view.setMode('edit');
		const composer = findChatInput(fixture.contentEl);
		const writingTrigger = findWritingTrigger(fixture.contentEl);
		setChatInput(fixture, 'Unsubmitted draft');
		const render = vi.spyOn(fixture.contentEl, 'empty');
		fixture.setSelectedText('beta');

		await fixture.view.refreshTargetNote();

		expect(findWritingTrigger(fixture.contentEl)).toBe(writingTrigger);
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Selection');
		expect(findChatInput(fixture.contentEl)).toBe(composer);
		expect(findChatInput(fixture.contentEl)?.value).toBe('Unsubmitted draft');
		expect(render).not.toHaveBeenCalled();
		expect(fixture.conversationStore.loadConversation).toHaveBeenCalledOnce();
		expectNoRequestsOrReads(fixture);
	});

	it('keeps Related notes available in Chat and enables every quick action in Edit', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
		});
		await fixture.open();

		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Chat');
		expect(findWritingTrigger(fixture.contentEl)?.disabled).toBe(false);
		expect(findElements(fixture.contentEl, (element) =>
			element.className.split(' ').includes('emend-chat-related-notes-trigger')
		)).toHaveLength(1);
		expect(findElements(fixture.contentEl, (element) =>
			element.className.split(' ').includes('emend-chat-quick-action')
		)).toHaveLength(0);

		fixture.view.setMode('edit');
		const quickActions = findElements(
			fixture.contentEl,
			(element) => element.className.split(' ').includes('emend-chat-quick-action'),
		);
		expect(quickActions).toHaveLength(3);
		expect(quickActions.every((button) => !button.disabled)).toBe(true);
	});

	it('changes target state without requests or content reads and preserves the draft', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
		});
		await fixture.open();
		setChatInput(fixture, 'Draft survives target choices');
		chooseWritingMenuItem(fixture.contentEl, 'Edit · Full note');
		fixture.setSelectedText('');
		await fixture.view.refreshTargetNote();

		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Full note');
		expect(findChatInput(fixture.contentEl)?.value).toBe('Draft survives target choices');
		expectNoRequestsOrReads(fixture);
	});

	it('synchronizes Edit controls after quick-action Selection capture fails and preserves the draft', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
		});
		const savedSnapshots = captureReadyMessageSaves(fixture, makeSession());
		const capture = fixture.captureSelectionEditTarget.getMockImplementation();
		if (!capture) {
			throw new Error('Selection capture double missing.');
		}
		fixture.requestSelectionEdit.mockResolvedValue({
			applied: false,
			changeCount: 0,
			summaryItems: [],
			usage: {
				promptTokens: 2,
				completionTokens: 1,
				totalTokens: 3,
				source: 'provider',
			},
		});
		await fixture.open();
		chooseWritingMenuItem(fixture.contentEl, 'Web Review');
		chooseWritingMenuItem(fixture.contentEl, 'Edit · Selection');
		setChatInput(fixture, 'Preserve this draft');
		fixture.captureSelectionEditTarget.mockImplementation(() => {
			throw new Error('Select non-whitespace text first.');
		});

		findQuickActionButton(fixture.contentEl, 'fix-grammar')?.dispatch('click');
		await vi.waitFor(() => expect(noticeMessages()).toContain(
			'Emend: Select non-whitespace text first.',
		));

		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Selection');
		expect(findWritingTrigger(fixture.contentEl)?.disabled).toBe(false);
		const editMenu = openWritingMenu(fixture.contentEl);
		expect(findChatViewMenuItem(editMenu, 'Web Off').checked).toBe(true);
		expect(findChatViewMenuItem(editMenu, 'Web Review').disabled).toBe(true);
		editMenu.hide();
		expect(findChatInput(fixture.contentEl)?.value).toBe('Preserve this draft');
		expect(findChatInput(fixture.contentEl)?.attributes.placeholder).toContain(
			'Edit the note or selection...',
		);
		expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(findMessageElements(fixture.contentEl)).toEqual([]);
		expect(fixture.conversationStore.appendReadyMessage).not.toHaveBeenCalled();
		for (const target of capturedSelectionTargets(fixture)) {
			expect(target.editor.replaceRange).not.toHaveBeenCalled();
		}

		fixture.captureSelectionEditTarget.mockImplementation(capture);
		setChatInput(fixture, 'Send using the visible mode');
		findSubmissionButton(fixture.contentEl, 'Send')?.dispatch('click');
		await vi.waitFor(() => expect(fixture.requestSelectionEdit).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(savedSnapshots).toHaveLength(2));

		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Selection');
	});
});


describe('EmendChatView public edit submission and capacity', () => {
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

	it('formats full-note summaries against the captured note source', async () => {
		const sourceText = 'Intro line.\nSecond line.\nThird line.\nTarget line.\nOutro line.';
		const targetStart = sourceText.indexOf('Target line.');
		const fixture = createPublicChatViewFixture({
			sourceText,
			defaultMode: 'edit',
		});
		const savedSnapshots = captureReadyMessageSaves(fixture, makeSession());
		const capture = fixture.captureChatContext.getMockImplementation();
		if (!capture) {
			throw new Error('Chat context capture double missing.');
		}
		fixture.captureChatContext.mockImplementation(() => ({
			...capture(),
			markdown: 'Window line.\nTarget line.',
		}));
		fixture.requestChatCompletion.mockResolvedValue({
			applied: true,
			changeCount: 1,
			summaryItems: [{
				type: 'replace',
				start: targetStart,
				end: targetStart + 'Target line.'.length,
			}],
			summary: 'Sharpened the target line.',
			usage: {
				promptTokens: 3,
				completionTokens: 1,
				totalTokens: 4,
				source: 'provider',
			},
		});
		await fixture.open();
		setChatInput(fixture, 'Edit note');

		await fixture.view.submitPrompt();

		const expected = [
			'Edit applied — 1 changes tracked. Review in Track Changes.',
			'Target: Full note.',
			'',
			'Sharpened the target line.',
			'',
			'- Replaced line 4.',
		].join('\n');
		expect(savedSnapshots[1]?.[1]?.content).toBe(expected);
		expect(textOf(fixture.contentEl)).toContain('Sharpened the target line.');
		expect(textOf(fixture.contentEl)).toContain('- Replaced line 4.');
	});

	it('renders a full-note summary with no bullets', async () => {
		const fixture = createPublicChatViewFixture({ defaultMode: 'edit' });
		const savedSnapshots = captureReadyMessageSaves(fixture, makeSession());
		fixture.requestChatCompletion.mockResolvedValue({
			applied: true,
			changeCount: 0,
			summaryItems: [],
			summary: 'Reviewed without changing the note.',
			usage: {
				promptTokens: 3,
				completionTokens: 1,
				totalTokens: 4,
				source: 'provider',
			},
		});
		await fixture.open();
		setChatInput(fixture, 'Edit note');

		await fixture.view.submitPrompt();

		const expected = [
			'Edit applied — 0 changes tracked. Review in Track Changes.',
			'Target: Full note.',
			'',
			'Reviewed without changing the note.',
		].join('\n');
		expect(savedSnapshots[1]?.[1]?.content).toBe(expected);
		expect(textOf(fixture.contentEl)).toContain('Reviewed without changing the note.');
		expect(savedSnapshots[1]?.[1]?.content).not.toContain('\n- ');
	});

	it('keeps explicit Full note on the ordinary request despite a usable selection', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
			defaultMode: 'edit',
		});
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
		chooseWritingMenuItem(fixture.contentEl, 'Edit · Full note');
		fixture.captureChatContext.mockClear();
		fixture.captureSelectionEditTarget.mockClear();
		setChatInput(fixture, 'Edit note');
		const captureIndex = fixture.captureChatContext.mock.calls.length;

		await fixture.view.submitPrompt();

		const submittedContext = fixture.captureChatContext.mock.results[captureIndex]
			?.value as RequestContext | undefined;
		expect(fixture.captureChatContext).toHaveBeenCalled();
		expect(fixture.requestChatCompletion).toHaveBeenCalledOnce();
		expect(fixture.requestChatCompletion.mock.calls[0]?.[0].context).toBe(submittedContext);
		expect(fixture.captureSelectionEditTarget).not.toHaveBeenCalled();
		expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
	});

	it.each(['auto', 'selection'] as const)(
		'fails closed without messages, saves, or fallback when %s Selection capture fails',
		async (choice) => {
			const fixture = createPublicChatViewFixture({
				sourceText: 'Alpha beta.',
				selectedText: 'beta',
				defaultMode: 'edit',
			});
			await fixture.open();
			if (choice === 'selection') {
				chooseWritingMenuItem(fixture.contentEl, 'Edit · Selection');
			}
			const selectionCapture = fixture.captureSelectionEditTarget.getMockImplementation();
			const chatCapture = fixture.captureChatContext.getMockImplementation();
			if (!selectionCapture || !chatCapture) {
				throw new Error('Submission capture doubles missing.');
			}
			const failureNotice = 'Emend: Select non-whitespace text first.';
			let selectionCapturesBeforeNotice = 0;
			let fullNoteCapturesBeforeNotice = 0;
			fixture.captureSelectionEditTarget.mockImplementation(() => {
				if (!noticeMessages().includes(failureNotice)) {
					selectionCapturesBeforeNotice++;
				}
				return selectionCapture();
			});
			fixture.captureChatContext.mockImplementation(() => {
				if (!noticeMessages().includes(failureNotice)) {
					fullNoteCapturesBeforeNotice++;
				}
				return chatCapture();
			});
			fixture.captureChatContext.mockClear();
			fixture.captureSelectionEditTarget.mockClear();
			fixture.setSelectedText('');
			setChatInput(fixture, 'Edit the vanished selection');

			await fixture.view.submitPrompt();

			expect(noticeMessages()).toEqual([failureNotice]);
			expect(selectionCapturesBeforeNotice).toBe(1);
			expect(fullNoteCapturesBeforeNotice).toBe(0);
			expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
			expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
			expect(findMessageElements(fixture.contentEl)).toEqual([]);
			expect(fixture.conversationStore.createSession).not.toHaveBeenCalled();
			expect(fixture.conversationStore.appendReadyMessage).not.toHaveBeenCalled();
			expect(findSubmissionButton(fixture.contentEl, 'Stop')).toBeUndefined();
			for (const target of capturedSelectionTargets(fixture)) {
				expect(target.editor.replaceRange).not.toHaveBeenCalled();
			}
		},
	);

	it.each(['full-note', 'selection'] as const)(
		'rejects captured %s source-path mismatches before messages or saves',
		async (target) => {
			const fixture = createPublicChatViewFixture({
				sourceText: 'Alpha beta.',
				selectedText: target === 'selection' ? 'beta' : '',
				defaultMode: 'edit',
			});
			await fixture.open();
			if (target === 'selection') {
				const capture = fixture.captureSelectionEditTarget.getMockImplementation();
				if (!capture) {
					throw new Error('Selection capture double missing.');
				}
				fixture.captureSelectionEditTarget.mockImplementation(() => {
					const captured = capture();
					captured.snapshot.file.path = 'Other.md';
					return captured;
				});
			} else {
				const capture = fixture.captureChatContext.getMockImplementation();
				if (!capture) {
					throw new Error('Chat context capture double missing.');
				}
				fixture.captureChatContext.mockImplementation(() => {
					const captured = capture();
					captured.file.path = 'Other.md';
					return captured;
				});
			}
			setChatInput(fixture, 'Edit mismatched source');

			await fixture.view.submitPrompt();

			expect(noticeMessages()).toEqual([
				'Emend: The active note changed before the request started. Try again.',
			]);
			expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
			expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
			expect(findMessageElements(fixture.contentEl)).toEqual([]);
			expect(fixture.conversationStore.createSession).not.toHaveBeenCalled();
			expect(fixture.conversationStore.appendReadyMessage).not.toHaveBeenCalled();
		},
	);

	it('aborts Chat Selection on a note switch and resets all target policies', async () => {
		const fixture = createPublicChatViewFixture({
			activePath: 'A.md',
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
		});
		await fixture.open();
		chooseWritingMenuItem(fixture.contentEl, 'Chat · Selection');
		fixture.captureSelectionEditTarget.mockClear();
		const response = deferred<SessionChatResult>();
		let requestSignal: AbortSignal | undefined;
		fixture.requestChatCompletion.mockImplementationOnce((async (
			submission: ReadOnlySubmission,
		) => {
			requestSignal = submission.signal;
			return response.promise;
		}) as unknown as EmendPlugin['requestChatCompletion']);
		setChatInput(fixture, 'Focused question');
		const submission = fixture.view.submitPrompt();
		await vi.waitFor(() => expect(fixture.requestChatCompletion).toHaveBeenCalledOnce());
		expect(fixture.captureSelectionEditTarget).not.toHaveBeenCalled();
		expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();

		fixture.setSelectedText('');
		fixture.setActivePath('B.md');
		await fixture.view.refreshTargetNote();
		expect(requestSignal?.aborted).toBe(true);
		response.resolve({ content: 'Late answer', reasoning: '' });
		await submission;

		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Chat');
		expect(textOf(fixture.contentEl)).not.toContain('Late answer');
		expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
		fixture.setSelectedText('beta');
		fixture.view.setMode('edit');
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Selection');
	});

	it('uses the complete full-note source instead of the bounded Markdown window', async () => {
		const sourceText = `Intro.\n${'Long paragraph. '.repeat(300)}`;
		const fixture = createPublicChatViewFixture({
			sourceText,
			defaultMode: 'edit',
		});
		const capture = fixture.captureChatContext.getMockImplementation();
		if (!capture) {
			throw new Error('Chat context capture double missing.');
		}
		fixture.captureChatContext.mockImplementation(() => ({
			...capture(),
			markdown: 'Window only.',
		}));
		await fixture.open();
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Full note');
		const provider = fixture.settings.providers[fixture.settings.activeProvider];
		const context = fixture.captureChatContext();
		const fullTokens = buildFullNoteDraftEstimate({
			provider,
			context,
			prompt: '',
			history: [],
		}).categories.estimatedInputTokens;
		const windowTokens = buildReadOnlyDraftEstimate({
			provider,
			context,
			mode: 'ask',
			chatTarget: 'note',
			prompt: '',
			history: [],
		}).categories.estimatedInputTokens;
		expect(windowTokens).toBeLessThan(fullTokens);

		provider.contextWindowTokens = fullTokens + 1;
		provider.outputReserveTokens = 1;
		fixture.view.refreshCapacityEstimate();

		const estimate = buildFullNoteDraftEstimate({
			provider,
			context,
			prompt: '',
			history: [],
		});
		expect(estimate.capacity).toMatchObject({ effectiveInputTokens: fullTokens });
		expect(estimate.overCapacity).toBe(true);
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			`Estimated input: ${fullTokens} tokens of ${fullTokens} effective capacity. This draft is over capacity.`,
		);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(true);
		expect(fixture.captureSelectionEditTarget).not.toHaveBeenCalled();
	});

	it('uses the captured Selection snapshot and updates when the Edit target changes', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
			defaultMode: 'edit',
		});
		fixture.settings.includeNotePathInContext = true;
		fixture.settings.providers.custom.contextWindowTokens = 1000;
		fixture.settings.providers.custom.outputReserveTokens = 100;
		await fixture.open();
		const snapshot = fixture.captureSelectionEditTarget().snapshot;

		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Selection');
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedSelectionCapacity(fixture, snapshot, ''),
		);
		expect(snapshot).toMatchObject({
			fullText: 'Alpha beta.',
			selectedText: 'beta',
			from: 6,
			to: 10,
		});
		expect(fixture.captureChatContext).not.toHaveBeenCalled();

		chooseWritingMenuItem(fixture.contentEl, 'Edit · Full note');

		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Full note');
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedFullNoteCapacity(fixture, makeSession(), ''),
		);
		expect(fixture.captureChatContext).toHaveBeenCalled();
	});

	it('keeps small Selection quick actions enabled while the full note is over capacity', async () => {
		const sourceText = `Intro.\n${'x'.repeat(20000)}\nbeta\n${'y'.repeat(20000)}`;
		const fixture = createPublicChatViewFixture({
			sourceText,
			selectedText: 'beta',
			defaultMode: 'edit',
		});
		await fixture.open();
		const snapshot = fixture.captureSelectionEditTarget().snapshot;
		const provider = fixture.settings.providers[fixture.settings.activeProvider];
		const selectionTokens = Math.max(
			...QUICK_ACTIONS.map((action) => selectionCapacityEstimate(
				fixture,
				snapshot,
				action.prompt,
			).categories.estimatedInputTokens),
		);
		const fullNoteTokens = buildFullNoteDraftEstimate({
			provider,
			context: fixture.captureChatContext(),
			prompt: QUICK_ACTIONS[1].prompt,
			history: [],
		}).categories.estimatedInputTokens;
		expect(fullNoteTokens).toBeGreaterThan(selectionTokens);
		provider.contextWindowTokens = selectionTokens + 2;
		provider.outputReserveTokens = 1;
		fixture.view.refreshCapacityEstimate();

		expect(buildFullNoteDraftEstimate({
			provider,
			context: fixture.captureChatContext(),
			prompt: '',
			history: [],
		}).overCapacity).toBe(true);
		expect(selectionCapacityEstimate(fixture, snapshot, '').overCapacity).toBe(false);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(false);
		for (const action of QUICK_ACTIONS) {
			expect(findQuickActionButton(fixture.contentEl, action.id)?.disabled).toBe(false);
		}
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
	});

	it('refreshes the automatic Edit target when the selection appears', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			defaultMode: 'edit',
		});
		fixture.settings.providers.custom.contextWindowTokens = 1000;
		fixture.settings.providers.custom.outputReserveTokens = 100;
		await fixture.open();
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Full note');
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedFullNoteCapacity(fixture, makeSession(), ''),
		);

		fixture.setSelectedText('beta');
		fixture.emitWorkspaceEvent('editor-selection-change');
		await vi.waitFor(() => expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe(
			'Edit · Selection',
		));
		const snapshot = fixture.captureSelectionEditTarget().snapshot;
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedSelectionCapacity(fixture, snapshot, ''),
		);
		expectNoRequestsOrReads(fixture);
		for (const target of capturedSelectionTargets(fixture)) {
			expect(target.editor.replaceRange).not.toHaveBeenCalled();
		}
	});

	it('captures the selection and additional-note paths before a deferred initial save', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
			defaultMode: 'edit',
		});
		const savedSnapshots = captureReadyMessageSaves(fixture, makeSession());
		fixture.additionalNotesStore.add('Note.md', 'Selected.md');
		fixture.requestSelectionEdit.mockResolvedValue({
			applied: false,
			changeCount: 0,
			summaryItems: [],
			usage: {
				promptTokens: 2,
				completionTokens: 1,
				totalTokens: 3,
				source: 'provider',
			},
		});
		await fixture.open();
		const firstSave = deferred<void>();
		const append = fixture.conversationStore.appendReadyMessage.getMockImplementation();
		if (!append) {
			throw new Error('Ready-message save double missing.');
		}
		fixture.conversationStore.appendReadyMessage.mockImplementationOnce(async (...args) => {
			await firstSave.promise;
			return append(...args);
		});
		setChatInput(fixture, 'Edit selection');

		const captureIndex = fixture.captureSelectionEditTarget.mock.calls.length;
		const submission = fixture.view.submitPrompt();
		await vi.waitFor(() => expect(
			fixture.conversationStore.appendReadyMessage,
		).toHaveBeenCalledOnce());
		const originalTarget = fixture.captureSelectionEditTarget.mock.results[captureIndex]
			?.value as SelectionEditTarget | undefined;
		if (!originalTarget) {
			throw new Error('Submitted Selection target missing.');
		}
		expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();

		fixture.setSelectedText('');
		await fixture.view.refreshTargetNote();
		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Full note');
		fixture.additionalNotesStore.clear('Note.md');
		fixture.additionalNotesStore.add('Note.md', 'Later.md');
		firstSave.resolve();
		await vi.waitFor(() => expect(fixture.requestSelectionEdit).toHaveBeenCalledOnce());

		const args = fixture.requestSelectionEdit.mock.calls[0];
		expect(args?.[0]).toBe(originalTarget.snapshot);
		expect(args?.[0]).toMatchObject({
			fullText: 'Alpha beta.',
			selectedText: 'beta',
			from: 6,
			to: 10,
		});
		expect(args?.[3]).toBe(originalTarget.editor);
		expect(args?.[4]).toEqual(['Selected.md']);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		await submission;
		expect(savedSnapshots[1]?.[1]?.content).toBe('No changes were needed.');
	});

	it('aborts the captured selection request on a note switch without saving it to the new thread', async () => {
		const fixture = createPublicChatViewFixture({
			sourceText: 'Alpha beta.',
			selectedText: 'beta',
			defaultMode: 'edit',
		});
		const session = makeSession();
		const savedSnapshots = captureReadyMessageSaves(fixture, session);
		fixture.conversationStore.loadConversation.mockImplementation(async (notePath) =>
			notePath === 'Note.md'
				? loadedConversation([session])
				: loadedConversation([])
		);
		const response = deferred<SelectionEditResult>();
		let requestSignal: AbortSignal | undefined;
		fixture.requestSelectionEdit.mockImplementationOnce((
			_snapshot,
			_prompt,
			signal,
		) => {
			requestSignal = signal;
			return response.promise;
		});
		await fixture.open();
		setChatInput(fixture, 'Edit selection');
		const submission = fixture.view.submitPrompt();
		await vi.waitFor(() => expect(fixture.requestSelectionEdit).toHaveBeenCalledOnce());
		expect(savedSnapshots).toHaveLength(1);

		fixture.setSelectedText('');
		fixture.setActivePath('Other.md');
		await fixture.view.refreshTargetNote();
		expect(requestSignal?.aborted).toBe(true);
		response.resolve({
			applied: false,
			changeCount: 0,
			summaryItems: [],
			usage: {
				promptTokens: 2,
				completionTokens: 1,
				totalTokens: 3,
				source: 'provider',
			},
		});
		await submission;

		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Full note');
		expect(findMessageElements(fixture.contentEl)).toEqual([]);
		expect(findSubmissionButton(fixture.contentEl, 'Stop')).toBeUndefined();
		expect(savedSnapshots).toHaveLength(1);
		expect(savedSnapshots.flat().some((message) => message.status === 'stopped')).toBe(false);
		expect(fixture.conversationStore.appendReadyMessage).toHaveBeenCalledOnce();
		expect(fixture.conversationStore.appendReadyMessage.mock.calls[0]?.[0]).toBe('Note.md');
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	});
});


describe('EmendChatView public dismissed controls', () => {
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

	it.each(['writing', 'model'] as const)(
		'does not mutate dismissed %s menus through real view refreshes',
		async (surface) => {
			const fixture = createPublicChatViewFixture();
			await fixture.open();
			const trigger = surface === 'writing'
				? findWritingTrigger(fixture.contentEl)
				: findModelTrigger(fixture.contentEl);
			if (!trigger) {
				throw new Error(`Missing ${surface} trigger.`);
			}
			trigger.dispatch('click');
			const menu = chatViewMenus.instances.at(-1);
			if (!menu) {
				throw new Error(`The ${surface} trigger did not open a menu.`);
			}
			const item = findChatViewMenuItem(
				menu,
				surface === 'writing' ? 'Chat' : 'deepseek-flash',
			);
			const setChecked = vi.spyOn(item, 'setChecked');
			const setDisabled = vi.spyOn(item, 'setDisabled');
			expect(trigger.attributes['aria-expanded']).toBe('true');

			menu.hide();
			setChecked.mockClear();
			setDisabled.mockClear();
			if (surface === 'writing') {
				fixture.view.refreshCapacityEstimate();
			} else {
				fixture.settings.activeProvider = 'kimi';
				fixture.view.refreshModelControl();
			}

			expect(setChecked).not.toHaveBeenCalled();
			expect(setDisabled).not.toHaveBeenCalled();
			expect(trigger.attributes['aria-expanded']).toBe('false');
		},
	);

	it('accepts a just-hidden writing menu item through real view wiring', async () => {
		const fixture = createPublicChatViewFixture();
		await fixture.open();
		const trigger = findWritingTrigger(fixture.contentEl);
		if (!trigger) {
			throw new Error('Writing trigger missing.');
		}
		trigger.dispatch('click');
		const menu = chatViewMenus.instances.at(-1);
		if (!menu) {
			throw new Error('The writing trigger did not open a menu.');
		}
		const item = findChatViewMenuItem(menu, 'Edit · Full note');

		menu.hide();
		item.clickHandler({} as MouseEvent);

		expect(findWritingTrigger(fixture.contentEl)?.textContent).toBe('Edit · Full note');
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
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
