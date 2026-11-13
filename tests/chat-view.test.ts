import { readFileSync } from 'node:fs';
import { MarkdownRenderer, Notice, Scope, TFile, WorkspaceLeaf } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdditionalNotesStore } from '../src/additional-notes-store';
import { deriveAutomaticTitle, type ChatSession } from '../src/chat-sessions';
import type { ShortcutEvent } from '../src/chat-shortcuts';
import {
	EmendChatView,
	formatChatMessageForCopy,
	getUnreadPageCount,
	type ActiveRequest,
} from '../src/chat-view';
import { buildDraftCapacityEstimate } from '../src/context-capacity-ui';
import { formatVaultQualifiedPath } from '../src/context';
import type { LoadedChatConversation } from '../src/conversation-store';
import { normalizeContextLimit } from '../src/settings';
import { getEditStrategy } from '../src/edit-strategy';
import type { EditSummaryItem } from '../src/edit-strategy';
import { getSystemPrompt } from '../src/mode';
import { operationEditStrategy } from '../src/operation-edit-strategy';
import { QUICK_ACTIONS } from '../src/quick-actions';
import { buildUserPrompt } from '../src/request-coordinator';
import { buildSelectionUserPrompt } from '../src/selection-editor';
import type {
	AiProviderRequest,
	StreamEvent,
	StreamResult,
} from '../src/provider-stream';
import {
	EditRequestCoordinator,
	type ChatStreamResult,
	type EditSubmission,
	type ReadOnlySubmission,
} from '../src/request-coordinator';
import type {
	SelectionEditCallbacks,
	SelectionEditResult,
	SelectionEditorAdapter,
} from '../src/selection-editor';
import type {
	ChatMessage,
	Mode,
	ProviderConfig,
	ProviderHistoryMessage,
	SelectionSnapshot,
} from '../src/types';
import type { WebActivityRecord } from '../src/web-search';

function getCssRule(selector: string): string {
	const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
	const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('EmendChatView mode button hover styles', () => {
	it('keeps text readable on distinct non-active and active hover backgrounds', () => {
		const nonActive = getCssRule('.emend-chat-mode-button:hover');
		const active = getCssRule('.emend-chat-mode-button.is-active:hover');

		expect(nonActive).toContain('background: var(--background-modifier-hover);');
		expect(nonActive).toContain('color: var(--text-normal);');
		expect(active).toContain('background: var(--interactive-accent-hover);');
		expect(active).toContain('color: var(--text-normal);');
	});
});

describe('EmendChatView header styles', () => {
	it('stacks shortcut groups below the wrapping title row', () => {
		expect(getCssRule('.emend-chat-title-row')).toContain('flex-wrap: wrap;');
		expect(getCssRule('.emend-chat-shortcuts')).toContain('flex-direction: column;');
	});

	it('wraps shortcut items within each group', () => {
		const group = getCssRule('.emend-chat-shortcut-group');
		expect(group).toContain('display: flex;');
		expect(group).toContain('flex-wrap: wrap;');
	});

	it('keeps each key badge paired with its action', () => {
		const shortcut = getCssRule('.emend-chat-shortcut');
		expect(shortcut).toContain('display: inline-flex;');
		expect(shortcut).toContain('align-items: center;');
	});

	it('distinguishes key badges from action text', () => {
		const badge = getCssRule('.emend-chat-shortcut kbd');
		expect(badge).toContain('border: 1px solid var(--background-modifier-border);');
		expect(badge).toContain('background: var(--background-secondary);');
		expect(badge).toContain('color: var(--text-normal);');
	});

	it('uses muted text for the build identity and shortcuts', () => {
		expect(getCssRule('.emend-chat-build')).toContain('color: var(--text-muted);');
		expect(getCssRule('.emend-chat-shortcuts')).toContain('color: var(--text-muted);');
	});

	it('retains context ellipsis', () => {
		expect(getCssRule('.emend-chat-context')).toContain('text-overflow: ellipsis;');
	});
});

// eslint-disable-next-line @typescript-eslint/unbound-method -- The test wrapper supplies an explicit receiver.
const productionSubmitPrompt = (EmendChatView.prototype as unknown as {
	submitPrompt(
		this: unknown,
		prompt?: string,
		options?: { fromQuickAction?: boolean },
	): Promise<void>;
}).submitPrompt;
// eslint-disable-next-line @typescript-eslint/unbound-method -- The test wrapper supplies an explicit receiver.
const productionRefreshTargetNote = (EmendChatView.prototype as unknown as {
	refreshTargetNote(this: unknown): Promise<void>;
}).refreshTargetNote;

const viewPrototype = EmendChatView.prototype as unknown as {
	onOpen(this: unknown): Promise<void>;
	refreshTargetNote(this: unknown): Promise<void>;
	switchActiveSession(this: unknown, sessionId: string): Promise<void>;
	createNewSession(this: unknown): Promise<void>;
	renameActiveSession(this: unknown, title: string): Promise<void>;
	deleteActiveSession(this: unknown): Promise<void>;
	submitPrompt(this: unknown): Promise<void>;
	handleComposerKeydown(
		this: unknown,
		event: ShortcutEvent & { preventDefault(): void },
	): void;
	setMode(this: unknown, mode: Mode): void;
	registerComposerScope(this: unknown): void;
	render(this: unknown): void;
	renderMessage(this: unknown, containerEl: HTMLElement, message: ChatMessage): void;
	renderMessageBody(this: unknown, message: ChatMessage): void;
	scrollMessagesToBottom(this: unknown): void;
	scrollMessagesToBottomIfFollowing(this: unknown): void;
	restoreMessageScroll(this: unknown, previousScrollTop: number, wasFollowing: boolean): void;
	settleMarkdownRender(this: unknown, generation: number): void;
	scheduleMessageRender(this: unknown, message: ChatMessage): void;
	getDisplayText(this: unknown): string;
	onClose(this: unknown): Promise<void>;
	toProviderHistory(this: unknown): ProviderHistoryMessage[];
	refreshDraftEstimate(this: unknown, prompt?: string): void;
	refreshCapacityEstimate(this: unknown): void;
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
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

type SessionChatResult = Pick<ChatStreamResult, 'content' | 'reasoning'> &
	Partial<ChatStreamResult>;

function makeSession(id: string, messages: ChatMessage[] = []): ChatSession {
	return {
		id,
		title: 'New chat',
		titleSource: 'auto',
		createdAt: 1,
		updatedAt: 1,
		messages,
	};
}

function loadedConversation(
	sessions: ChatSession[],
	activeSessionId: string | null = sessions[0]?.id ?? null,
	kind: LoadedChatConversation['kind'] = 'schema3',
): LoadedChatConversation {
	return {
		kind,
		conversation: { version: 3, lastActiveSessionId: activeSessionId, sessions },
	};
}

async function beginDelayedTransientCreate(abortKind: 'stop' | 'note-switch') {
	const fixture = createEditTargetView();
	const initialCreate = deferred<void>();
	let persisted: ChatSession | undefined;
	let firstCreate = true;
	fixture.conversationStore.loadConversation.mockImplementation(async (notePath: string) => {
		if (notePath === 'A.md' && persisted) {
			return loadedConversation([persisted]);
		}
		return loadedConversation([]);
	});
	fixture.conversationStore.createSession.mockImplementation(async (_notePath, session) => {
		if (firstCreate) {
			firstCreate = false;
			await initialCreate.promise;
		}
		persisted = { ...session, updatedAt: 999 };
		return persisted;
	});
	fixture.conversationStore.appendReadyMessage.mockImplementation(
		async (_notePath, sessionId, appended, options) => {
			const session = persisted?.id === sessionId ? persisted : makeSession(sessionId);
			const updated = {
				...session,
				title: options?.titlePrompt === undefined
					? session.title
					: deriveAutomaticTitle(options.titlePrompt),
				messages: [...session.messages, appended],
			};
			if (sessionId === persisted?.id) {
				persisted = updated;
			}
			return updated;
		},
	);
	fixture.conversationStore.renameSession.mockImplementation(
		async (_notePath, sessionId, title) => {
			const session = persisted?.id === sessionId ? persisted : makeSession(sessionId);
			const renamed = { ...session, title, titleSource: 'manual' as const };
			if (sessionId === persisted?.id) {
				persisted = renamed;
			}
			return renamed;
		},
	);
	fixture.conversationStore.deleteSession.mockImplementation(async () => {
		persisted = undefined;
		return { activeSessionId: null };
	});
	fixture.requestChatCompletion.mockImplementation(async ({ callbacks }) => {
		callbacks.onContent('Retry answer');
		return { content: 'Retry answer', reasoning: '' };
	});
	await viewPrototype.refreshTargetNote.call(fixture.context);
	const transientId = fixture.context.activeSessionId;
	if (!transientId) {
		throw new Error('Transient session missing.');
	}
	const transient = fixture.context.sessions[0];
	const originalUpdatedAt = transient?.updatedAt;
	if (fixture.context.inputEl) {
		fixture.context.inputEl.value = 'Initial question';
	}
	const submission = viewPrototype.submitPrompt.call(fixture.context);
	await vi.waitFor(() => expect(fixture.conversationStore.createSession).toHaveBeenCalledOnce());
	if (abortKind === 'stop') {
		fixture.context.activeController?.abort();
	} else {
		fixture.setActivePath('B.md');
		await viewPrototype.refreshTargetNote.call(fixture.context);
	}
	initialCreate.resolve();
	await submission;
	if (abortKind === 'note-switch') {
		fixture.setActivePath('A.md');
		await viewPrototype.refreshTargetNote.call(fixture.context);
	}
	return {
		fixture,
		transient,
		transientId,
		originalUpdatedAt,
		persisted: () => persisted,
	};
}

function prepareSubmissionFixture(target: unknown) {
	Object.setPrototypeOf(target, EmendChatView.prototype);
	const context = target as {
		notePath?: string | null;
		sessions?: ChatSession[];
		activeSessionId?: string | null;
		conversationGeneration?: number;
		activeRequest?: null;
		isSessionMutating?: boolean;
		transientSessionIds?: Set<string>;
		transientSessions?: Map<string, ChatSession>;
		messages: ChatMessage[];
		drafts?: Map<string, Map<string, string>>;
	};
	context.notePath ??= 'Note.md';
	context.conversationGeneration ??= 0;
	context.activeRequest ??= null;
	context.isSessionMutating ??= false;
	if (!context.sessions) {
		const session = makeSession(context.activeSessionId ?? 'session-1', context.messages);
		context.sessions = [session];
		context.activeSessionId = session.id;
		context.transientSessionIds = new Set([session.id]);
		context.transientSessions = new Map([[context.notePath, session]]);
	}
	context.drafts ??= new Map();
	return target;
}

viewPrototype.submitPrompt = function (
	this: unknown,
	prompt?: string,
	options?: { fromQuickAction?: boolean },
) {
	return productionSubmitPrompt.call(prepareSubmissionFixture(this), prompt, options);
};

viewPrototype.refreshTargetNote = function (this: unknown) {
	Object.setPrototypeOf(this, EmendChatView.prototype);
	const context = this as {
		conversationGeneration?: number;
		sessions?: ChatSession[];
		activeSessionId?: string | null;
		activeRequest?: null;
		isSessionMutating?: boolean;
		transientSessionIds?: Set<string>;
		transientSessions?: Map<string, ChatSession>;
		drafts?: Map<string, Map<string, string>>;
	};
	context.conversationGeneration ??= 0;
	context.sessions ??= [];
	context.activeSessionId ??= null;
	context.activeRequest ??= null;
	context.isSessionMutating ??= false;
	context.transientSessionIds ??= new Set();
	context.transientSessions ??= new Map();
	context.drafts ??= new Map();
	return productionRefreshTargetNote.call(this);
};

function createEditTargetView(options: {
	activePath?: string;
	selectedText?: string;
} = {}) {
	let activePath = options.activePath ?? 'A.md';
	let selectedText = options.selectedText ?? '';
	const contentEl = new FakeElement();
	const additionalNotesStore = new AdditionalNotesStore();
	const read = vi.fn();
	const requestChatCompletion = vi.fn<
		(submission: ReadOnlySubmission) => Promise<SessionChatResult>
	>();
	const captureChatContext = vi.fn(() => ({
		file: { path: activePath },
		sourceText: '',
		selection: { from: 0, to: 0 },
		noteLabel: activePath,
		markdown: '',
	}));
	const conversationStore = {
		loadConversation: vi.fn<(notePath: string) => Promise<LoadedChatConversation>>(
			async () => loadedConversation([]),
		),
		createSession: vi.fn(async (_notePath: string, session: ChatSession) => session),
		appendReadyMessage: vi.fn<(
			notePath: string,
			sessionId: string,
			message: ChatMessage,
			options?: { titlePrompt?: string; now?: number; signal?: AbortSignal },
		) => Promise<ChatSession>>(),
		setActiveSession: vi.fn(async () => undefined),
		renameSession: vi.fn(async (
			_notePath: string,
			_sessionId: string,
			title: string,
		): Promise<ChatSession> => ({
			...makeSession('unused'),
			title,
			titleSource: 'manual',
		})),
		deleteSession: vi.fn(async (): Promise<{ activeSessionId: string | null }> => ({
			activeSessionId: null,
		})),
		reorderSessions: vi.fn(async () => undefined),
	};
	const context = {
		app: { vault: { adapter: { read } } },
		contentEl,
		plugin: {
			getActiveNotePath: () => activePath,
			getActiveNoteLabel: () => activePath,
			hasUsableSelection: () => Boolean(selectedText.trim()),
			captureChatContext,
			conversationStore,
			additionalNotesStore,
			requestChatCompletion,
			settings: {
				activeProvider: 'custom',
				historyMessageLimit: 8,
				providers: {
					custom: {
						name: 'Local',
						model: 'Test model',
						contextWindowTokens: null,
						outputReserveTokens: null,
						contextCapacityInvalid: false,
					},
				},
			},
		},
		notePath: null as string | null,
		conversationGeneration: 0,
		sessions: [] as ChatSession[],
		activeSessionId: null as string | null,
		activeRequest: null,
		isSessionMutating: false,
		transientSessionIds: new Set<string>(),
		transientSessions: new Map<string, ChatSession>(),
		messages: [] as ChatMessage[],
		selectedMode: 'ask' as Mode,
		webSearchMode: 'off' as const,
		isThreadLoading: false,
		isSending: false,
		activeController: null as AbortController | null,
		closed: false,
		inputEl: null as FakeElement | null,
		drafts: new Map<string, Map<string, string>>(),
		additionalNotesControl: null,
		capacityRefreshTimer: null as number | null,
		pendingMessages: new Set<ChatMessage>(),
		messageBodyEls: new Map<string, HTMLElement>(),
		scheduleMessageRender: vi.fn(),
		activeModelEl: null,
		editTargetChoice: 'auto' as 'auto' | 'full-note' | 'selection',
		displayedEditTarget: 'full-note' as 'full-note' | 'selection',
		editTargetSelectEl: null as FakeElement | null,
		webReviewModal: null,
		pendingRenderFrame: null,
		pendingMarkdownRenders: 0,
		pendingScrollRestore: null,
		responseStartMessageId: null,
		followLatestMessages: true,
		renderGeneration: 0,
		cancelPendingRender: vi.fn(),
	};
	Object.setPrototypeOf(context, EmendChatView.prototype);
	const render = vi.fn(() => viewPrototype.render.call(context));
	Object.assign(context, { render });
	return {
		context,
		contentEl,
		render,
		read,
		requestChatCompletion,
		captureChatContext,
		conversationStore,
		setActivePath: (path: string) => {
			activePath = path;
		},
		setSelectedText: (text: string) => {
			selectedText = text;
		},
	};
}

function findEditTargetSelect(contentEl: FakeElement): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) =>
			element.tagName === 'select' && element.attributes['aria-label'] === 'Edit target',
	)[0];
}

describe('EmendChatView selectable modes', () => {
	it.each([
		['ask', 'ask'],
		['edit', 'edit'],
		['discuss', 'ask'],
		['brainstorm', 'ask'],
		['invalid', 'ask'],
	] as const)('initializes persisted default mode %s as %s', (defaultMode, expected) => {
		const view = new EmendChatView(
			new WorkspaceLeaf(),
			{ settings: { defaultMode } } as unknown as ConstructorParameters<typeof EmendChatView>[1],
		);

		expect((view as unknown as { selectedMode: Mode }).selectedMode).toBe(expected);
	});

	it('ignores a runtime Discuss mode change without creating a request', async () => {
		const { context, requestChatCompletion } = createEditTargetView();
		await viewPrototype.refreshTargetNote.call(context);
		viewPrototype.setMode.call(context, 'edit');

		viewPrototype.setMode.call(context, 'discuss');

		expect(context.selectedMode).toBe('edit');
		expect(requestChatCompletion).not.toHaveBeenCalled();
	});

	it('offers only Chat and Edit mode buttons for new requests', async () => {
		const { context, contentEl } = createEditTargetView();
		await viewPrototype.refreshTargetNote.call(context);

		const labels = findElements(
			contentEl,
			(element) => element.className.split(' ').includes('emend-chat-mode-button'),
		).map((element) => textOf(element).trim());
		expect(labels).toEqual(['Chat', 'Edit']);
	});

	it('describes Chat and Edit without advertising new Discuss or Brainstorm requests', async () => {
		const { context, contentEl } = createEditTargetView();
		await viewPrototype.refreshTargetNote.call(context);

		const emptyState = findElements(
			contentEl,
			(element) => element.className.split(' ').includes('emend-chat-empty'),
		)[0];
		const copy = emptyState ? textOf(emptyState) : '';
		expect(copy).toContain('Chat');
		expect(copy).toContain('Edit');
		expect(copy).not.toMatch(/discuss|brainstorm/i);
	});
});

describe('EmendChatView edit target control', () => {
	it('initially displays Selection when automatic targeting has usable text', async () => {
		const { context, contentEl } = createEditTargetView({ selectedText: 'beta' });

		await viewPrototype.refreshTargetNote.call(context);

		expect(findEditTargetSelect(contentEl)?.value).toBe('selection');
		expect(context.editTargetChoice).toBe('auto');
		expect(context.displayedEditTarget).toBe('selection');
	});

	it.each(['', ' \n\t'])(
		'initially displays Full note for an empty or whitespace selection: %j',
		async (selectedText) => {
			const { context, contentEl } = createEditTargetView({ selectedText });

			await viewPrototype.refreshTargetNote.call(context);

			expect(findEditTargetSelect(contentEl)?.value).toBe('full-note');
			expect(context.displayedEditTarget).toBe('full-note');
		},
	);

	it('exposes the two explicit targets and the quick-action tooltip', async () => {
		const { context, contentEl } = createEditTargetView();

		await viewPrototype.refreshTargetNote.call(context);

		const select = findEditTargetSelect(contentEl);
		expect(select?.title).toBe('Applies to Edit and quick actions.');
		expect(select?.children.map((option) => [option.value, option.textContent])).toEqual([
			['full-note', 'Full note'],
			['selection', 'Selection'],
		]);
	});

	it.each([
		{ choice: 'full-note', selectedText: 'usable selection' },
		{ choice: 'selection', selectedText: '' },
	] as const)(
		'preserves explicit $choice targeting across renders and Chat/Edit switches',
		async ({ choice, selectedText }) => {
			const { context, contentEl } = createEditTargetView({ selectedText });
			await viewPrototype.refreshTargetNote.call(context);
			const select = findEditTargetSelect(contentEl);
			if (context.inputEl) {
				context.inputEl.value = 'Keep this draft';
				context.drafts.set('A.md', new Map([[
					context.activeSessionId ?? '',
					context.inputEl.value,
				]]));
			}

			if (select) {
				select.value = choice;
				select.dispatch('change');
			}
			viewPrototype.render.call(context);
			expect(findEditTargetSelect(contentEl)?.value).toBe(choice);
			viewPrototype.setMode.call(context, 'edit');
			expect(findEditTargetSelect(contentEl)?.value).toBe(choice);
			viewPrototype.setMode.call(context, 'ask');

			expect(findEditTargetSelect(contentEl)?.value).toBe(choice);
			expect(context.editTargetChoice).toBe(choice);
			expect(context.displayedEditTarget).toBe(choice);
			expect(context.inputEl?.value).toBe('Keep this draft');
		},
	);

	it('resets to auto only for real note changes while preserving per-note drafts', async () => {
		const { context, contentEl, setActivePath, setSelectedText } = createEditTargetView();
		await viewPrototype.refreshTargetNote.call(context);
		if (context.inputEl) {
			context.inputEl.value = 'A draft';
		}
		setSelectedText('A selection');
		await viewPrototype.refreshTargetNote.call(context);
		expect(findEditTargetSelect(contentEl)?.value).toBe('selection');
		const select = findEditTargetSelect(contentEl);
		if (select) {
			select.value = 'full-note';
			select.dispatch('change');
		}

		setActivePath('B.md');
		setSelectedText('B selection');
		await viewPrototype.refreshTargetNote.call(context);

		expect(context.editTargetChoice).toBe('auto');
		expect(context.displayedEditTarget).toBe('selection');
		expect(findEditTargetSelect(contentEl)?.value).toBe('selection');
		expect(context.inputEl?.value).toBe('');
		if (context.inputEl) {
			context.inputEl.value = 'B draft';
		}
		const bSelect = findEditTargetSelect(contentEl);
		if (bSelect) {
			bSelect.value = 'full-note';
			bSelect.dispatch('change');
		}

		setActivePath('A.md');
		setSelectedText('');
		await viewPrototype.refreshTargetNote.call(context);

		expect(context.editTargetChoice).toBe('auto');
		expect(findEditTargetSelect(contentEl)?.value).toBe('full-note');
		expect(context.inputEl?.value).toBe('A draft');
		setActivePath('B.md');
		await viewPrototype.refreshTargetNote.call(context);
		expect(context.inputEl?.value).toBe('B draft');
	});

	it('refreshes a same-note selection without recreating the textarea or reloading chat', async () => {
		const { context, contentEl, render, setSelectedText } = createEditTargetView();
		await viewPrototype.refreshTargetNote.call(context);
		const composer = context.inputEl;
		if (composer) {
			composer.value = 'Unsubmitted draft';
		}
		render.mockClear();
		setSelectedText('new selection');

		await viewPrototype.refreshTargetNote.call(context);

		expect(findEditTargetSelect(contentEl)?.value).toBe('selection');
		expect(context.displayedEditTarget).toBe('selection');
		expect(context.inputEl).toBe(composer);
		expect(context.inputEl?.value).toBe('Unsubmitted draft');
		expect(render).not.toHaveBeenCalled();
		expect(context.plugin.conversationStore.loadConversation).toHaveBeenCalledOnce();
	});

	it('keeps the control and quick actions available outside Edit before submission', async () => {
		const { context, contentEl } = createEditTargetView({ selectedText: 'beta' });

		await viewPrototype.refreshTargetNote.call(context);

		expect(context.selectedMode).toBe('ask');
		expect(findEditTargetSelect(contentEl)?.disabled).toBe(false);
		expect(findEditTargetSelect(contentEl)?.value).toBe('selection');
		const quickActions = findElements(
			contentEl,
			(element) => element.className.split(' ').includes('emend-chat-quick-action'),
		);
		expect(quickActions).toHaveLength(3);
		expect(quickActions.every((button) => !button.disabled)).toBe(true);
	});

	it.each([
		{ isSending: true, isThreadLoading: false },
		{ isSending: false, isThreadLoading: true },
	])('disables the control while pending or loading: %o', async (state) => {
		const { context, contentEl } = createEditTargetView({ selectedText: 'beta' });
		await viewPrototype.refreshTargetNote.call(context);
		context.isSending = state.isSending;
		context.isThreadLoading = state.isThreadLoading;

		viewPrototype.render.call(context);

		expect(findEditTargetSelect(contentEl)?.disabled).toBe(true);
	});

	it('changes target state without requests, content reads, or composer recreation', async () => {
		const {
			context,
			contentEl,
			read,
			requestChatCompletion,
			setSelectedText,
		} = createEditTargetView({ selectedText: 'beta' });
		await viewPrototype.refreshTargetNote.call(context);
		const composer = context.inputEl;
		const select = findEditTargetSelect(contentEl);
		if (select) {
			select.value = 'full-note';
			select.dispatch('change');
		}
		expect(context.inputEl).toBe(composer);
		setSelectedText('');
		await viewPrototype.refreshTargetNote.call(context);
		viewPrototype.setMode.call(context, 'edit');

		expect(context.editTargetChoice).toBe('full-note');
		expect(context.displayedEditTarget).toBe('full-note');
		expect(context.inputEl?.value).toBe('');
		expect(requestChatCompletion).not.toHaveBeenCalled();
		expect(read).not.toHaveBeenCalled();
	});

	it('synchronizes Edit controls after quick-action Selection capture fails and preserves the draft', async () => {
		const {
			context,
			contentEl,
			requestChatCompletion,
			captureChatContext,
		} = createEditTargetView({ selectedText: 'beta' });
		await viewPrototype.refreshTargetNote.call(context);
		const file = new TFile();
		file.path = 'A.md';
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
		const captureSelectionEditTarget = vi.fn(() => ({ snapshot, editor }));
		captureSelectionEditTarget.mockImplementation(() => {
			throw new Error('Select non-whitespace text first.');
		});
		const requestSelectionEdit = vi.fn(async () => ({
			applied: false,
			changeCount: 0,
			usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3, source: 'provider' as const },
		}));
		const persistMessages = vi.fn(async () => undefined);
		Object.assign(context.plugin, {
			captureSelectionEditTarget,
			requestSelectionEdit,
		});
		Object.assign(context, { persistMessages });
		captureChatContext.mockReturnValue({
			file,
			sourceText: snapshot.fullText,
			selection: { from: 0, to: 0 },
			noteLabel: file.path,
			markdown: snapshot.fullText,
		});
		const activeModeIndex = () => findElements(
			contentEl,
			(element) => element.className.split(' ').includes('emend-chat-mode-button'),
		).findIndex((element) => element.className.split(' ').includes('is-active'));
		const webSelect = () => findElements(
			contentEl,
			(element) =>
				element.tagName === 'select' &&
				element.attributes['aria-label'] === 'Web search mode',
		)[0];
		expect(context.selectedMode).toBe('ask');
		expect(activeModeIndex()).toBe(0);
		expect(context.displayedEditTarget).toBe('selection');
		expect(webSelect()?.disabled).toBe(false);
		if (context.inputEl) {
			context.inputEl.value = 'Preserve this draft';
		}

		const quickAction = findElements(
			contentEl,
			(element) => element.attributes['data-action-id'] === 'fix-grammar',
		)[0];
		quickAction?.dispatch('click');

		expect(context.selectedMode).toBe('edit');
		expect(activeModeIndex()).toBe(1);
		expect(webSelect()?.disabled).toBe(true);
		expect(context.inputEl?.value).toBe('Preserve this draft');
		expect(context.inputEl?.attributes.placeholder).toBe(
			'Edit the note or selection with CriticMarkup...',
		);
		expect(requestSelectionEdit).not.toHaveBeenCalled();
		expect(requestChatCompletion).not.toHaveBeenCalled();
		expect(context.messages).toEqual([]);
		expect(persistMessages).not.toHaveBeenCalled();
		expect(editor.replaceRange).not.toHaveBeenCalled();

		captureSelectionEditTarget.mockImplementation(() => ({ snapshot, editor }));
		if (context.inputEl) {
			context.inputEl.value = 'Send using the visible mode';
		}
		const send = findElements(
			contentEl,
			(element) => element.tagName === 'button' && element.textContent === 'Send',
		)[0];
		send?.dispatch('click');
		await vi.waitFor(() => expect(requestSelectionEdit).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(context.isSending).toBe(false));

		expect(requestChatCompletion).not.toHaveBeenCalled();
		expect(activeModeIndex()).toBe(1);
	});

	it('clears the selector element reference on close', async () => {
		const { context } = createEditTargetView();
		context.editTargetSelectEl = new FakeElement('select');

		await viewPrototype.onClose.call(context);

		expect(context.editTargetSelectEl).toBeNull();
	});
});

describe('EmendChatView edit target styles', () => {
	it('keeps the compact control readable and its disabled state native-looking', () => {
		const control = getCssRule('.emend-chat-edit-target');
		const select = getCssRule('.emend-chat-edit-target select');
		const disabled = getCssRule('.emend-chat-edit-target select:disabled');

		expect(control).toContain('min-width: 0;');
		expect(control).toContain('color: var(--text-muted);');
		expect(select).toContain('min-width: 0;');
		expect(disabled).toContain('color: var(--text-muted);');
		expect(disabled).toContain('cursor: not-allowed;');
	});

	it('allows the target selector to wrap within narrow sidebars', () => {
		expect(getCssRule('@media (max-width: 400px)')).not.toBe('');
		expect(getCssRule('.emend-chat-edit-target select')).toContain('max-width: 100%;');
	});
});

describe('EmendChatView provider history', () => {
	it('filters transient entries and preserves metadata in the last eight ready messages', () => {
		const context = {
			plugin: { settings: { historyMessageLimit: 8 } },
			messages: [
				{ ...message('old-question', 'Note.md'), role: 'user' as const, content: 'Old question' },
				{ ...message('old-answer', 'Note.md'), content: 'Old answer' },
				{ ...message('ask-question', 'Note.md'), role: 'user' as const, content: 'Ask question' },
				{ ...message('loading', 'Note.md'), status: 'loading' as const, content: 'Partial answer' },
				{ ...message('edit-question', 'Note.md'), role: 'user' as const, mode: 'edit' as const, content: 'Edit question' },
				{ ...message('edit-status', 'Note.md'), mode: 'edit' as const, content: 'Edit applied — 2 changes tracked. Review in Track Changes.' },
				{ ...message('error', 'Note.md'), status: 'error' as const, content: 'Provider error' },
				{ ...message('ask-answer', 'Note.md'), content: 'Ask answer' },
				{ ...message('stopped', 'Note.md'), status: 'stopped' as const, content: 'Stopped answer' },
				{ ...message('discuss-answer', 'Note.md'), mode: 'discuss' as const, content: 'Discuss answer' },
				{ ...message('brainstorm-question', 'Note.md'), role: 'user' as const, mode: 'brainstorm' as const, content: 'Brainstorm question' },
				{ ...message('brainstorm-answer', 'Note.md'), mode: 'brainstorm' as const, content: 'Brainstorm answer' },
				{ ...message('follow-up-question', 'Note.md'), role: 'user' as const, content: 'Follow-up question' },
				{ ...message('follow-up-answer', 'Note.md'), content: 'Follow-up answer' },
			],
		};

		expect(viewPrototype.toProviderHistory.call(context)).toEqual([
			{ role: 'user', content: 'Edit question', mode: 'edit', origin: 'user' },
			{ role: 'assistant', content: 'Edit applied — 2 changes tracked. Review in Track Changes.', mode: 'edit', origin: 'local-edit-status' },
			{ role: 'assistant', content: 'Ask answer', mode: 'ask', origin: 'model' },
			{ role: 'assistant', content: 'Discuss answer', mode: 'discuss', origin: 'model' },
			{ role: 'user', content: 'Brainstorm question', mode: 'brainstorm', origin: 'user' },
			{ role: 'assistant', content: 'Brainstorm answer', mode: 'brainstorm', origin: 'model' },
			{ role: 'user', content: 'Follow-up question', mode: 'ask', origin: 'user' },
			{ role: 'assistant', content: 'Follow-up answer', mode: 'ask', origin: 'model' },
		]);
	});

	it('keeps retrieved sources with their historical answer so source IDs remain unambiguous', () => {
		const context = {
			plugin: { settings: { historyMessageLimit: 8 } },
			messages: [{
				...message('researched-answer', 'Note.md'),
				content: 'Historical answer [S1]',
				webSources: [{ id: 'S1', title: 'Original source', url: 'https://example.test/original' }],
			}],
		};

		expect(viewPrototype.toProviderHistory.call(context)[0]?.content).toBe(
			'Historical answer [S1]\n\n### Sources\n- [S1] [Original source](https://example.test/original)',
		);
	});

	it.each([
		[8, 8],
		[3, 3],
	])('sends the last %i ready messages when the limit is %i', (limit, expectedCount) => {
		const context = {
			plugin: { settings: { historyMessageLimit: limit } },
			messages: Array.from({ length: 12 }, (_, index) =>
				message(`ready-${index}`, 'Note.md')
			),
		};

		const history = viewPrototype.toProviderHistory.call(context);

		expect(history).toHaveLength(expectedCount);
		expect(history.map((entry) => entry.content)).toEqual(
			Array.from(
				{ length: expectedCount },
				(_, offset) => `ready-${12 - expectedCount + offset}`,
			),
		);
	});

	it('sends no history when the limit is zero', () => {
		const context = {
			plugin: { settings: { historyMessageLimit: 0 } },
			messages: [
				message('question', 'Note.md'),
				message('answer', 'Note.md'),
			],
		};

		expect(viewPrototype.toProviderHistory.call(context)).toEqual([]);
	});

	it('filters transient entries before applying the limit', () => {
		const context = {
			plugin: { settings: { historyMessageLimit: 2 } },
			messages: [
				message('older', 'Note.md'),
				message('newest', 'Note.md'),
				{ ...message('loading', 'Note.md'), status: 'loading' as const },
				{ ...message('error', 'Note.md'), status: 'error' as const },
				{ ...message('stopped', 'Note.md'), status: 'stopped' as const },
			],
		};

		expect(
			viewPrototype.toProviderHistory.call(context).map((entry) => entry.content),
		).toEqual(['older', 'newest']);
	});
});

describe('EmendChatView conversation loading', () => {
	it('applies only the latest note load during rapid note switches', async () => {
		let activePath = 'First.md';
		const first = deferred<LoadedChatConversation>();
		const second = deferred<LoadedChatConversation>();
		const context = {
			plugin: {
				getActiveNotePath: () => activePath,
				conversationStore: {
					loadConversation: vi.fn((path: string) =>
						path === 'First.md' ? first.promise : second.promise,
					),
				},
			},
			notePath: null,
			conversationGeneration: 0,
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
		second.resolve(loadedConversation([
			makeSession('second-session', [message('second', 'Second.md')]),
		]));
		await secondLoad;
		first.resolve(loadedConversation([
			makeSession('first-session', [message('first', 'First.md')]),
		]));
		await firstLoad;

		expect(context.messages.map((item) => item.id)).toEqual(['second']);
		expect(context.notePath).toBe('Second.md');
		expect(context.selectedMode).toBe('brainstorm');
		expect(context.isThreadLoading).toBe(false);
	});

	it('does not apply a pending load after the view closes', async () => {
		const pending = deferred<LoadedChatConversation>();
		const context = {
			plugin: {
				getActiveNotePath: () => 'Note.md',
				conversationStore: { loadConversation: vi.fn(() => pending.promise) },
			},
			notePath: null,
			conversationGeneration: 0,
			messages: [] as ChatMessage[],
			isThreadLoading: false,
			isSending: false,
			activeController: null,
			closed: false,
			render: vi.fn(),
		};

		const loading = viewPrototype.refreshTargetNote.call(context);
		context.closed = true;
		context.conversationGeneration++;
		pending.resolve(loadedConversation([
			makeSession('stale-session', [message('stale', 'Note.md')]),
		]));
		await loading;

		expect(context.messages).toEqual([]);
	});

	it('clears the thread-loading state when the view closes', async () => {
		const context = {
			closed: false,
			isThreadLoading: true,
			conversationGeneration: 0,
			notePath: 'Note.md',
			activeController: null,
			cancelPendingRender: vi.fn(),
			pendingMessages: new Set(),
			messageBodyEls: new Map(),
			activeModelEl: null,
			inputEl: null,
			contentEl: { empty: vi.fn() },
			clearCapacityRefreshTimer: vi.fn(),
			unsubscribeAdditionalNotes: null,
		};
		Object.setPrototypeOf(context, EmendChatView.prototype);

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
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion: vi.fn(
					async ({ callbacks }: { callbacks: { onContent: (text: string) => void } }) => {
						callbacks.onContent('Answer');
						return {
							content: 'Answer',
							reasoning: '',
							usage: {
								promptTokens: 3,
								completionTokens: 1,
								totalTokens: 4,
								source: 'provider' as const,
							},
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
			source: 'provider',
		});
		expect(context.messages.every((item) => item.timestamp > 0)).toBe(true);
	});

	it('persists one concise corrected Edit summary with aggregate usage and clean later history', async () => {
		const file = new TFile();
		file.path = 'Note.md';
		const sourceText = 'Alpha beta.';
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
			readCurrentText: vi.fn(async () => sourceText),
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
		const requestChatCompletion = vi.fn(async (
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
					source: 'provider' as const,
				},
			};
		});
		const requestContext = {
			file,
			sourceText,
			selection: { from: 0, to: 0 },
			noteLabel: 'Note.md',
			markdown: sourceText,
		};
		const savedSnapshots: ChatMessage[][] = [];
		const context = {
			inputEl: { value: 'Edit note' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'edit' as Mode,
			messages: [] as ChatMessage[],
			plugin: {
				captureChatContext: () => requestContext,
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
				settings: { historyMessageLimit: 8 },
			},
			toProviderHistory: () => viewPrototype.toProviderHistory.call(context),
			persistMessages: vi.fn(async (_path: string, messages: ChatMessage[]) => {
				savedSnapshots.push(messages.map((message) => ({ ...message })));
			}),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
		};
		const summary = 'Edit applied — 1 changes tracked. Review in Track Changes.\nTarget: Full note.\n\n- Replaced line 1.';

		await viewPrototype.submitPrompt.call(context);

		expect(request).toHaveBeenCalledTimes(2);
		expect(writer.write).toHaveBeenCalledExactlyOnceWith(
			file,
			'Alpha {~~beta~>delta~~}.',
		);
		expect(context.messages).toHaveLength(2);
		expect(context.messages[1]).toMatchObject({
			role: 'assistant',
			status: 'ready',
			content: summary,
			reasoning: validReasoning,
			usage: {
				promptTokens: 30,
				completionTokens: 7,
				totalTokens: 37,
				source: 'provider',
			},
		});
		expect(savedSnapshots).toHaveLength(2);
		const savedUser = {
			id: context.messages[0]?.id ?? '',
			role: 'user',
			content: 'Edit note',
			reasoning: '',
			mode: 'edit',
			sourcePath: 'Note.md',
			status: 'ready',
			timestamp: context.messages[0]?.timestamp ?? -1,
		};
		const savedEdit = {
			id: context.messages[1]?.id ?? '',
			role: 'assistant',
			content: summary,
			reasoning: validReasoning,
			mode: 'edit',
			sourcePath: 'Note.md',
			status: 'ready',
			timestamp: context.messages[1]?.timestamp ?? -1,
			usage: {
				promptTokens: 30,
				completionTokens: 7,
				totalTokens: 37,
				source: 'provider',
			},
		};
		expect(savedSnapshots[0]).toEqual([savedUser]);
		expect(savedSnapshots[1]).toEqual([savedUser, savedEdit]);
		expect(savedSnapshots.flat().map((message) => message.content).join('\n')).not.toContain(
			'private invalid response',
		);
		expect(savedSnapshots.flat().map((message) => message.content).join('\n')).not.toContain(
			validResponse,
		);

		context.inputEl.value = 'Next question';
		context.selectedMode = 'ask';
		await viewPrototype.submitPrompt.call(context);

		const nextSubmission = requestChatCompletion.mock.calls[1]?.[0];
		expect(nextSubmission?.history.map((message) => message.content)).toEqual([
			'Edit note',
			summary,
		]);
		expect(nextSubmission?.history.map((message) => message.content).join('\n')).not.toContain(
			'invalid-json',
		);
		expect(context.messages.filter(
			(message) => message.role === 'assistant',
		).map((message) => message.content)).toEqual([summary, 'Answer']);
		expect(savedSnapshots.flat().map((message) => message.content).join('\n')).not.toContain(
			'private invalid response',
		);
		expect(savedSnapshots.flat().map((message) => message.reasoning).join('\n')).not.toContain(
			invalidReasoning,
		);
	});
});

describe('EmendChatView session runtime', () => {
	it('restores the active session and keeps drafts, controls, history, and capacity session-scoped', async () => {
		const fixture = createEditTargetView({ selectedText: 'selected text' });
		const first = makeSession('a1', [message('first-answer', 'A.md')]);
		const second = makeSession('a2', [message('second-answer', 'A.md')]);
		fixture.conversationStore.loadConversation.mockResolvedValue(
			loadedConversation([first, second], 'a2'),
		);
		fixture.conversationStore.appendReadyMessage.mockImplementation(
			async (_notePath: string, sessionId: string, appended: ChatMessage) => {
				const session = sessionId === 'a1' ? first : second;
				return { ...session, messages: [...session.messages, appended] };
			},
		);
		fixture.requestChatCompletion.mockImplementation(async ({ callbacks }) => {
			callbacks.onContent('Follow-up answer');
			return { content: 'Follow-up answer', reasoning: '' };
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);

		expect(fixture.context.activeSessionId).toBe('a2');
		expect(fixture.context.messages).toBe(second.messages);
		viewPrototype.setMode.call(fixture.context, 'edit');
		Object.assign(fixture.context, { webSearchMode: 'auto', editTargetChoice: 'full-note' });
		fixture.context.plugin.additionalNotesStore.add('A.md', 'Reference.md');
		const refreshDraftEstimate = vi.fn();
		Object.assign(fixture.context, { refreshDraftEstimate });
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Second draft';
		}

		await viewPrototype.switchActiveSession.call(fixture.context, 'a1');

		expect(fixture.context.activeSessionId).toBe('a1');
		expect(fixture.context.messages).toBe(first.messages);
		expect(fixture.context.inputEl?.value).toBe('');
		expect(fixture.context.selectedMode).toBe('edit');
		expect(fixture.context.webSearchMode).toBe('auto');
		expect(fixture.context.editTargetChoice).toBe('full-note');
		expect(fixture.context.plugin.additionalNotesStore.list('A.md')).toEqual(['Reference.md']);
		expect(refreshDraftEstimate).toHaveBeenCalled();
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'First draft';
		}

		await viewPrototype.switchActiveSession.call(fixture.context, 'a2');
		expect(fixture.context.inputEl?.value).toBe('Second draft');
		await viewPrototype.switchActiveSession.call(fixture.context, 'a1');
		expect(fixture.context.inputEl?.value).toBe('First draft');
		await viewPrototype.switchActiveSession.call(fixture.context, 'a2');
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Follow-up question';
		}
		viewPrototype.setMode.call(fixture.context, 'ask');
		await viewPrototype.submitPrompt.call(fixture.context);

		const submission = fixture.requestChatCompletion.mock.calls[0]?.[0];
		if (!submission) {
			throw new Error('Session request was not submitted.');
		}
		expect(submission.history).toEqual([
			{ role: 'assistant', content: 'second-answer', mode: 'ask', origin: 'model' },
		]);
		expect(submission.history).not.toContainEqual(
			expect.objectContaining({ content: 'first-answer' }),
		);
	});

	it('reuses an empty transient session and its messages and draft across A → B → A without writes', async () => {
		const fixture = createEditTargetView();
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const transientId = fixture.context.activeSessionId;
		if (!transientId || !fixture.context.inputEl) {
			throw new Error('Transient session was not created.');
		}
		fixture.context.inputEl.value = 'Transient A draft';
		fixture.context.messages.push({
			...message('transient-error', 'A.md'),
			status: 'error',
			content: 'Unsaved answer',
		});

		fixture.setActivePath('B.md');
		await viewPrototype.refreshTargetNote.call(fixture.context);
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Transient B draft';
		}
		fixture.setActivePath('A.md');
		await viewPrototype.refreshTargetNote.call(fixture.context);

		expect(fixture.context.activeSessionId).toBe(transientId);
		expect(fixture.context.messages.map((item) => item.id)).toEqual(['transient-error']);
		expect(fixture.context.inputEl?.value).toBe('Transient A draft');
		expect(fixture.conversationStore.createSession).not.toHaveBeenCalled();
		expect(fixture.conversationStore.appendReadyMessage).not.toHaveBeenCalled();
	});

	it('creates a transient with the ready user before networking and atomically appends assistant and title', async () => {
		const fixture = createEditTargetView();
		const order: string[] = [];
		fixture.conversationStore.createSession.mockImplementation(async (_notePath, session) => {
			order.push('create');
			return session;
		});
		fixture.conversationStore.appendReadyMessage.mockImplementation(
			async (_notePath, sessionId, appended, options) => {
				order.push('append');
				const session = fixture.context.sessions.find((item) => item.id === sessionId);
				if (!session) {
					throw new Error('Missing session.');
				}
				return {
					...session,
					title: deriveAutomaticTitle(options?.titlePrompt ?? ''),
					messages: [...session.messages, appended],
				};
			},
		);
		fixture.requestChatCompletion.mockImplementation(async ({ callbacks }) => {
			order.push('provider');
			callbacks.onContent('Answer');
			return { content: 'Answer', reasoning: '' };
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const transientId = fixture.context.activeSessionId;
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Title from this prompt';
		}

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(order).toEqual(['create', 'provider', 'append']);
		const created = fixture.conversationStore.createSession.mock.calls[0]?.[1];
		expect(created?.messages).toHaveLength(1);
		expect(created?.messages[0]).toMatchObject({ role: 'user', content: 'Title from this prompt' });
		expect(fixture.conversationStore.appendReadyMessage).toHaveBeenCalledWith(
			'A.md',
			transientId,
			expect.objectContaining({ role: 'assistant', status: 'ready', content: 'Answer' }),
			expect.objectContaining({ titlePrompt: 'Title from this prompt' }),
		);
		expect(fixture.context.sessions[0]?.title).toBe('Title from this prompt');
		expect(fixture.context.transientSessionIds.has(transientId ?? '')).toBe(false);
		expect(fixture.context.transientSessions.has('A.md')).toBe(false);
	});

	it('appends to a legacy session without creating a replacement', async () => {
		const fixture = createEditTargetView();
		const legacy = makeSession('legacy', [message('legacy-answer', 'A.md')]);
		fixture.conversationStore.loadConversation.mockResolvedValue(
			loadedConversation([legacy], 'legacy', 'legacy'),
		);
		fixture.conversationStore.appendReadyMessage.mockImplementation(
			async (_notePath, sessionId, appended) => ({
				...legacy,
				messages: [...legacy.messages, appended],
			}),
		);
		fixture.requestChatCompletion.mockImplementation(async ({ callbacks }) => {
			callbacks.onContent('New answer');
			return { content: 'New answer', reasoning: '' };
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Continue legacy';
		}

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.conversationStore.createSession).not.toHaveBeenCalled();
		expect(fixture.conversationStore.appendReadyMessage).toHaveBeenCalledTimes(2);
		expect(fixture.conversationStore.appendReadyMessage.mock.calls.map((call) => call[1]))
			.toEqual(['legacy', 'legacy']);
	});

	it('makes zero provider calls when the initial user save fails', async () => {
		const fixture = createEditTargetView();
		fixture.conversationStore.createSession.mockRejectedValue(new Error('Disk full'));
		const noticeStart = noticeMessages().length;
		await viewPrototype.refreshTargetNote.call(fixture.context);
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Unsaved question';
		}

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.conversationStore.appendReadyMessage).not.toHaveBeenCalled();
		expect(fixture.context.messages[0]).toMatchObject({ role: 'user', status: 'ready' });
		expect(fixture.context.messages[1]?.status).toBe('error');
		expect(noticeMessages().slice(noticeStart).join('\n')).toContain('Could not save this chat');
	});

	it('keeps a completed answer as transient error content when the final save fails', async () => {
		const fixture = createEditTargetView();
		fixture.conversationStore.appendReadyMessage.mockRejectedValue(new Error('Disk full'));
		fixture.requestChatCompletion.mockImplementation(async ({ callbacks }) => {
			callbacks.onContent('Completed but unsaved');
			return { content: 'Completed but unsaved', reasoning: '' };
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Question';
		}

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.requestChatCompletion).toHaveBeenCalledOnce();
		expect(fixture.context.messages[1]).toMatchObject({
			status: 'error',
			content: 'Completed but unsaved',
		});
		expect(fixture.context.sessions[0]?.title).toBe('New chat');
		expect(viewPrototype.toProviderHistory.call(fixture.context)).toEqual([
			{ role: 'user', content: 'Question', mode: 'ask', origin: 'user' },
		]);
	});

	it('does not append an assistant or change the title for stopped and failed responses', async () => {
		for (const outcome of ['stopped', 'failed'] as const) {
			const fixture = createEditTargetView();
			const persisted = makeSession('persisted');
			fixture.conversationStore.loadConversation.mockResolvedValue(
				loadedConversation([persisted]),
			);
			fixture.conversationStore.appendReadyMessage.mockImplementation(
				async (_notePath, _sessionId, appended) => ({
					...persisted,
					messages: [...persisted.messages, appended],
				}),
			);
			const response = deferred<{ content: string; reasoning: string }>();
			fixture.requestChatCompletion.mockImplementation(() => response.promise);
			await viewPrototype.refreshTargetNote.call(fixture.context);
			if (fixture.context.inputEl) {
				fixture.context.inputEl.value = 'Question';
			}
			const submission = viewPrototype.submitPrompt.call(fixture.context);
			await vi.waitFor(() => expect(fixture.requestChatCompletion).toHaveBeenCalledOnce());

			if (outcome === 'stopped') {
				fixture.context.activeController?.abort();
				response.resolve({ content: 'Ignored', reasoning: '' });
			} else {
				response.reject(new Error('Provider failed'));
			}
			await submission;

			expect(fixture.context.messages[1]?.status).toBe(outcome === 'stopped' ? 'stopped' : 'error');
			expect(fixture.conversationStore.appendReadyMessage).toHaveBeenCalledOnce();
			expect(fixture.conversationStore.appendReadyMessage.mock.calls[0]?.[3]?.titlePrompt).toBeUndefined();
			expect(fixture.context.sessions[0]?.title).toBe('New chat');
		}
	});

	it('isolates stale stream callbacks and finally cleanup from a newer request after A1 → A2 → B → A1', async () => {
		const fixture = createEditTargetView();
		const first = makeSession('a1');
		const second = makeSession('a2');
		fixture.conversationStore.loadConversation.mockImplementation(async (notePath: string) =>
			notePath === 'A.md'
				? loadedConversation([first, second], 'a1')
				: loadedConversation([makeSession('b1')]),
		);
		fixture.conversationStore.appendReadyMessage.mockImplementation(
			async (_notePath, sessionId, appended) => {
				const session = sessionId === 'a1' ? first : second;
				return { ...session, messages: [...session.messages, appended] };
			},
		);
		const oldResponse = deferred<{ content: string; reasoning: string }>();
		const newResponse = deferred<{ content: string; reasoning: string }>();
		let oldCallbacks: { onContent(text: string): void } | undefined;
		fixture.requestChatCompletion
			.mockImplementationOnce(async ({ callbacks }) => {
				oldCallbacks = callbacks;
				return oldResponse.promise;
			})
			.mockImplementationOnce(async () => newResponse.promise);
		await viewPrototype.refreshTargetNote.call(fixture.context);
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Old question';
		}
		const oldSubmission = viewPrototype.submitPrompt.call(fixture.context);
		await vi.waitFor(() => expect(fixture.requestChatCompletion).toHaveBeenCalledOnce());
		const oldRequest = fixture.context.activeRequest as ActiveRequest | null;

		await viewPrototype.switchActiveSession.call(fixture.context, 'a2');
		fixture.setActivePath('B.md');
		await viewPrototype.refreshTargetNote.call(fixture.context);
		fixture.setActivePath('A.md');
		await viewPrototype.refreshTargetNote.call(fixture.context);
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'New question';
		}
		const newSubmission = viewPrototype.submitPrompt.call(fixture.context);
		await vi.waitFor(() => expect(fixture.requestChatCompletion).toHaveBeenCalledTimes(2));
		const newRequest = fixture.context.activeRequest as ActiveRequest | null;
		const noticeStart = noticeMessages().length;
		fixture.context.scheduleMessageRender.mockClear();

		oldCallbacks?.onContent('STALE_STREAM_CONTENT');
		oldResponse.resolve({ content: 'STALE_STREAM_CONTENT', reasoning: '' });
		await oldSubmission;

		expect(fixture.context.activeRequest).toBe(newRequest);
		expect(fixture.context.isSending).toBe(true);
		expect(oldRequest?.loadingMessage.content).toBe('STALE_STREAM_CONTENT');
		expect(newRequest?.loadingMessage.content).toBe('');
		expect(fixture.context.scheduleMessageRender).not.toHaveBeenCalledWith(
			oldRequest?.loadingMessage,
		);
		expect(noticeMessages().slice(noticeStart)).toEqual([]);
		fixture.context.activeController?.abort();
		newResponse.resolve({ content: 'New answer', reasoning: '' });
		await newSubmission;
	});

	it('suppresses a stale final-save Notice after a session transition', async () => {
		const fixture = createEditTargetView();
		const first = makeSession('a1');
		const second = makeSession('a2');
		fixture.conversationStore.loadConversation.mockResolvedValue(
			loadedConversation([first, second], 'a1'),
		);
		const finalSave = deferred<void>();
		fixture.conversationStore.appendReadyMessage.mockImplementation(
			async (_notePath, sessionId, appended) => {
				if (appended.role === 'assistant') {
					await finalSave.promise;
				}
				const session = sessionId === 'a1' ? first : second;
				return { ...session, messages: [...session.messages, appended] };
			},
		);
		fixture.requestChatCompletion.mockImplementation(async ({ callbacks }) => {
			callbacks.onContent('Old answer');
			return { content: 'Old answer', reasoning: '' };
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Old question';
		}
		const submission = viewPrototype.submitPrompt.call(fixture.context);
		await vi.waitFor(() => expect(fixture.conversationStore.appendReadyMessage).toHaveBeenCalledTimes(2));

		await viewPrototype.switchActiveSession.call(fixture.context, 'a2');
		const noticeStart = noticeMessages().length;
		finalSave.reject(new Error('Disk full'));
		await submission;

		expect(fixture.context.activeSessionId).toBe('a2');
		expect(fixture.context.messages).toEqual([]);
		expect(noticeMessages().slice(noticeStart)).toEqual([]);
	});

	it.each(['note-switch', 'close', 'stop'] as const)(
		'keeps runtime and committed disk state consistent when %s follows the final commit',
		async (abortKind) => {
			const fixture = createEditTargetView();
			const first = makeSession('a1');
			const second = makeSession('a2');
			let persistedFirst = makeSession('a1');
			let usePersistedFirst = false;
			const finalSave = deferred<void>();
			fixture.conversationStore.loadConversation.mockImplementation(async (notePath: string) => {
				if (notePath === 'B.md') {
					return loadedConversation([makeSession('b1')]);
				}
				return loadedConversation([
					usePersistedFirst ? persistedFirst : first,
					second,
				], 'a1');
			});
			fixture.conversationStore.appendReadyMessage.mockImplementation(
				async (_notePath, sessionId, appended, options) => {
					const session = sessionId === 'a1' ? first : second;
					if (sessionId === 'a1') {
						if (appended.role === 'assistant') {
							await finalSave.promise;
						}
						persistedFirst = {
							...persistedFirst,
							title: appended.role === 'assistant'
								? deriveAutomaticTitle(options?.titlePrompt ?? '')
								: persistedFirst.title,
							updatedAt: appended.role === 'assistant' ? 999 : persistedFirst.updatedAt,
							messages: [...persistedFirst.messages, appended],
						};
					}
					return {
						...session,
						title: sessionId === 'a1' ? persistedFirst.title : session.title,
						updatedAt: sessionId === 'a1' ? persistedFirst.updatedAt : session.updatedAt,
						messages: [...session.messages, appended],
					};
				},
			);
			fixture.requestChatCompletion.mockImplementation(async ({ callbacks }) => {
				callbacks.onContent('Answer that must stop');
				return { content: 'Answer that must stop', reasoning: '' };
			});
			await viewPrototype.refreshTargetNote.call(fixture.context);
			if (fixture.context.inputEl) {
				fixture.context.inputEl.value = 'Aborted answer title';
			}
			const submission = viewPrototype.submitPrompt.call(fixture.context);
			await vi.waitFor(() => expect(fixture.conversationStore.appendReadyMessage).toHaveBeenCalledTimes(2));
			const request = fixture.context.activeRequest as ActiveRequest | null;

			if (abortKind === 'note-switch') {
				usePersistedFirst = true;
				fixture.setActivePath('B.md');
				await viewPrototype.refreshTargetNote.call(fixture.context);
			} else if (abortKind === 'close') {
				await viewPrototype.onClose.call(fixture.context);
			} else {
				fixture.context.activeController?.abort();
			}
			fixture.render.mockClear();
			finalSave.resolve();
			await submission;

			expect(request?.controller.signal.aborted).toBe(true);
			expect(request?.loadingMessage.status).toBe('ready');
			expect(first.title).toBe('Aborted answer title');
			expect(first.updatedAt).toBe(999);
			expect(persistedFirst).toMatchObject({
				title: 'Aborted answer title',
				updatedAt: 999,
			});
			expect(persistedFirst.messages.map((item) => item.role)).toEqual(['user', 'assistant']);
			expect(first.messages.filter((item) => item.status === 'ready').map((item) => item.role))
				.toEqual(['user', 'assistant']);
			if (abortKind === 'note-switch') {
				expect(fixture.context.activeSessionId).toBe('b1');
				expect(fixture.context.messages).toEqual([]);
				expect(fixture.context.responseStartMessageId).toBeNull();
				expect(fixture.render).not.toHaveBeenCalled();
			} else if (abortKind === 'close') {
				expect(fixture.context.responseStartMessageId).toBeNull();
				expect(fixture.render).not.toHaveBeenCalled();
			} else {
				expect(fixture.render).toHaveBeenCalledOnce();
				expect(viewPrototype.toProviderHistory.call(fixture.context)).toEqual([
					{ role: 'user', content: 'Aborted answer title', mode: 'ask', origin: 'user' },
					{ role: 'assistant', content: 'Answer that must stop', mode: 'ask', origin: 'model' },
				]);
				expect(fixture.context.activeRequest).toBeNull();
				expect(fixture.context.activeController).toBeNull();
				expect(fixture.context.isSending).toBe(false);
			}
		},
	);

	it('clears Stop after a committed response and includes that exchange in retry history', async () => {
		const fixture = createEditTargetView();
		const session = makeSession('a1');
		fixture.conversationStore.loadConversation.mockResolvedValue(
			loadedConversation([session]),
		);
		const finalSave = deferred<void>();
		fixture.conversationStore.appendReadyMessage.mockImplementation(
			async (_notePath, _sessionId, appended, options) => {
				if (appended.role === 'assistant' && appended.content === 'Stopped answer') {
					await finalSave.promise;
				}
				return {
					...session,
					title: appended.role === 'assistant'
						? deriveAutomaticTitle(options?.titlePrompt ?? '')
						: session.title,
					messages: [...session.messages, appended],
				};
			},
		);
		fixture.requestChatCompletion
			.mockImplementationOnce(async ({ callbacks }) => {
				callbacks.onContent('Stopped answer');
				return { content: 'Stopped answer', reasoning: '' };
			})
			.mockImplementationOnce(async ({ callbacks }) => {
				callbacks.onContent('Retry answer');
				return { content: 'Retry answer', reasoning: '' };
			});
		await viewPrototype.refreshTargetNote.call(fixture.context);
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Stopped question';
		}
		const stoppedSubmission = viewPrototype.submitPrompt.call(fixture.context);
		await vi.waitFor(() => expect(fixture.conversationStore.appendReadyMessage).toHaveBeenCalledTimes(2));
		fixture.context.activeController?.abort();
		finalSave.resolve();
		await stoppedSubmission;

		expect(fixture.context.activeRequest).toBeNull();
		expect(fixture.context.activeController).toBeNull();
		expect(fixture.context.isSending).toBe(false);
		expect(fixture.context.messages[1]).toMatchObject({
			role: 'assistant',
			status: 'ready',
			content: 'Stopped answer',
		});
		expect(session.title).toBe('Stopped question');

		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Retry question';
		}
		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.requestChatCompletion).toHaveBeenCalledTimes(2);
		const retrySubmission = fixture.requestChatCompletion.mock.calls[1]?.[0];
		if (!retrySubmission) {
			throw new Error('Retry submission missing.');
		}
		expect(retrySubmission.history).toEqual([
			{ role: 'user', content: 'Stopped question', mode: 'ask', origin: 'user' },
			{ role: 'assistant', content: 'Stopped answer', mode: 'ask', origin: 'model' },
		]);
		expect(fixture.context.messages[3]).toMatchObject({
			role: 'assistant',
			status: 'ready',
			content: 'Retry answer',
		});
		expect(session.title).toBe('Retry question');
		expect(fixture.context.activeRequest).toBeNull();
		expect(fixture.context.activeController).toBeNull();
		expect(fixture.context.isSending).toBe(false);
	});

	it('does not apply stale initial-save metadata after a session transition', async () => {
		const fixture = createEditTargetView();
		const first = makeSession('a1');
		const second = makeSession('a2');
		fixture.conversationStore.loadConversation.mockResolvedValue(
			loadedConversation([first, second], 'a1'),
		);
		const initialSave = deferred<void>();
		fixture.conversationStore.appendReadyMessage.mockImplementation(async () => {
			await initialSave.promise;
			return { ...first, title: 'Stale initial metadata', updatedAt: 999 };
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Question';
		}
		const submission = viewPrototype.submitPrompt.call(fixture.context);
		await vi.waitFor(() => expect(fixture.conversationStore.appendReadyMessage).toHaveBeenCalledOnce());

		await viewPrototype.switchActiveSession.call(fixture.context, 'a2');
		initialSave.resolve();
		await submission;

		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(first.title).toBe('New chat');
		expect(first.updatedAt).toBe(1);
		expect(first.messages[1]?.status).toBe('stopped');
	});

	it('clears a stopped create before an exact-ID retry instead of duplicate-creating', async () => {
		const { fixture, transient, transientId, originalUpdatedAt } = await beginDelayedTransientCreate('stop');
		expect.soft(fixture.context.transientSessionIds.has(transientId)).toBe(false);
		expect.soft(fixture.context.transientSessions.has('A.md')).toBe(false);
		expect.soft(transient?.updatedAt).toBe(originalUpdatedAt);
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Retry question';
		}

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.conversationStore.createSession).toHaveBeenCalledOnce();
		expect(fixture.conversationStore.appendReadyMessage).toHaveBeenCalledTimes(2);
		expect(fixture.conversationStore.appendReadyMessage.mock.calls.map((call) => call[1]))
			.toEqual([transientId, transientId]);
	});

	it('clears a note-switched create before exact-ID New, Rename, retry, and Delete', async () => {
		const { fixture, transient, transientId, originalUpdatedAt } = await beginDelayedTransientCreate('note-switch');
		expect.soft(fixture.context.transientSessionIds.has(transientId)).toBe(false);
		expect.soft(fixture.context.transientSessions.has('A.md')).toBe(false);
		expect.soft(transient?.updatedAt).toBe(originalUpdatedAt);

		await viewPrototype.createNewSession.call(fixture.context);
		expect(fixture.conversationStore.createSession).toHaveBeenCalledTimes(2);
		const newId = fixture.conversationStore.createSession.mock.calls[1]?.[1].id;
		expect(newId).not.toBe(transientId);
		await viewPrototype.switchActiveSession.call(fixture.context, transientId);
		await viewPrototype.renameActiveSession.call(fixture.context, 'Recovered title');
		expect(fixture.conversationStore.renameSession).toHaveBeenCalledExactlyOnceWith(
			'A.md',
			transientId,
			'Recovered title',
		);
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Retry question';
		}
		await viewPrototype.submitPrompt.call(fixture.context);
		expect(fixture.conversationStore.appendReadyMessage).toHaveBeenCalledTimes(2);
		await viewPrototype.deleteActiveSession.call(fixture.context);
		expect(fixture.conversationStore.deleteSession).toHaveBeenCalledExactlyOnceWith('A.md', transientId);
	});

	it('renames an already persisted session after a stopped create instead of duplicate-creating', async () => {
		const { fixture, transientId } = await beginDelayedTransientCreate('stop');
		expect.soft(fixture.context.transientSessionIds.has(transientId)).toBe(false);

		await viewPrototype.renameActiveSession.call(fixture.context, 'Pinned title');

		expect(fixture.conversationStore.createSession).toHaveBeenCalledOnce();
		expect(fixture.conversationStore.renameSession).toHaveBeenCalledExactlyOnceWith(
			'A.md',
			transientId,
			'Pinned title',
		);
	});

	it('deletes an already persisted session after a stopped create instead of discarding only locally', async () => {
		const { fixture, transientId } = await beginDelayedTransientCreate('stop');
		expect.soft(fixture.context.transientSessionIds.has(transientId)).toBe(false);

		await viewPrototype.deleteActiveSession.call(fixture.context);

		expect(fixture.conversationStore.deleteSession).toHaveBeenCalledExactlyOnceWith('A.md', transientId);
		expect(fixture.conversationStore.createSession).toHaveBeenCalledOnce();
	});

	it('aborts on close and ignores late stream content, errors, rendering, and cleanup', async () => {
		const fixture = createEditTargetView();
		const response = deferred<{ content: string; reasoning: string }>();
		let callbacks: { onContent(text: string): void } | undefined;
		fixture.requestChatCompletion.mockImplementation(async ({ callbacks: requestCallbacks }) => {
			callbacks = requestCallbacks;
			return response.promise;
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Close during stream';
		}
		const submission = viewPrototype.submitPrompt.call(fixture.context);
		await vi.waitFor(() => expect(fixture.requestChatCompletion).toHaveBeenCalledOnce());
		const request = fixture.context.activeRequest as ActiveRequest | null;
		const noticeStart = noticeMessages().length;
		fixture.context.scheduleMessageRender.mockClear();

		await viewPrototype.onClose.call(fixture.context);
		callbacks?.onContent('LATE_CLOSE_CONTENT');
		response.reject(new Error('Late provider failure'));
		await submission;

		expect(request?.controller.signal.aborted).toBe(true);
		expect(fixture.context.closed).toBe(true);
		expect(fixture.context.activeRequest).toBeNull();
		expect(fixture.context.isSending).toBe(false);
		expect(fixture.context.scheduleMessageRender).not.toHaveBeenCalledWith(
			request?.loadingMessage,
		);
		expect(fixture.conversationStore.appendReadyMessage).not.toHaveBeenCalled();
		expect(noticeMessages().slice(noticeStart)).toEqual([]);
	});
});

function findSessionSelect(contentEl: FakeElement): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) => element.tagName === 'select' && element.attributes['aria-label'] === 'Chat session',
	)[0];
}

function findSessionButton(contentEl: FakeElement, label: string): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) => element.tagName === 'button' && element.attributes['aria-label'] === label,
	)[0];
}

describe('EmendChatView session management', () => {
	it('persists and activates an empty New session without a provider call', async () => {
		const fixture = createEditTargetView();
		const first = makeSession('a1');
		fixture.conversationStore.loadConversation.mockResolvedValue(loadedConversation([first]));
		await viewPrototype.refreshTargetNote.call(fixture.context);
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'First draft';
		}

		await viewPrototype.createNewSession.call(fixture.context);

		const created = fixture.conversationStore.createSession.mock.calls[0]?.[1];
		expect(created).toMatchObject({ title: 'New chat', titleSource: 'auto', messages: [] });
		expect(fixture.context.sessions.map((session) => session.id)).toEqual(['a1', created?.id]);
		expect(fixture.context.activeSessionId).toBe(created?.id);
		expect(fixture.context.messages).toBe(created?.messages);
		expect(fixture.context.inputEl?.value).toBe('');
		expect(fixture.context.drafts.get('A.md')?.get('a1')).toBe('First draft');
		expect(findSessionSelect(fixture.contentEl)?.value).toBe(created?.id);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	});

	it('persists a sole empty transient in place and transfers its draft', async () => {
		const fixture = createEditTargetView();
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const transientId = fixture.context.activeSessionId;
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Keep this draft';
		}

		await viewPrototype.createNewSession.call(fixture.context);

		expect(fixture.conversationStore.createSession).toHaveBeenCalledOnce();
		expect(fixture.conversationStore.createSession.mock.calls[0]?.[1].id).toBe(transientId);
		expect(fixture.context.sessions).toHaveLength(1);
		expect(fixture.context.activeSessionId).toBe(transientId);
		expect(fixture.context.inputEl?.value).toBe('Keep this draft');
		expect(fixture.context.transientSessionIds.has(transientId ?? '')).toBe(false);
		expect(fixture.context.transientSessions.has('A.md')).toBe(false);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	});

	it('recovers failed-save ready users before creating and activating the requested New session', async () => {
		const fixture = createEditTargetView();
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const transientId = fixture.context.activeSessionId;
		const readyUser: ChatMessage = {
			...message('unsaved-user', 'A.md'),
			role: 'user',
			content: 'Recover me',
		};
		fixture.context.messages.push(
			readyUser,
			{ ...message('save-error', 'A.md'), status: 'error' },
		);
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Recovered draft';
		}

		await viewPrototype.createNewSession.call(fixture.context);

		expect(fixture.conversationStore.createSession).toHaveBeenCalledTimes(2);
		const recovered = fixture.conversationStore.createSession.mock.calls[0]?.[1];
		const created = fixture.conversationStore.createSession.mock.calls[1]?.[1];
		expect(recovered?.id).toBe(transientId);
		expect(recovered?.messages.map((item) => item.id)).toEqual(['unsaved-user']);
		expect(created?.messages).toEqual([]);
		expect(fixture.context.sessions.map((session) => session.id)).toEqual([transientId, created?.id]);
		expect(fixture.context.activeSessionId).toBe(created?.id);
		expect(fixture.context.drafts.get('A.md')?.get(transientId ?? '')).toBe('Recovered draft');
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	});

	it('keeps the recovered session visible if the second New mutation fails', async () => {
		const fixture = createEditTargetView();
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const transientId = fixture.context.activeSessionId;
		fixture.context.messages.push({
			...message('unsaved-user', 'A.md'),
			role: 'user',
			content: 'Recover me',
		});
		fixture.conversationStore.createSession
			.mockImplementationOnce(async (_notePath, session) => session)
			.mockRejectedValueOnce(new Error('Disk full'));
		const noticeStart = noticeMessages().length;

		await viewPrototype.createNewSession.call(fixture.context);

		expect(fixture.context.sessions.map((session) => session.id)).toEqual([transientId]);
		expect(fixture.context.activeSessionId).toBe(transientId);
		expect(fixture.context.messages.map((item) => item.id)).toEqual(['unsaved-user']);
		expect(fixture.context.transientSessionIds.has(transientId ?? '')).toBe(false);
		expect(fixture.context.isSessionMutating).toBe(false);
		expect(noticeMessages().slice(noticeStart).join('\n')).toContain('Could not create chat session');
	});

	it('leaves the current session, messages, and draft visible when set-active fails', async () => {
		const fixture = createEditTargetView();
		const first = makeSession('a1', [message('first', 'A.md')]);
		const second = makeSession('a2', [message('second', 'A.md')]);
		fixture.conversationStore.loadConversation.mockResolvedValue(
			loadedConversation([first, second], 'a1'),
		);
		fixture.conversationStore.setActiveSession.mockRejectedValue(new Error('Disk full'));
		await viewPrototype.refreshTargetNote.call(fixture.context);
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Unchanged draft';
		}

		await viewPrototype.switchActiveSession.call(fixture.context, 'a2');

		expect(fixture.context.activeSessionId).toBe('a1');
		expect(fixture.context.messages).toBe(first.messages);
		expect(fixture.context.inputEl?.value).toBe('Unchanged draft');
		expect(findSessionSelect(fixture.contentEl)?.value).toBe('a1');
	});

	it('renames an existing exact session ID and pins its manual title', async () => {
		const fixture = createEditTargetView();
		const first = makeSession('a1');
		fixture.conversationStore.loadConversation.mockResolvedValue(loadedConversation([first]));
		fixture.conversationStore.renameSession.mockResolvedValue({
			...first,
			title: 'Manual title',
			titleSource: 'manual',
			updatedAt: 99,
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);

		await viewPrototype.renameActiveSession.call(fixture.context, 'Manual title');

		expect(fixture.conversationStore.renameSession).toHaveBeenCalledExactlyOnceWith(
			'A.md',
			'a1',
			'Manual title',
		);
		expect(first).toMatchObject({
			title: 'Manual title',
			titleSource: 'manual',
			updatedAt: 99,
		});
		expect(fixture.context.messages).toBe(first.messages);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	});

	it('materializes a transient rename with its ready messages and manual title', async () => {
		const fixture = createEditTargetView();
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const transientId = fixture.context.activeSessionId;
		fixture.context.messages.push(
			{ ...message('ready-user', 'A.md'), role: 'user' },
			{ ...message('transient-error', 'A.md'), status: 'error' },
		);
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Rename draft';
		}

		await viewPrototype.renameActiveSession.call(fixture.context, 'Pinned title');

		const created = fixture.conversationStore.createSession.mock.calls[0]?.[1];
		expect(created).toMatchObject({
			id: transientId,
			title: 'Pinned title',
			titleSource: 'manual',
		});
		expect(created?.messages.map((item) => item.id)).toEqual(['ready-user']);
		expect(fixture.context.sessions[0]).toMatchObject({
			id: transientId,
			title: 'Pinned title',
			titleSource: 'manual',
		});
		expect(fixture.context.messages.map((item) => item.id)).toEqual(['ready-user']);
		expect(fixture.context.inputEl?.value).toBe('Rename draft');
		expect(fixture.context.transientSessions.has('A.md')).toBe(false);
		expect(fixture.conversationStore.renameSession).not.toHaveBeenCalled();
	});

	it.each([
		{ active: 'b', fallback: 'c', expectedOrder: ['a', 'c'], description: 'next sibling' },
		{ active: 'c', fallback: 'b', expectedOrder: ['a', 'b'], description: 'previous sibling' },
	])('deletes the active session and applies the $description fallback only after success', async ({ active, fallback, expectedOrder }) => {
		const fixture = createEditTargetView();
		const sessions = [makeSession('a'), makeSession('b'), makeSession('c')];
		fixture.conversationStore.loadConversation.mockResolvedValue(
			loadedConversation(sessions, active),
		);
		fixture.conversationStore.deleteSession.mockResolvedValue({ activeSessionId: fallback });
		await viewPrototype.refreshTargetNote.call(fixture.context);
		fixture.context.drafts.set('A.md', new Map([[active, 'Delete me']]));

		await viewPrototype.deleteActiveSession.call(fixture.context);

		expect(fixture.conversationStore.deleteSession).toHaveBeenCalledExactlyOnceWith('A.md', active);
		expect(fixture.context.sessions.map((session) => session.id)).toEqual(expectedOrder);
		expect(fixture.context.activeSessionId).toBe(fallback);
		expect(fixture.context.drafts.get('A.md')?.has(active)).toBe(false);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	});

	it('creates a fresh transient New chat after deleting the last persisted session', async () => {
		const fixture = createEditTargetView();
		const only = makeSession('only', [message('old', 'A.md')]);
		fixture.conversationStore.loadConversation.mockResolvedValue(loadedConversation([only]));
		fixture.conversationStore.deleteSession.mockResolvedValue({ activeSessionId: null });
		await viewPrototype.refreshTargetNote.call(fixture.context);
		fixture.context.drafts.set('A.md', new Map([['only', 'Old draft']]));

		await viewPrototype.deleteActiveSession.call(fixture.context);

		expect(fixture.context.sessions).toHaveLength(1);
		expect(fixture.context.activeSessionId).not.toBe('only');
		expect(fixture.context.activeSessionId).not.toBeNull();
		expect(fixture.context.messages).toEqual([]);
		expect(fixture.context.transientSessions.get('A.md')?.id).toBe(fixture.context.activeSessionId);
		expect(fixture.context.drafts.get('A.md')?.has('only')).toBe(false);
	});

	it.each(['missing', 'malformed', 'unsupported'] as const)(
		'deletes a %s-backed transient locally with zero store or adapter operations',
		async (kind) => {
			const fixture = createEditTargetView();
			fixture.conversationStore.loadConversation.mockResolvedValue(loadedConversation([], null, kind));
			await viewPrototype.refreshTargetNote.call(fixture.context);
			const oldId = fixture.context.activeSessionId;
			fixture.context.messages.push({ ...message('old-error', 'A.md'), status: 'error' });
			fixture.context.drafts.set('A.md', new Map([[oldId ?? '', 'Old draft']]));
			fixture.conversationStore.createSession.mockClear();
			fixture.conversationStore.appendReadyMessage.mockClear();
			fixture.conversationStore.setActiveSession.mockClear();
			fixture.conversationStore.renameSession.mockClear();
			fixture.conversationStore.deleteSession.mockClear();
			fixture.conversationStore.reorderSessions.mockClear();
			fixture.read.mockClear();

			await viewPrototype.deleteActiveSession.call(fixture.context);

			expect(fixture.context.activeSessionId).not.toBe(oldId);
			expect(fixture.context.messages).toEqual([]);
			expect(fixture.context.drafts.get('A.md')?.has(oldId ?? '')).toBe(false);
			expect(fixture.conversationStore.createSession).not.toHaveBeenCalled();
			expect(fixture.conversationStore.appendReadyMessage).not.toHaveBeenCalled();
			expect(fixture.conversationStore.setActiveSession).not.toHaveBeenCalled();
			expect(fixture.conversationStore.renameSession).not.toHaveBeenCalled();
			expect(fixture.conversationStore.deleteSession).not.toHaveBeenCalled();
			expect(fixture.conversationStore.reorderSessions).not.toHaveBeenCalled();
			expect(fixture.read).not.toHaveBeenCalled();
			expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		},
	);

	it('preserves visible titles, membership, and order when management mutations fail', async () => {
		const fixture = createEditTargetView();
		const sessions = [makeSession('a'), makeSession('b')];
		sessions[0]!.title = 'First';
		sessions[1]!.title = 'Second';
		fixture.conversationStore.loadConversation.mockResolvedValue(
			loadedConversation(sessions, 'b'),
		);
		fixture.conversationStore.renameSession.mockRejectedValue(new Error('Rename failed'));
		fixture.conversationStore.deleteSession.mockRejectedValue(new Error('Delete failed'));
		await viewPrototype.refreshTargetNote.call(fixture.context);

		await viewPrototype.renameActiveSession.call(fixture.context, 'Changed');
		await viewPrototype.deleteActiveSession.call(fixture.context);

		expect(fixture.context.sessions.map((session) => [session.id, session.title])).toEqual([
			['a', 'First'],
			['b', 'Second'],
		]);
		expect(fixture.context.activeSessionId).toBe('b');
		expect(fixture.context.isSessionMutating).toBe(false);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	});

	it('disables session controls while sending, loading, or mutating but leaves Stop available', async () => {
		const fixture = createEditTargetView();
		fixture.conversationStore.loadConversation.mockResolvedValue(
			loadedConversation([makeSession('a'), makeSession('b')]),
		);
		await viewPrototype.refreshTargetNote.call(fixture.context);
		for (const state of ['isSending', 'isThreadLoading', 'isSessionMutating'] as const) {
			fixture.context.isSending = state === 'isSending';
			fixture.context.isThreadLoading = state === 'isThreadLoading';
			fixture.context.isSessionMutating = state === 'isSessionMutating';
			fixture.render();
			for (const label of [
				'New chat session',
				'Rename chat session',
				'Delete chat session',
			]) {
				expect(findSessionButton(fixture.contentEl, label)?.disabled).toBe(true);
			}
			expect(findSessionSelect(fixture.contentEl)?.disabled).toBe(true);
			if (state === 'isSending') {
				const stop = findElements(
					fixture.contentEl,
					(element) => element.tagName === 'button' && element.textContent === 'Stop',
				)[0];
				expect(stop?.disabled).toBe(false);
			}
		}
	});

	it('rejects direct management actions while sending, loading, or another mutation is pending', async () => {
		const fixture = createEditTargetView();
		fixture.conversationStore.loadConversation.mockResolvedValue(loadedConversation([makeSession('a')]));
		await viewPrototype.refreshTargetNote.call(fixture.context);
		for (const state of ['isSending', 'isThreadLoading', 'isSessionMutating'] as const) {
			fixture.context.isSending = state === 'isSending';
			fixture.context.isThreadLoading = state === 'isThreadLoading';
			fixture.context.isSessionMutating = state === 'isSessionMutating';

			await viewPrototype.createNewSession.call(fixture.context);
			await viewPrototype.renameActiveSession.call(fixture.context, 'Changed');
			await viewPrototype.deleteActiveSession.call(fixture.context);
		}

		expect(fixture.conversationStore.createSession).not.toHaveBeenCalled();
		expect(fixture.conversationStore.renameSession).not.toHaveBeenCalled();
		expect(fixture.conversationStore.deleteSession).not.toHaveBeenCalled();
		expect(fixture.conversationStore.reorderSessions).not.toHaveBeenCalled();
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	});

	it('places session controls directly between capacity and messages, outside the header', async () => {
		const fixture = createEditTargetView();
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const orderedClasses = [
			'emend-chat-mode-selector',
			'emend-context-capacity',
			'emend-chat-session-controls',
			'emend-chat-messages',
		];
		const actual = fixture.contentEl.children
			.map((element) => element.className.split(' ')[0])
			.filter((className) => className && orderedClasses.includes(className));
		const header = fixture.contentEl.children.find(
			(element) => element.className.split(' ').includes('emend-chat-header'),
		);

		expect(actual).toEqual(orderedClasses);
		expect(header && findElements(
			header,
			(element) => element.className.split(' ').includes('emend-chat-session-controls'),
		)).toEqual([]);
	});

	it('keeps wrapping session controls and a narrow full-width selector', () => {
		expect(getCssRule('.emend-chat-session-controls')).toContain('flex-wrap: wrap;');
		expect(getCssRule('.emend-chat-session-controls')).toContain('min-width: 0;');
		expect(getCssRule('.emend-chat-session-select')).toContain('min-width: 0;');
		expect(getCssRule('.emend-chat-session-select')).toContain('width: 100%;');
	});
});

interface SelectionSubmissionOptions {
	fullText?: string;
	selectedText?: string;
	from?: number;
	to?: number;
	summaryItems?: readonly EditSummaryItem[];
	summary?: string;
}

function createSelectionEditSubmission(options: SelectionSubmissionOptions = {}) {
	const file = new TFile();
	file.path = 'Note.md';
	const snapshot: SelectionSnapshot = {
		file,
		fullText: options.fullText ?? 'Alpha beta.',
		selectedText: options.selectedText ?? 'beta',
		from: options.from ?? 6,
		to: options.to ?? 10,
	};
	const editor: SelectionEditorAdapter = {
		readCurrentText: vi.fn(() => snapshot.fullText),
		isTargetCurrent: vi.fn(() => true),
		replaceRange: vi.fn(),
	};
	const additionalNotesStore = new AdditionalNotesStore();
	const captureSelectionEditTarget = vi.fn(() => ({ snapshot, editor }));
	const captureChatContext = vi.fn(() => ({
		file,
		sourceText: snapshot.fullText,
		selection: { from: snapshot.from, to: snapshot.to },
		noteLabel: file.path,
		markdown: snapshot.fullText,
	}));
	const requestSelectionEdit = vi.fn(async (
		_snapshot: SelectionSnapshot,
		_prompt: string,
		_signal: AbortSignal,
		_editor: SelectionEditorAdapter,
		_additionalNotePaths: readonly string[],
		_history: ProviderHistoryMessage[],
		callbacks?: SelectionEditCallbacks,
	): Promise<SelectionEditResult> => {
		callbacks?.onReasoning?.('REJECTED raw JSON and diagnostics');
		callbacks?.onRetry?.();
		callbacks?.onReasoning?.('Successful reasoning');
		return {
			applied: true,
			changeCount: 2,
			summaryItems: options.summaryItems ?? [{ type: 'replace', start: 0, end: 4 }],
			...(options.summary === undefined ? {} : { summary: options.summary }),
			usage: {
				promptTokens: 30,
				completionTokens: 7,
				totalTokens: 37,
				source: 'provider',
			},
		};
	});
	const requestChatCompletion = vi.fn(async (submission: {
		mode: Mode;
		prompt: string;
		history: ProviderHistoryMessage[];
		additionalNotePaths: readonly string[];
		callbacks: { onContent?: (text: string) => void };
	}) => {
		if (submission.mode === 'edit') {
			return {
				applied: false,
				changeCount: 0,
				usage: {
					promptTokens: 3,
					completionTokens: 1,
					totalTokens: 4,
					source: 'provider' as const,
				},
			};
		}
		submission.callbacks.onContent?.('Answer');
		return {
			content: 'Answer',
			reasoning: '',
			usage: {
				promptTokens: 3,
				completionTokens: 1,
				totalTokens: 4,
				source: 'provider' as const,
			},
		};
	});
	const savedSnapshots: ChatMessage[][] = [];
	let activePath = file.path;
	const context = {
		inputEl: { value: 'Edit selection' },
		isSending: false,
		isThreadLoading: false,
		selectedMode: 'edit' as Mode,
		editTargetChoice: 'auto' as 'auto' | 'full-note' | 'selection',
		displayedEditTarget: 'selection' as 'full-note' | 'selection',
		webSearchMode: 'off' as const,
		notePath: file.path as string | null,
		conversationGeneration: 0,
		messages: [] as ChatMessage[],
		drafts: new Map<string, Map<string, string>>(),
		plugin: {
			getActiveNotePath: () => activePath,
			conversationStore: {
				loadConversation: vi.fn(async () => loadedConversation([])),
			},
			captureChatContext,
			captureSelectionEditTarget,
			additionalNotesStore,
			requestChatCompletion,
			requestSelectionEdit,
			settings: { maxWebToolCalls: 8, historyMessageLimit: 8 },
		},
		toProviderHistory: () => viewPrototype.toProviderHistory.call(context),
		persistMessages: vi.fn(async (_path: string, messages: ChatMessage[]) => {
			savedSnapshots.push(messages.map((message) => ({ ...message })));
		}),
		render: vi.fn(),
		scheduleMessageRender: vi.fn(),
		closed: false,
		activeController: null as AbortController | null,
	};
	return {
		context,
		snapshot,
		editor,
		additionalNotesStore,
		captureChatContext,
		captureSelectionEditTarget,
		requestChatCompletion,
		requestSelectionEdit,
		savedSnapshots,
		persistMessages: context.persistMessages,
		setActivePath: (path: string) => {
			activePath = path;
		},
	};
}

describe('EmendChatView selection edit submission', () => {
	it('routes automatic displayed Selection through the exact native-editor request and normal saves', async () => {
		const fixture = createSelectionEditSubmission();
		fixture.additionalNotesStore.add('Note.md', 'Reference.md');
		const summary = 'Edit applied — 2 changes tracked. Review in Track Changes.\nTarget: Selection.\n\n- Replaced line 1.';

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.captureSelectionEditTarget).toHaveBeenCalledOnce();
		expect(fixture.captureChatContext).not.toHaveBeenCalled();
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.requestSelectionEdit).toHaveBeenCalledOnce();
		const args = fixture.requestSelectionEdit.mock.calls[0];
		expect(args?.[0]).toBe(fixture.snapshot);
		expect(args?.[1]).toBe('Edit selection');
		expect(args?.[2]).toBeInstanceOf(AbortSignal);
		expect(args?.[2].aborted).toBe(false);
		expect(args?.[3]).toBe(fixture.editor);
		expect(args?.[4]).toEqual(['Reference.md']);
		expect(args?.[5]).toEqual([]);
		expect(typeof args?.[6]?.onReasoning).toBe('function');
		expect(typeof args?.[6]?.onRetry).toBe('function');
		expect(fixture.context.messages[1]).toMatchObject({
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
		expect(fixture.savedSnapshots).toHaveLength(2);
		const persisted = JSON.stringify(fixture.savedSnapshots);
		expect(persisted).not.toContain('REJECTED raw JSON');
		expect(persisted).not.toContain('Alpha beta.');
		expect(persisted).not.toContain('"from":6');
		expect(persisted).not.toContain('"to":10');

		fixture.context.inputEl.value = 'Next question';
		fixture.context.selectedMode = 'ask';
		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.requestChatCompletion.mock.calls[0]?.[0].history.map(
			(message) => message.content,
		)).toEqual([
			'Edit selection',
			summary,
		]);
	});

	it('sends the same captured ready history as full-note and read-only requests', async () => {
		const fixture = createSelectionEditSubmission();
		fixture.context.messages.push(
			{
				...message('earlier-question', 'Note.md'),
				role: 'user',
				content: 'Earlier question',
			},
			message('earlier-answer', 'Note.md'),
		);

		await viewPrototype.submitPrompt.call(fixture.context);

		const args = fixture.requestSelectionEdit.mock.calls[0];
		expect(args?.[5]).toEqual([
			{ role: 'user', content: 'Earlier question', mode: 'ask', origin: 'user' },
			{ role: 'assistant', content: 'earlier-answer', mode: 'ask', origin: 'model' },
		]);
	});

	it('adds the Selection start offset once to note-absolute summary lines', async () => {
		const fixture = createSelectionEditSubmission({
			fullText: 'Intro line.\nFirst target.\nSecond target.\nOutro line.',
			selectedText: 'First target.\nSecond target.',
			from: 12,
			to: 40,
			summaryItems: [{ type: 'replace', start: 0, end: 28 }],
		});

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.context.messages[1]?.content).toBe(
			'Edit applied — 2 changes tracked. Review in Track Changes.\nTarget: Selection.\n\n- Replaced lines 2–3.',
		);
	});

	it('keeps the exact no-op text when a non-applied result carries summary items', async () => {
		const fixture = createSelectionEditSubmission();
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

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.context.messages[1]?.content).toBe('No changes were needed.');
		expect(fixture.context.messages[1]?.content).not.toContain('- ');
	});

	it('formats full-note summaries against the captured note source', async () => {
		const file = new TFile();
		file.path = 'Note.md';
		const sourceText = 'Intro line.\nSecond line.\nThird line.\nTarget line.\nOutro line.';
		const targetStart = sourceText.indexOf('Target line.');
		const context = {
			inputEl: { value: 'Edit note' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'edit' as Mode,
			displayedEditTarget: 'full-note' as const,
			messages: [] as ChatMessage[],
			plugin: {
				captureChatContext: () => ({
					file,
					sourceText,
					selection: { from: 0, to: 0 },
					noteLabel: file.path,
					markdown: 'Window line.\nTarget line.',
				}),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion: vi.fn(async () => ({
					applied: true,
					changeCount: 1,
					summaryItems: [{
						type: 'replace' as const,
						start: targetStart,
						end: targetStart + 'Target line.'.length,
					}],
					summary: 'Sharpened the target line.',
					usage: {
						promptTokens: 3,
						completionTokens: 1,
						totalTokens: 4,
						source: 'provider' as const,
					},
				})),
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(async () => undefined),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
		};

		await viewPrototype.submitPrompt.call(context);

		expect(context.messages[1]?.content).toBe([
			'Edit applied — 1 changes tracked. Review in Track Changes.',
			'Target: Full note.',
			'',
			'Sharpened the target line.',
			'',
			'- Replaced line 4.',
		].join('\n'));
	});

	it('renders a full-note summary with no bullets', async () => {
		const fixture = createSelectionEditSubmission();
		fixture.context.editTargetChoice = 'full-note';
		fixture.context.displayedEditTarget = 'full-note';
		const noItemResult = {
			applied: true,
			changeCount: 0,
			summaryItems: [],
			summary: 'Reviewed without changing the note.',
			usage: {
				promptTokens: 3,
				completionTokens: 1,
				totalTokens: 4,
				source: 'provider' as const,
			},
		};
		fixture.requestChatCompletion.mockResolvedValueOnce(noItemResult);

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.context.messages[1]?.content).toBe([
			'Edit applied — 0 changes tracked. Review in Track Changes.',
			'Target: Full note.',
			'',
			'Reviewed without changing the note.',
		].join('\n'));
	});

	it('renders the Selection target and model summary as persisted plain content', async () => {
		const fixture = createSelectionEditSubmission({
			summary: 'Renamed **beta** to delta.',
		});

		await viewPrototype.submitPrompt.call(fixture.context);

		const expected = [
			'Edit applied — 2 changes tracked. Review in Track Changes.',
			'Target: Selection.',
			'',
			'Renamed **beta** to delta.',
			'',
			'- Replaced line 1.',
		].join('\n');
		expect(fixture.context.messages[1]?.content).toBe(expected);
		const saved = fixture.savedSnapshots[1]?.[1];
		expect(saved?.content).toBe(expected);
		expect(Object.prototype.hasOwnProperty.call(saved, 'summary')).toBe(false);
	});

	it('renders a no-op summary after the exact no-op sentence', async () => {
		const fixture = createSelectionEditSubmission();
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

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.context.messages[1]?.content).toBe(
			'No changes were needed.\n\nReviewed without changing the selection.',
		);
		expect(fixture.savedSnapshots[1]?.[1]?.content).toBe(
			'No changes were needed.\n\nReviewed without changing the selection.',
		);
	});

	it('never renders a summary field from a read-only response', async () => {
		const fixture = createSelectionEditSubmission();
		fixture.context.selectedMode = 'ask';
		const readOnlyResult = {
			content: 'Answer',
			reasoning: '',
			summary: 'Read-only model prose must stay hidden.',
			usage: {
				promptTokens: 3,
				completionTokens: 1,
				totalTokens: 4,
				source: 'provider' as const,
			},
		};
		fixture.requestChatCompletion.mockImplementationOnce(async (submission) => {
			submission.callbacks.onContent?.('Answer');
			return readOnlyResult;
		});

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.context.messages[1]?.content).toBe('Answer');
		expect(fixture.context.messages[1]?.content).not.toContain('Read-only model prose');
		expect(fixture.savedSnapshots[1]?.[1]?.content).toBe('Answer');
	});

	it('keeps explicit Full note on the ordinary request despite a usable selection', async () => {
		const fixture = createSelectionEditSubmission();
		fixture.context.editTargetChoice = 'full-note';
		fixture.context.displayedEditTarget = 'full-note';

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.captureChatContext).toHaveBeenCalledOnce();
		expect(fixture.requestChatCompletion).toHaveBeenCalledOnce();
		expect(fixture.captureSelectionEditTarget).not.toHaveBeenCalled();
		expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
	});

	it.each(['ask', 'discuss', 'brainstorm'] as const)(
		'never routes read-only %s to a selection writer',
		async (mode) => {
			const fixture = createSelectionEditSubmission();
			fixture.context.selectedMode = mode;

			await viewPrototype.submitPrompt.call(fixture.context);

			expect(fixture.requestChatCompletion).toHaveBeenCalledOnce();
			expect(fixture.requestChatCompletion.mock.calls[0]?.[0].mode).toBe(mode);
			expect(fixture.captureSelectionEditTarget).not.toHaveBeenCalled();
			expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
		},
	);

	it.each(['auto', 'selection'] as const)(
		'fails closed without messages, saves, or fallback when %s Selection capture fails',
		async (choice) => {
			const fixture = createSelectionEditSubmission();
			fixture.context.editTargetChoice = choice;
			fixture.captureSelectionEditTarget.mockImplementation(() => {
				throw new Error('Select non-whitespace text first.');
			});
			const noticeMessages = (Notice as unknown as {
				readonly messages: string[];
			}).messages;
			const noticeCount = noticeMessages.length;

			await viewPrototype.submitPrompt.call(fixture.context);

			expect(noticeMessages.slice(noticeCount)).toEqual([
				'Emend: Select non-whitespace text first.',
			]);
			expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
			expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
			expect(fixture.captureChatContext).not.toHaveBeenCalled();
			expect(fixture.context.messages).toEqual([]);
			expect(fixture.savedSnapshots).toEqual([]);
			expect(fixture.context.isSending).toBe(false);
		},
	);

	it('captures the selection and additional-note paths before a deferred initial save', async () => {
		const fixture = createSelectionEditSubmission();
		fixture.additionalNotesStore.add('Note.md', 'Selected.md');
		const firstSave = deferred<void>();
		const response = deferred<SelectionEditResult>();
		fixture.persistMessages.mockImplementationOnce(() => firstSave.promise);
		fixture.requestSelectionEdit.mockImplementationOnce(() => response.promise);

		const submission = viewPrototype.submitPrompt.call(fixture.context);
		expect(fixture.captureSelectionEditTarget).toHaveBeenCalledOnce();
		expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
		fixture.additionalNotesStore.clear('Note.md');
		fixture.additionalNotesStore.add('Note.md', 'Later.md');
		fixture.captureSelectionEditTarget.mockImplementation(() => {
			throw new Error('Selection changed after capture.');
		});
		firstSave.resolve();
		await vi.waitFor(() => expect(fixture.requestSelectionEdit).toHaveBeenCalledOnce());

		const args = fixture.requestSelectionEdit.mock.calls[0];
		expect(args?.[0]).toBe(fixture.snapshot);
		expect(args?.[3]).toBe(fixture.editor);
		expect(args?.[4]).toEqual(['Selected.md']);
		response.resolve({
			applied: false,
			changeCount: 0,
			summaryItems: [],
			usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3, source: 'provider' },
		});
		await submission;
		expect(fixture.context.messages[1]?.content).toBe('No changes were needed.');
	});

	it.each([
		['provider', 'Provider unavailable'],
		['validation', 'Invalid operation array'],
		['stale', 'The note changed while Emend was responding. No edits were applied.'],
	])('settles a %s failure and permits a selection retry without fallback', async (_kind, errorMessage) => {
		const fixture = createSelectionEditSubmission();
		fixture.requestSelectionEdit.mockRejectedValueOnce(new Error(errorMessage));

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.context.messages[1]).toMatchObject({
			status: 'error',
			content: errorMessage,
		});
		expect(fixture.context.isSending).toBe(false);
		expect(fixture.context.activeController).toBeNull();
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.savedSnapshots.flat().some(
			(message) => message.status === 'error',
		)).toBe(false);

		fixture.context.inputEl.value = 'Retry selection';
		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.requestSelectionEdit).toHaveBeenCalledTimes(2);
		expect(fixture.context.messages[3]?.status).toBe('ready');
	});

	it('uses the existing stopped lifecycle and excludes the partial response from saves', async () => {
		const fixture = createSelectionEditSubmission();
		const response = deferred<SelectionEditResult>();
		fixture.requestSelectionEdit.mockImplementationOnce(() => response.promise);
		const submission = viewPrototype.submitPrompt.call(fixture.context);
		await vi.waitFor(() => expect(fixture.requestSelectionEdit).toHaveBeenCalledOnce());

		fixture.context.activeController?.abort();
		response.resolve({
			applied: false,
			changeCount: 0,
			summaryItems: [],
			usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3, source: 'provider' },
		});
		await submission;

		expect(fixture.context.messages[1]?.status).toBe('stopped');
		expect(fixture.context.isSending).toBe(false);
		expect(fixture.context.activeController).toBeNull();
		expect(fixture.savedSnapshots.flat().some(
			(message) => message.status === 'stopped',
		)).toBe(false);
	});

	it('aborts the captured selection request on a note switch without saving it to the new thread', async () => {
		const fixture = createSelectionEditSubmission();
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
		const submission = viewPrototype.submitPrompt.call(fixture.context);
		await vi.waitFor(() => expect(fixture.requestSelectionEdit).toHaveBeenCalledOnce());

		fixture.setActivePath('Other.md');
		await viewPrototype.refreshTargetNote.call(fixture.context);
		expect(requestSignal?.aborted).toBe(true);
		response.resolve({
			applied: false,
			changeCount: 0,
			summaryItems: [],
			usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3, source: 'provider' },
		});
		await submission;

		expect(fixture.context.notePath).toBe('Other.md');
		expect(fixture.context.messages).toEqual([]);
		expect(fixture.context.isSending).toBe(false);
		expect(fixture.context.activeController).toBeNull();
		expect(fixture.savedSnapshots.flat().some(
			(message) => message.status === 'stopped',
		)).toBe(false);
	});
});

describe('EmendChatView additional notes', () => {
	it('freezes the selected paths before the first deferred save', async () => {
		const firstSave = deferred<void>();
		const response = deferred<{ content: string; reasoning: string }>();
		const additionalNotesStore = new AdditionalNotesStore();
		additionalNotesStore.add('Note.md', 'Selected.md');
		const requestChatCompletion = vi.fn(
			(_submission: { additionalNotePaths: readonly string[] }) => response.promise,
		);
		let saveCount = 0;
		const context = {
			inputEl: { value: 'Question' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			messages: [] as ChatMessage[],
			plugin: {
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore,
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(() => {
				saveCount++;
				return saveCount === 1 ? firstSave.promise : Promise.resolve();
			}),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
		};

		const submission = viewPrototype.submitPrompt.call(context);
		expect(requestChatCompletion).not.toHaveBeenCalled();
		additionalNotesStore.clear('Note.md');
		additionalNotesStore.add('Note.md', 'Later.md');
		firstSave.resolve();
		await vi.waitFor(() => expect(requestChatCompletion).toHaveBeenCalledOnce());

		expect(requestChatCompletion.mock.calls[0]?.[0].additionalNotePaths).toEqual([
			'Selected.md',
		]);
		response.resolve({ content: 'Answer', reasoning: '' });
		await submission;
	});

	it('keeps independent per-note drafts and selections and disables controls while pending', async () => {
		let activePath = 'A.md';
		const additionalNotesStore = new AdditionalNotesStore();
		const contentEl = new FakeElement();
		const context = {
			app: {},
			contentEl,
			plugin: {
				getActiveNotePath: () => activePath,
				getActiveNoteLabel: () => activePath,
				hasUsableSelection: () => false,
				conversationStore: {
					loadConversation: vi.fn(async () => loadedConversation([])),
				},
				additionalNotesStore,
				settings: {
					activeProvider: 'custom',
					providers: {
					custom: {
						name: 'Local',
						model: 'Test model',
						contextWindowTokens: null,
						outputReserveTokens: null,
						contextCapacityInvalid: false,
					},
				},
				},
			},
			notePath: null as string | null,
			conversationGeneration: 0,
			messages: [] as ChatMessage[],
			selectedMode: 'ask' as Mode,
			isThreadLoading: false,
			isSending: false,
			activeController: null,
			closed: false,
			inputEl: null as FakeElement | null,
			drafts: new Map<string, Map<string, string>>(),
			additionalNotesControl: null,
			pendingMessages: new Set<ChatMessage>(),
			messageBodyEls: new Map<string, HTMLElement>(),
			activeModelEl: null,
			cancelPendingRender: vi.fn(),
		};
		Object.setPrototypeOf(context, EmendChatView.prototype);
		Object.assign(context, {
			render: () => viewPrototype.render.call(context),
		});

		await viewPrototype.refreshTargetNote.call(context);
		const aComposer = context.inputEl;
		if (!aComposer) {
			throw new Error('A composer missing.');
		}
		aComposer.value = 'A draft';
		additionalNotesStore.add('A.md', 'For A.md');
		expect(context.inputEl).toBe(aComposer);
		expect(aComposer.value).toBe('A draft');
		expect(textOf(contentEl)).toContain('For A.md');

		activePath = 'B.md';
		await viewPrototype.refreshTargetNote.call(context);
		expect(context.inputEl?.value).toBe('');
		expect(textOf(contentEl)).not.toContain('For A.md');
		additionalNotesStore.add('B.md', 'For B.md');
		if (!context.inputEl) {
			throw new Error('B composer missing.');
		}
		context.inputEl.value = 'B draft';
		expect(textOf(contentEl)).toContain('For B.md');

		activePath = 'A.md';
		await viewPrototype.refreshTargetNote.call(context);
		expect(context.inputEl?.value).toBe('A draft');
		expect(textOf(contentEl)).toContain('For A.md');
		expect(textOf(contentEl)).not.toContain('For B.md');

		context.isSending = true;
		viewPrototype.render.call(context);
		const additionalButtons = findElements(
			contentEl,
			(element) =>
				element.tagName === 'button' &&
				element.className.includes('emend-additional-notes-'),
		);
		expect(additionalButtons.length).toBeGreaterThanOrEqual(3);
		expect(additionalButtons.every((button) => button.disabled)).toBe(true);
		expect(context.inputEl?.disabled).toBe(true);
		const quickActions = findElements(
			contentEl,
			(element) =>
				element.tagName === 'button' &&
				element.className.includes('emend-chat-quick-action'),
		);
		expect(quickActions.every((button) => button.disabled)).toBe(true);
	});

	it('clears an A → B → A restored draft during and after its submission', async () => {
		let activePath = 'A.md';
		const response = deferred<{ content: string; reasoning: string }>();
		const additionalNotesStore = new AdditionalNotesStore();
		const requestChatCompletion = vi.fn(
			(_submission: { additionalNotePaths: readonly string[] }) => response.promise,
		);
		const contentEl = new FakeElement();
		const context = {
			app: {},
			contentEl,
			plugin: {
				getActiveNotePath: () => activePath,
				getActiveNoteLabel: () => activePath,
				hasUsableSelection: () => false,
				captureChatContext: () => ({ file: { path: activePath } }),
				conversationStore: {
					loadConversation: vi.fn(async () => loadedConversation([])),
				},
				additionalNotesStore,
				requestChatCompletion,
				settings: {
					activeProvider: 'custom',
					providers: {
					custom: {
						name: 'Local',
						model: 'Test model',
						contextWindowTokens: null,
						outputReserveTokens: null,
						contextCapacityInvalid: false,
					},
				},
				},
			},
			notePath: null as string | null,
			conversationGeneration: 0,
			messages: [] as ChatMessage[],
			selectedMode: 'ask' as Mode,
			isThreadLoading: false,
			isSending: false,
			activeController: null,
			closed: false,
			inputEl: null as FakeElement | null,
			drafts: new Map<string, Map<string, string>>(),
			additionalNotesControl: null,
			pendingMessages: new Set<ChatMessage>(),
			messageBodyEls: new Map<string, HTMLElement>(),
			activeModelEl: null,
			cancelPendingRender: vi.fn(),
			persistMessages: vi.fn(async () => undefined),
			scheduleMessageRender: vi.fn(),
		};
		Object.setPrototypeOf(context, EmendChatView.prototype);
		Object.assign(context, {
			render: () => viewPrototype.render.call(context),
		});

		await viewPrototype.refreshTargetNote.call(context);
		if (!context.inputEl) {
			throw new Error('A composer missing.');
		}
		context.inputEl.value = 'Restore and send';
		activePath = 'B.md';
		await viewPrototype.refreshTargetNote.call(context);
		if (!context.inputEl) {
			throw new Error('B composer missing.');
		}
		context.inputEl.value = 'Keep B draft';
		activePath = 'A.md';
		await viewPrototype.refreshTargetNote.call(context);
		expect(context.inputEl?.value).toBe('Restore and send');

		const submission = viewPrototype.submitPrompt.call(context);

		await vi.waitFor(() => expect(requestChatCompletion).toHaveBeenCalledOnce());
		expect(context.isSending).toBe(true);
		expect(context.inputEl?.disabled).toBe(true);
		expect(context.inputEl?.value).toBe('');
		expect(Array.from(context.drafts.get('B.md')?.values() ?? [])).toEqual(['Keep B draft']);
		response.resolve({ content: 'Answer', reasoning: '' });
		await submission;
		expect(context.isSending).toBe(false);
		expect(context.inputEl?.disabled).toBe(false);
		expect(context.inputEl?.value).toBe('');
		expect(Array.from(context.drafts.get('B.md')?.values() ?? [])).toEqual(['Keep B draft']);
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
				additionalNotesStore: new AdditionalNotesStore(),
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

describe('EmendChatView presentation', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('uses the Emend display name', () => {
		expect(viewPrototype.getDisplayText.call({})).toBe('Emend');
	});

	it('shows loading content immediately without waiting for Markdown rendering', () => {
		const pendingRender = deferred<void>();
		const render = vi.spyOn(MarkdownRenderer, 'render').mockReturnValue(pendingRender.promise);
		const body = new FakeElement();
		Object.assign(body, {
			empty: vi.fn(() => {
				body.children.length = 0;
				body.textContent = '';
			}),
			ownerDocument: {
				createElement: () => new FakeElement(),
			},
		});
		const context = {
			closed: false,
			messageBodyEls: new Map<string, HTMLElement>([
				['streaming', body as unknown as HTMLElement],
			]),
		};

		viewPrototype.renderMessageBody.call(context, {
			...message('streaming', 'Note.md'),
			content: 'First streamed chunk',
			status: 'loading',
		});

		expect(
			body.children.map((child) => child.textContent).join(''),
		).toContain('First streamed chunk');
		expect(render).not.toHaveBeenCalled();
	});
});

class FakeElement {
	readonly children: FakeElement[] = [];
	readonly attributes: Record<string, string> = {};
	readonly ownerDocument = {
		createElement: () => new FakeElement(),
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
	};
	readonly style: Record<string, string> = {};
	className = '';
	textContent = '';
	title = '';
	disabled = false;
	value = '';
	open = false;
	hidden = false;
	scrollTop = 0;
	scrollHeight = 0;
	clientHeight = 0;
	isConnected = true;
	removed = false;

	constructor(readonly tagName = 'div') {}

	createDiv(options?: string | { cls?: string; text?: string }) {
		return this.append('div', options);
	}

	createSpan(options?: string | { cls?: string; text?: string }) {
		return this.append('span', options);
	}

	createEl(
		tagName: string,
		options?: {
			cls?: string;
			text?: string;
			attr?: Record<string, string>;
		},
	) {
		return this.append(tagName, options);
	}

	addClass(className: string) {
		this.className = `${this.className} ${className}`.trim();
	}

	querySelector() {
		return this.children[0] ?? null;
	}

	getBoundingClientRect() {
		return { top: 0 };
	}

	replaceWith(replacement: FakeElement) {
		this.replacement = replacement;
	}

	replacement?: FakeElement;

	private readonly listeners = new Map<string, Array<() => void>>();

	addEventListener(type: string, listener: () => void) {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	dispatch(type: string) {
		for (const listener of this.listeners.get(type) ?? []) {
			listener();
		}
	}

	empty() {
		this.children.length = 0;
		this.textContent = '';
	}

	remove() {
		this.removed = true;
	}

	private append(
		tagName: string,
		options?: string | {
			cls?: string;
			text?: string;
			attr?: Record<string, string>;
		},
	) {
		const child = new FakeElement(tagName);
		if (typeof options === 'string') {
			child.className = options;
		} else {
			child.className = options?.cls ?? '';
			child.textContent = options?.text ?? '';
			Object.assign(child.attributes, options?.attr);
			if (tagName === 'option') {
				child.value = options?.attr?.value ?? child.textContent;
			}
		}
		this.children.push(child);
		return child;
	}
}

function findElements(
	root: FakeElement,
	predicate: (element: FakeElement) => boolean,
): FakeElement[] {
	return [
		...(predicate(root) ? [root] : []),
		...root.children.flatMap((child) => findElements(child, predicate)),
	];
}

function textOf(root: FakeElement): string {
	return [root.textContent, ...root.children.map(textOf)].join(' ');
}

function findUsageFooter(container: FakeElement): FakeElement | undefined {
	if (container.className.includes('emend-chat-message-usage')) {
		return container;
	}
	for (const child of container.children) {
		const match = findUsageFooter(child);
		if (match) {
			return match;
		}
	}
	return undefined;
}

function renderForFooter(message: ChatMessage) {
	const container = new FakeElement();
	const context = {
		messageBodyEls: new Map<string, HTMLElement>(),
		renderMessageBody: vi.fn(),
		closed: false,
	};
	viewPrototype.renderMessage.call(
		context,
		container as unknown as HTMLElement,
		message,
	);
	return container;
}

describe('EmendChatView persisted mode compatibility', () => {
	it.each([
		['discuss', 'Discuss'],
		['brainstorm', 'Brainstorm'],
	] as const)('renders the original badge for a persisted %s message', (mode, label) => {
		const container = renderForFooter({ ...message(mode, 'Note.md'), mode });

		const badges = findElements(
			container,
			(element) => element.className.split(' ').includes('emend-chat-mode-badge'),
		);
		expect(badges.map((badge) => badge.textContent)).toEqual([label]);
	});
});

describe('EmendChatView token usage footer', () => {
	it('shows provider total, prompt, and completion usage on completed answers', () => {
		const container = renderForFooter({
			...message('answer', 'Note.md'),
			usage: {
				promptTokens: 12,
				completionTokens: 5,
				totalTokens: 17,
				source: 'provider',
			},
		});

		expect(findUsageFooter(container)?.textContent).toBe(
			'Provider usage · 17 total · 12 prompt · 5 completion',
		);
	});

	it('clearly labels estimated usage on concise Edit confirmations', () => {
		const container = renderForFooter({
			...message('Edit applied — 1 changes tracked. Review in Track Changes.', 'Note.md'),
			mode: 'edit',
			usage: {
				promptTokens: 20,
				completionTokens: 8,
				totalTokens: 28,
				source: 'estimated',
			},
		});

		expect(findUsageFooter(container)?.textContent).toBe(
			'Estimated usage · 28 total · 20 prompt · 8 completion',
		);
	});

	it.each(['loading', 'error', 'stopped'] as const)(
		'does not show usage for %s messages',
		(status) => {
			const container = renderForFooter({
				...message(status, 'Note.md'),
				status,
				usage: {
					promptTokens: 1,
					completionTokens: 1,
					totalTokens: 2,
					source: 'estimated',
				},
			});

			expect(findUsageFooter(container)).toBeUndefined();
		},
	);

	it('does not show usage on user messages', () => {
		const container = renderForFooter({
			...message('question', 'Note.md'),
			role: 'user',
			usage: {
				promptTokens: 1,
				completionTokens: 1,
				totalTokens: 2,
				source: 'estimated',
			},
		});

		expect(findUsageFooter(container)).toBeUndefined();
	});
});


describe('EmendChatView web research', () => {
	it('captures Auto options, activity, user badge metadata, and returned sources', async () => {
		const requestChatCompletion = vi.fn(async (submission: {
			webSearch?: { onActivity(activity: { status: string; label: string }): void };
			callbacks: { onContent(text: string): void };
		}) => {
			submission.webSearch?.onActivity({ status: 'pending', label: 'Searching: Emend' });
			submission.callbacks.onContent('Answer [S1]');
			return {
				content: 'Answer [S1]',
				reasoning: '',
				sources: [{ id: 'S1', title: 'Actual source', url: 'https://example.test/source', snippet: 'Evidence' }],
				activities: [
					{ type: 'search' as const, target: 'Emend', status: 'completed' as const },
					{ type: 'fetch' as const, target: 'https://example.test/unreadable', status: 'failed' as const },
				],
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
			};
		});
		const context = {
			inputEl: { value: 'Research' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode: 'auto' as const,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 6, maxWebContentCharactersPerCall: 12345 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(async () => undefined),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			webReviewModal: null,
		};

		await viewPrototype.submitPrompt.call(context);

		const submission = requestChatCompletion.mock.calls[0]?.[0];
		expect(submission).toMatchObject({
			webSearch: { mode: 'auto', maxToolCalls: 6, maxContentCharactersPerCall: 12345 },
		});
		expect(context.messages[0]?.webSearchMode).toBe('auto');
		expect(context.messages[1]?.webSources).toEqual([
			{ id: 'S1', title: 'Actual source', url: 'https://example.test/source', snippet: 'Evidence' },
		]);
		expect(context.messages[1]?.webActivity).toBe('Searching: Emend');
		expect(context.messages[1]?.webActivities).toEqual([
			{ type: 'search', target: 'Emend', status: 'completed' },
			{ type: 'fetch', target: 'https://example.test/unreadable', status: 'failed' },
		]);
		expect(context.messages[1]?.content).toContain(
			'Emend could not read 1 requested page. The answer may be incomplete.',
		);
		expect(context.messages[1]?.content).not.toContain('Emend could not extract information');
	});

	it.each([
		{
			failedExtractions: 1,
			activities: [{
				type: 'fetch' as const,
				target: 'https://example.test/extraction-failed',
				status: 'failed' as const,
				failureKind: 'extraction' as const,
			}],
			unreadWarning: '',
		},
		{
			failedExtractions: 2,
			activities: [
				{ type: 'fetch' as const, target: 'https://example.test/unread', status: 'failed' as const },
				{
					type: 'fetch' as const,
					target: 'https://example.test/extraction-failed',
					status: 'failed' as const,
					failureKind: 'extraction' as const,
				},
			],
			unreadWarning: 'Emend could not read 1 requested page. The answer may be incomplete.\n\n',
		},
	])('appends and persists one exact extraction warning for $failedExtractions failures', async ({ failedExtractions, activities, unreadWarning }) => {
		const warning = `Emend could not extract information from ${failedExtractions} web ${failedExtractions === 1 ? 'query' : 'queries'}. The answer may be incomplete.`;
		const requestChatCompletion = vi.fn(async (submission: {
			callbacks: { onContent(text: string): void };
		}) => {
			submission.callbacks.onContent('Answer from extracted evidence');
			return {
				content: 'Answer from extracted evidence',
				reasoning: '',
				failedExtractions,
				activities,
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
			};
		});
		const persistMessages = vi.fn(async (_notePath: string, _messages: ChatMessage[]) => undefined);
		const context = {
			inputEl: { value: 'Research' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode: 'auto' as const,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 20 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages,
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			webReviewModal: null,
		};

		await viewPrototype.submitPrompt.call(context);

		const expectedContent = `Answer from extracted evidence\n\n${unreadWarning}${warning}`;
		expect(context.messages[1]?.status).toBe('ready');
		expect(context.messages[1]?.content).toBe(expectedContent);
		expect(context.messages[1]?.content.split(warning)).toHaveLength(2);
		expect(context.messages[1]?.content).not.toContain('40,000-character content budget');
		const finalSave = persistMessages.mock.calls.at(-1)?.[1];
		expect(finalSave?.[1]?.content).toBe(expectedContent);
		expect(finalSave?.[1]?.content.split(warning)).toHaveLength(2);
	});

	it.each([1, 2])('appends and persists one exact skipped-call warning alongside other warnings for %s skips', async (skippedWebCalls) => {
		const skippedWarning = skippedWebCalls === 1
			? 'Web retrieval reached the 20-call limit. 1 proposed call was skipped; the answer may be incomplete.'
			: 'Web retrieval reached the 20-call limit. 2 proposed calls were skipped; the answer may be incomplete.';
		const requestChatCompletion = vi.fn(async (submission: {
			callbacks: { onContent(text: string): void };
		}) => {
			submission.callbacks.onContent('Answer from available evidence');
			return {
				content: 'Answer from available evidence',
				reasoning: '',
				failedExtractions: 1,
				skippedWebCalls,
				activities: [
					{ type: 'fetch' as const, target: 'https://example.test/unread', status: 'failed' as const },
					{
						type: 'fetch' as const,
						target: 'https://example.test/extraction-failed',
						status: 'failed' as const,
						failureKind: 'extraction' as const,
					},
				],
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
			};
		});
		const persistMessages = vi.fn(async (_notePath: string, _messages: ChatMessage[]) => undefined);
		const context = {
			inputEl: { value: 'Research' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode: 'auto' as const,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 20 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages,
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			webReviewModal: null,
		};

		await viewPrototype.submitPrompt.call(context);

		const expectedContent = [
			'Answer from available evidence',
			'Emend could not read 1 requested page. The answer may be incomplete.',
			'Emend could not extract information from 1 web query. The answer may be incomplete.',
			skippedWarning,
		].join('\n\n');
		expect(context.messages[1]?.status).toBe('ready');
		expect(context.messages[1]?.content).toBe(expectedContent);
		expect(context.messages[1]?.content.split(skippedWarning)).toHaveLength(2);
		const finalSave = persistMessages.mock.calls.at(-1)?.[1];
		expect(finalSave?.[1]?.content).toBe(expectedContent);
		expect(finalSave?.[1]?.content.split(skippedWarning)).toHaveLength(2);
	});

	it.each([1, 2])('appends and persists one exact search warning for %s failed searches', async (failedSearches) => {
		const warning = `Emend could not complete ${failedSearches} web ${failedSearches === 1 ? 'search' : 'searches'}. The answer may be incomplete.`;
		const requestChatCompletion = vi.fn(async (submission: {
			callbacks: { onContent(text: string): void };
		}) => {
			submission.callbacks.onContent('Answer from available evidence');
			return {
				content: 'Answer from available evidence',
				reasoning: '',
				failedExtractions: 0,
				failedSearches,
				skippedWebCalls: 0,
				activities: [{
					type: 'search' as const,
					target: 'failed query',
					status: 'failed' as const,
					failureReason: 'network' as const,
				}],
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
			};
		});
		const persistMessages = vi.fn(async (_notePath: string, _messages: ChatMessage[]) => undefined);
		const context = {
			inputEl: { value: 'Research' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode: 'auto' as const,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 20 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages,
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			webReviewModal: null,
		};

		await viewPrototype.submitPrompt.call(context);

		const expectedContent = `Answer from available evidence\n\n${warning}`;
		expect(context.messages[1]?.status).toBe('ready');
		expect(context.messages[1]?.content).toBe(expectedContent);
		expect(context.messages[1]?.content.split(warning)).toHaveLength(2);
		const finalSave = persistMessages.mock.calls.at(-1)?.[1];
		expect(finalSave?.[1]?.content).toBe(expectedContent);
		expect(finalSave?.[1]?.content.split(warning)).toHaveLength(2);
	});

	it('appends and persists one exact omission warning between the search and skipped-call warnings', async () => {
		const omissionWarning = 'Emend omitted some extracted evidence to fit the per-call output cap. The answer may be incomplete.';
		const searchWarning = 'Emend could not complete 1 web search. The answer may be incomplete.';
		const skippedWarning = 'Web retrieval reached the 20-call limit. 1 proposed call was skipped; the answer may be incomplete.';
		const requestChatCompletion = vi.fn(async (submission: {
			callbacks: { onContent(text: string): void };
		}) => {
			submission.callbacks.onContent('Answer from capped evidence');
			return {
				content: 'Answer from capped evidence',
				reasoning: '',
				failedExtractions: 0,
				failedSearches: 1,
				skippedWebCalls: 1,
				omittedEvidence: true,
				activities: [],
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
			};
		});
		const persistMessages = vi.fn(async (_notePath: string, _messages: ChatMessage[]) => undefined);
		const context = {
			inputEl: { value: 'Research' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode: 'auto' as const,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 20 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages,
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			webReviewModal: null,
		};

		await viewPrototype.submitPrompt.call(context);

		const expectedContent = [
			'Answer from capped evidence',
			searchWarning,
			omissionWarning,
			skippedWarning,
		].join('\n\n');
		expect(context.messages[1]?.status).toBe('ready');
		expect(context.messages[1]?.content).toBe(expectedContent);
		expect(context.messages[1]?.content.split(omissionWarning)).toHaveLength(2);
		const finalSave = persistMessages.mock.calls.at(-1)?.[1];
		expect(finalSave?.[1]?.content).toBe(expectedContent);
		expect(finalSave?.[1]?.content.split(omissionWarning)).toHaveLength(2);
	});

	it.each([
		{ omittedEvidence: false, webSearchMode: 'auto' as const },
		{ omittedEvidence: undefined, webSearchMode: 'auto' as const },
		{ omittedEvidence: false, webSearchMode: 'off' as const },
	])('does not warn about omitted evidence when nothing was omitted ($omittedEvidence, $webSearchMode)', async ({ omittedEvidence, webSearchMode }) => {
		const requestChatCompletion = vi.fn(async (submission: {
			callbacks: { onContent(text: string): void };
		}) => {
			submission.callbacks.onContent('Answer within the cap');
			return {
				content: 'Answer within the cap',
				reasoning: '',
				failedExtractions: 0,
				failedSearches: 0,
				skippedWebCalls: 0,
				omittedEvidence,
				activities: [],
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
			};
		});
		const context = {
			inputEl: { value: 'Research' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 20 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(async () => undefined),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			webReviewModal: null,
		};

		await viewPrototype.submitPrompt.call(context);

		expect(context.messages[1]?.content).toBe('Answer within the cap');
		expect(context.messages[1]?.content).not.toContain('Emend omitted some extracted evidence');
	});

	it('orders unread-page, extraction, search, omission, and skipped-call warnings', async () => {
		const requestChatCompletion = vi.fn(async (submission: {
			callbacks: { onContent(text: string): void };
		}) => {
			submission.callbacks.onContent('Answer from available evidence');
			return {
				content: 'Answer from available evidence',
				reasoning: '',
				failedExtractions: 1,
				failedSearches: 2,
				skippedWebCalls: 1,
				omittedEvidence: true,
				activities: [
					{
						type: 'fetch' as const,
						target: 'https://example.test/unread',
						status: 'failed' as const,
						failureReason: 'network' as const,
					},
					{
						type: 'fetch' as const,
						target: 'https://example.test/extraction-failed',
						status: 'failed' as const,
						failureKind: 'extraction' as const,
						failureReason: 'reader' as const,
					},
				],
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
			};
		});
		const persistMessages = vi.fn(async (_notePath: string, _messages: ChatMessage[]) => undefined);
		const context = {
			inputEl: { value: 'Research' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode: 'auto' as const,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 20 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages,
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			webReviewModal: null,
		};

		await viewPrototype.submitPrompt.call(context);

		const expectedContent = [
			'Answer from available evidence',
			'Emend could not read 1 requested page. The answer may be incomplete.',
			'Emend could not extract information from 1 web query. The answer may be incomplete.',
			'Emend could not complete 2 web searches. The answer may be incomplete.',
			'Emend omitted some extracted evidence to fit the per-call output cap. The answer may be incomplete.',
			'Web retrieval reached the 20-call limit. 1 proposed call was skipped; the answer may be incomplete.',
		].join('\n\n');
		expect(context.messages[1]?.status).toBe('ready');
		expect(context.messages[1]?.content).toBe(expectedContent);
		const finalSave = persistMessages.mock.calls.at(-1)?.[1];
		expect(finalSave?.[1]?.content).toBe(expectedContent);
	});

	it.each([
		{ failedSearches: 0, webSearchMode: 'auto' as const },
		{ failedSearches: undefined, webSearchMode: 'auto' as const },
		{ failedSearches: 0, webSearchMode: 'off' as const },
	])('does not warn without failed searches ($failedSearches, $webSearchMode)', async ({ failedSearches, webSearchMode }) => {
		const requestChatCompletion = vi.fn(async (submission: {
			callbacks: { onContent(text: string): void };
		}) => {
			submission.callbacks.onContent('Answer without failed searches');
			return {
				content: 'Answer without failed searches',
				reasoning: '',
				failedExtractions: 0,
				failedSearches,
				skippedWebCalls: 0,
				activities: [{ type: 'search' as const, target: 'completed query', status: 'completed' as const }],
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
			};
		});
		const context = {
			inputEl: { value: 'Research' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 20 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(async () => undefined),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			webReviewModal: null,
		};

		await viewPrototype.submitPrompt.call(context);

		expect(context.messages[1]?.status).toBe('ready');
		expect(context.messages[1]?.content).toBe('Answer without failed searches');
		expect(context.messages[1]?.content).not.toContain('Emend could not complete');
	});

	it('does not add a skipped-call warning at the exact limit', async () => {
		const requestChatCompletion = vi.fn(async (submission: {
			callbacks: { onContent(text: string): void };
		}) => {
			submission.callbacks.onContent('Answer at the exact limit');
			return {
				content: 'Answer at the exact limit',
				reasoning: '',
				failedExtractions: 0,
				skippedWebCalls: 0,
				activities: [],
				usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
			};
		});
		const context = {
			inputEl: { value: 'Research' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode: 'auto' as const,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 20 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(async () => undefined),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
			webReviewModal: null,
		};

		await viewPrototype.submitPrompt.call(context);

		expect(context.messages[1]?.content).toBe('Answer at the exact limit');
		expect(context.messages[1]?.content).not.toContain('Web retrieval reached');
	});

	it('does not submit web options in Edit even when Auto is selected', async () => {
		const requestChatCompletion = vi.fn(async (_submission: unknown) => ({
			applied: false,
			usage: { promptTokens: 3, completionTokens: 1, totalTokens: 4, source: 'provider' as const },
		}));
		const context = {
			inputEl: { value: 'Edit note' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'edit' as const,
			webSearchMode: 'auto' as const,
			messages: [] as ChatMessage[],
			plugin: {
				settings: { maxWebToolCalls: 6 },
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(async () => undefined),
			render: vi.fn(),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
		};

		await viewPrototype.submitPrompt.call(context);

		expect(requestChatCompletion.mock.calls[0]?.[0]).not.toHaveProperty('webSearch');
		expect(context.messages[0]?.webSearchMode).toBeUndefined();
	});

	it('renders only retrieved source links and the Review/Auto badge', () => {
		const container = renderForFooter({
			...message('answer', 'Note.md'),
			webSources: [{ id: 'S1', title: 'Actual source', url: 'https://example.test/source', snippet: 'Evidence' }],
		});
		const user = renderForFooter({
			...message('question', 'Note.md'),
			role: 'user',
			webSearchMode: 'review',
		});

		const anchors = findElements(container, (element) => element.tagName === 'a');
		expect(anchors).toHaveLength(1);
		expect(anchors[0]?.attributes.href).toBe('https://example.test/source');
		expect(textOf(container)).toContain('Evidence');
		expect(textOf(user)).toContain('Web: Review');
	});

	it('copies actual citations without treating model-written links as retrieved sources', () => {
		const copied = formatChatMessageForCopy({
			...message('answer', 'Note.md'),
			content: 'Answer [S1] with [unverified](https://unverified.test)',
			webSources: [{ id: 'S1', title: 'Actual source', url: 'https://example.test/source' }],
		});

		expect(copied).toContain('https://example.test/source');
		expect(copied).toContain('https://unverified.test');
		expect(copied.match(/### Sources/g)).toHaveLength(1);
	});
});


describe('EmendChatView web activity review', () => {
	it('renders a closed folded activity list with completed, failed, and skipped outcomes', () => {
		const container = renderForFooter({
			...message('answer', 'Note.md'),
			webActivities: [
				{ type: 'search', target: 'activity query', status: 'completed' },
				{ type: 'fetch', target: 'https://example.test/failed', status: 'failed' },
				{ type: 'fetch', target: 'https://example.test/skipped', status: 'skipped' },
			],
		});

		const details = findElements(container, (element) =>
			element.tagName === 'details' && element.className === 'emend-chat-web-activity'
		)[0];
		expect(details).toBeDefined();
		expect(details?.open).toBe(false);
		expect(textOf(details as FakeElement)).toContain('Web activity (3)');
		expect(textOf(details as FakeElement)).toContain('Search · Completed · activity query');
		expect(textOf(details as FakeElement)).toContain('Fetch · Failed · https://example.test/failed');
		expect(textOf(details as FakeElement)).toContain('Fetch · Skipped · https://example.test/skipped');
	});

	it.each([
		[
			'network',
			{ type: 'fetch' as const, target: 'https://example.test/page', status: 'failed' as const, failureReason: 'network' as const },
			'Fetch · Failed (network) · https://example.test/page',
		],
		[
			'http',
			{ type: 'search' as const, target: 'example query', status: 'failed' as const, failureReason: 'http' as const },
			'Search · Failed (HTTP) · example query',
		],
		[
			'empty',
			{ type: 'fetch' as const, target: 'https://example.test/blank', status: 'failed' as const, failureReason: 'empty' as const },
			'Fetch · Failed (empty page) · https://example.test/blank',
		],
		[
			'reader',
			{ type: 'fetch' as const, target: 'https://example.test/page', status: 'failed' as const, failureReason: 'reader' as const },
			'Fetch · Failed (reader) · https://example.test/page',
		],
		[
			'http with status',
			{
				type: 'fetch' as const,
				target: 'https://example.test/forbidden',
				status: 'failed' as const,
				failureReason: 'http' as const,
				failureStatus: 403,
			},
			'Fetch · Failed (HTTP 403) · https://example.test/forbidden',
		],
		[
			'reader format',
			{
				type: 'fetch' as const,
				target: 'https://example.test/format',
				status: 'failed' as const,
				failureReason: 'reader' as const,
				readerFailureKind: 'format' as const,
			},
			'Fetch · Failed (reader format) · https://example.test/format',
		],
		[
			'reader provider',
			{
				type: 'search' as const,
				target: 'service query',
				status: 'failed' as const,
				failureReason: 'reader' as const,
				readerFailureKind: 'provider' as const,
			},
			'Search · Failed (reader service) · service query',
		],
		[
			'reader limit',
			{
				type: 'fetch' as const,
				target: 'https://example.test/limit',
				status: 'failed' as const,
				failureReason: 'reader' as const,
				readerFailureKind: 'limit' as const,
			},
			'Fetch · Failed (reader limit) · https://example.test/limit',
		],
		[
			'http after retry',
			{
				type: 'fetch' as const,
				target: 'https://example.test/forbidden',
				status: 'failed' as const,
				failureReason: 'http' as const,
				failureStatus: 403,
				attempts: 2,
			},
			'Fetch · Failed (HTTP 403, 2 attempts) · https://example.test/forbidden',
		],
		[
			'network with one attempt',
			{
				type: 'fetch' as const,
				target: 'https://example.test/blocked',
				status: 'failed' as const,
				failureReason: 'network' as const,
				attempts: 1,
			},
			'Fetch · Failed (network) · https://example.test/blocked',
		],
		[
			'empty page after retry',
			{
				type: 'fetch' as const,
				target: 'https://example.test/blank',
				status: 'failed' as const,
				failureReason: 'empty' as const,
				attempts: 2,
			},
			'Fetch · Failed (empty page, 2 attempts) · https://example.test/blank',
		],
	])('labels failed %s activities with their failure reason', (_reason, activity, expected) => {
		const container = renderForFooter({
			...message('answer', 'Note.md'),
			webActivities: [activity],
		});

		const details = findElements(container, (element) =>
			element.tagName === 'details' && element.className === 'emend-chat-web-activity'
		)[0];
		expect(details).toBeDefined();
		expect(textOf(details as FakeElement)).toContain(expected);
	});

	it('leaves completed and skipped rows unchanged and ignores unknown reasons', () => {
		const container = renderForFooter({
			...message('answer', 'Note.md'),
			webActivities: [
				{
					type: 'search',
					target: 'done query',
					status: 'completed',
					failureReason: 'network',
				},
				{
					type: 'fetch',
					target: 'https://example.test/skipped',
					status: 'skipped',
					failureReason: 'reader',
				},
				{
					type: 'fetch',
					target: 'https://example.test/unknown',
					status: 'failed',
					failureReason: 'mystery' as unknown as WebActivityRecord['failureReason'],
				},
				{
					type: 'fetch',
					target: 'https://example.test/completed-reader',
					status: 'completed',
					readerFailureKind: 'limit',
				},
			],
		});

		const details = findElements(container, (element) =>
			element.tagName === 'details' && element.className === 'emend-chat-web-activity'
		)[0];
		expect(details).toBeDefined();
		const rendered = textOf(details as FakeElement);
		expect(rendered).toContain('Search · Completed · done query');
		expect(rendered).toContain('Fetch · Skipped · https://example.test/skipped');
		expect(rendered).toContain('Fetch · Failed · https://example.test/unknown');
		expect(rendered).toContain('Fetch · Completed · https://example.test/completed-reader');
		expect(rendered).not.toContain('mystery');
		expect(rendered).not.toContain('(undefined)');
		expect(rendered).not.toContain('reader limit');
		expect(rendered).not.toContain('HTTP undefined');
	});
});


describe('EmendChatView latest-message scrolling', () => {
	it('aligns the scroller to its full height when following the latest response', () => {
		const messagesEl = { scrollHeight: 1200, scrollTop: 0 };
		viewPrototype.scrollMessagesToBottom.call({ closed: false, messagesEl });
		expect(messagesEl.scrollTop).toBe(1200);
	});

	it('restores the previous position when the reader was not following latest', () => {
		const messagesEl = { scrollHeight: 1200, scrollTop: 0 };
		viewPrototype.restoreMessageScroll.call({ messagesEl }, 275, false);
		expect(messagesEl.scrollTop).toBe(275);

		const scrollMessagesToBottom = vi.fn();
		viewPrototype.restoreMessageScroll.call({ messagesEl, scrollMessagesToBottom }, 275, true);
		expect(scrollMessagesToBottom).toHaveBeenCalledOnce();
	});

	it('scrolls after streamed message bodies only while following latest', () => {
		const pendingMessage = { ...message('streaming', 'Note.md'), status: 'loading' as const };
		const scrollMessagesToBottomIfFollowing = vi.fn();
		const context = {
			closed: false,
			pendingMessages: new Set([pendingMessage]),
			pendingRenderFrame: null,
			contentEl: {
				ownerDocument: {
					defaultView: {
						requestAnimationFrame: (callback: () => void) => {
							callback();
							return 1;
						},
					},
				},
			},
			renderMessageBody: vi.fn(),
			scrollMessagesToBottomIfFollowing,
		};

		viewPrototype.scheduleMessageRender.call(context, pendingMessage);

		expect(context.renderMessageBody).toHaveBeenCalledWith(pendingMessage);
		expect(scrollMessagesToBottomIfFollowing).toHaveBeenCalledOnce();
	});

	it('reapplies bottom alignment after asynchronous Markdown layout', async () => {
		vi.spyOn(MarkdownRenderer, 'render').mockResolvedValue(undefined);
		const body = new FakeElement();
		Object.assign(body, {
			ownerDocument: { createElement: () => new FakeElement() },
		});
		const scrollMessagesToBottomIfFollowing = vi.fn();
		const context = {
			closed: false,
			messageBodyEls: new Map<string, HTMLElement>([['answer', body as unknown as HTMLElement]]),
			scrollMessagesToBottomIfFollowing,
			settleMarkdownRender: (generation: number) =>
				viewPrototype.settleMarkdownRender.call(context, generation),
		};

		viewPrototype.renderMessageBody.call(context, message('answer', 'Note.md'));
		await vi.waitFor(() => expect(scrollMessagesToBottomIfFollowing).toHaveBeenCalledOnce());
	});

	it('sets the completed response target after following the loading render at bottom', async () => {
		const followStates: boolean[] = [];
		const renderTargetStates: Array<string | null> = [];
		const context = {
			inputEl: { value: 'Question' },
			isSending: false,
			isThreadLoading: false,
			selectedMode: 'ask' as const,
			webSearchMode: 'off' as const,
			messages: [] as ChatMessage[],
			followLatestMessages: false,
			responseStartMessageId: 'previous-response' as string | null,
			plugin: {
				captureChatContext: () => ({ file: { path: 'Note.md' } }),
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion: vi.fn(async ({ callbacks }: {
					callbacks: { onContent(text: string): void };
				}) => {
					callbacks.onContent('Answer');
					return { content: 'Answer', reasoning: '' };
				}),
			},
			toProviderHistory: () => [],
			persistMessages: vi.fn(() => {
				saveCount++;
				return saveCount === 1 ? Promise.resolve() : persistence.promise;
			}),
			render: vi.fn(() => {
				followStates.push(context.followLatestMessages);
				renderTargetStates.push(context.responseStartMessageId);
			}),
			scheduleMessageRender: vi.fn(),
			closed: false,
			activeController: null,
		};
		const persistence = deferred<void>();
		let saveCount = 0;

		const submission = viewPrototype.submitPrompt.call(context);
		await vi.waitFor(() => expect(saveCount).toBe(2));
		expect(context.responseStartMessageId).toBeNull();
		expect(context.followLatestMessages).toBe(true);
		persistence.resolve();
		await submission;

		expect(context.responseStartMessageId).toBe(context.messages[1]?.id);
		expect(followStates).toEqual([true, false]);
		expect(renderTargetStates).toEqual([null, context.messages[1]?.id]);
	});

	it('aligns the targeted response after Markdown layouts and clears the target', () => {
		const messagesEl = renderForFooter(message('answer', 'Note.md'));
		const responseEl = messagesEl.children[0];
		if (!responseEl) {
			throw new Error('Response element missing.');
		}
		Object.assign(messagesEl, {
			scrollTop: 40,
			getBoundingClientRect: () => ({ top: 100 }),
			querySelector: () => findElements(
				messagesEl,
				(element) => element.attributes['data-message-id'] === 'answer',
			)[0] ?? null,
		});
		Object.assign(responseEl, {
			getBoundingClientRect: () => ({ top: 260 }),
		});
		const context = {
			closed: false,
			renderGeneration: 4,
			pendingMarkdownRenders: 0,
			pendingScrollRestore: { previousScrollTop: 275, wasFollowing: false },
			responseStartMessageId: 'answer' as string | null,
			followLatestMessages: false,
			messagesEl,
			restoreMessageScroll: (previousScrollTop: number, wasFollowing: boolean) =>
				viewPrototype.restoreMessageScroll.call(context, previousScrollTop, wasFollowing),
		};

		viewPrototype.settleMarkdownRender.call(context, 4);

		expect(messagesEl.scrollTop).toBe(200);
		expect(context.responseStartMessageId).toBeNull();
	});
});


describe('EmendChatView completion relayout and unread pages', () => {
	it('restores upward-reading position only after all current Markdown layouts settle', async () => {
		const firstRender = deferred<void>();
		const secondRender = deferred<void>();
		vi.spyOn(MarkdownRenderer, 'render')
			.mockImplementationOnce(() => firstRender.promise)
			.mockImplementationOnce(() => secondRender.promise);
		const messagesEl = new FakeElement();
		messagesEl.scrollHeight = 1200;
		const context = {
			closed: false,
			renderGeneration: 1,
			pendingMarkdownRenders: 0,
			pendingScrollRestore: { previousScrollTop: 275, wasFollowing: false },
			messagesEl,
			messageBodyEls: new Map<string, HTMLElement>(),
			scrollMessagesToBottomIfFollowing: vi.fn(),
			settleMarkdownRender: (generation: number) =>
				viewPrototype.settleMarkdownRender.call(context, generation),
			restoreMessageScroll: (previousScrollTop: number, wasFollowing: boolean) =>
				viewPrototype.restoreMessageScroll.call(context, previousScrollTop, wasFollowing),
		};
		for (const id of ['first', 'second']) {
			const body = new FakeElement();
			Object.assign(body, {
				ownerDocument: { createElement: () => new FakeElement() },
			});
			context.messageBodyEls.set(id, body as unknown as HTMLElement);
		}

		viewPrototype.renderMessageBody.call(context, message('first', 'Note.md'));
		viewPrototype.renderMessageBody.call(context, message('second', 'Note.md'));
		expect(context.pendingMarkdownRenders).toBe(2);

		firstRender.resolve();
		await vi.waitFor(() => expect(context.pendingMarkdownRenders).toBe(1));
		expect(messagesEl.scrollTop).toBe(0);
		secondRender.resolve();
		await vi.waitFor(() => expect(messagesEl.scrollTop).toBe(275));
	});

	it('does not warn about a page that later fetched successfully', () => {
		expect(getUnreadPageCount([
			{ type: 'fetch', target: 'https://example.test/page', status: 'failed' },
			{ type: 'fetch', target: 'https://example.test/page', status: 'completed' },
		])).toBe(0);
		expect(getUnreadPageCount([
			{ type: 'fetch', target: 'https://example.test/other', status: 'failed' },
		])).toBe(1);
	});

	it('excludes extraction failures from lone and mixed unread-page counts', () => {
		const extractionFailure = {
			type: 'fetch' as const,
			target: 'https://example.test/extraction-failed',
			status: 'failed' as const,
			failureKind: 'extraction' as const,
		};
		expect(getUnreadPageCount([extractionFailure])).toBe(0);
		expect(getUnreadPageCount([
			{ type: 'fetch', target: 'https://example.test/unread', status: 'failed' },
			extractionFailure,
		])).toBe(1);
	});

	it('excludes extraction failures that carry a reader reason from unread-page counts', () => {
		expect(getUnreadPageCount([{
			type: 'fetch',
			target: 'https://example.test/extraction-failed',
			status: 'failed',
			failureKind: 'extraction',
			failureReason: 'reader',
		}])).toBe(0);
		expect(getUnreadPageCount([
			{ type: 'fetch', target: 'https://example.test/unread', status: 'failed', failureReason: 'network' },
			{
				type: 'fetch',
				target: 'https://example.test/extraction-failed',
				status: 'failed',
				failureKind: 'extraction',
				failureReason: 'reader',
			},
		])).toBe(1);
	});
});


describe('EmendChatView compact Web disclosure', () => {
	it('keeps the shared disclosure on the Web selector tooltip without requests or a large bottom block', async () => {
		const contentEl = new FakeElement();
		const requestChatCompletion = vi.fn();
		const context = {
			app: {},
			contentEl,
			plugin: {
				getActiveNotePath: () => 'Note.md',
				getActiveNoteLabel: () => 'Note.md',
				hasUsableSelection: () => false,
				conversationStore: {
					loadConversation: vi.fn(async () => loadedConversation([])),
				},
				additionalNotesStore: new AdditionalNotesStore(),
				requestChatCompletion,
				settings: {
					activeProvider: 'deepseek',
					providers: { deepseek: { name: 'DeepSeek', model: 'deepseek-flash' } },
				},
			},
			notePath: null as string | null,
			conversationGeneration: 0,
			messages: [] as ChatMessage[],
			selectedMode: 'ask' as Mode,
			webSearchMode: 'auto' as const,
			isThreadLoading: false,
			isSending: false,
			activeController: null,
			closed: false,
			inputEl: null as FakeElement | null,
			drafts: new Map<string, Map<string, string>>(),
			additionalNotesControl: null,
			pendingMessages: new Set<ChatMessage>(),
			messageBodyEls: new Map<string, HTMLElement>(),
			activeModelEl: null,
			cancelPendingRender: vi.fn(),
		};
		Object.setPrototypeOf(context, EmendChatView.prototype);

		await viewPrototype.refreshTargetNote.call(context);

		const disclosure = findElements(contentEl, (element) =>
			element.className.split(' ').includes('emend-chat-web-disclosure')
		);
		const webSelect = findElements(contentEl, (element) =>
			element.tagName === 'select' && element.attributes['aria-label'] === 'Web search mode'
		)[0];
		expect(disclosure).toHaveLength(0);
		expect(webSelect?.title).toContain('note context');
		expect(webSelect?.title).toContain('stored locally with ready chats');
		expect(webSelect?.title).toContain('Each web call uses an AI extraction reader that receives your current question and extraction goal, may use up to 6 extractor rounds, a verifier, and up to 2 refine rounds, and may incur separate charges. A transient Search or Fetch failure may be retried once. Failed calls also count toward the configured call limit.');
		if (webSelect) {
			webSelect.value = 'review';
			webSelect.dispatch('change');
			webSelect.value = 'auto';
			webSelect.dispatch('change');
		}
		expect(requestChatCompletion).not.toHaveBeenCalled();
	});
});


describe('Emend Web review modal styles', () => {
	it('styles the extraction disclosure as muted smaller text with a modest top margin', () => {
		const rule = getCssRule('.emend-web-review-disclosure');

		expect(rule).toContain('color: var(--text-muted);');
		expect(rule).toContain('font-size: var(--font-ui-smaller);');
		expect(rule).toContain('margin-top: 4px;');
	});
});


describe('EmendChatView render-end response alignment', () => {
	it('keeps the response target until actual Markdown settlement expands the scroller', async () => {
		const markdown = deferred<void>();
		vi.spyOn(MarkdownRenderer, 'render').mockReturnValue(markdown.promise);
		const contentEl = new FakeElement();
		const context = {
			app: {},
			contentEl,
			plugin: {
				getActiveNotePath: () => 'Note.md',
				getActiveNoteLabel: () => 'Note.md',
				hasUsableSelection: () => false,
				conversationStore: {
					loadConversation: vi.fn(async () => {
						context.responseStartMessageId = 'answer';
						context.followLatestMessages = false;
						return loadedConversation([
							makeSession('answer-session', [message('answer', 'Note.md')]),
						]);
					}),
				},
				additionalNotesStore: new AdditionalNotesStore(),
				settings: {
					activeProvider: 'deepseek',
					providers: { deepseek: { name: 'DeepSeek', model: 'deepseek-flash' } },
				},
			},
			notePath: null as string | null,
			conversationGeneration: 0,
			messages: [] as ChatMessage[],
			selectedMode: 'ask' as Mode,
			webSearchMode: 'off' as const,
			responseStartMessageId: null as string | null,
			followLatestMessages: true,
			pendingMarkdownRenders: 0,
			renderGeneration: 0,
			isThreadLoading: false,
			isSending: false,
			activeController: null,
			closed: false,
			inputEl: null as FakeElement | null,
			drafts: new Map<string, Map<string, string>>(),
			additionalNotesControl: null,
			pendingMessages: new Set<ChatMessage>(),
			messageBodyEls: new Map<string, HTMLElement>(),
			activeModelEl: null,
			cancelPendingRender: vi.fn(),
		};
		Object.setPrototypeOf(context, EmendChatView.prototype);

		await viewPrototype.refreshTargetNote.call(context);

		expect(context.pendingMarkdownRenders).toBe(1);
		expect(context.responseStartMessageId).toBe('answer');
		const messagesEl = (context as unknown as { messagesEl: FakeElement }).messagesEl;
		const responseEl = messagesEl.children[0];
		if (!responseEl) throw new Error('Response element missing');
		Object.assign(messagesEl, {
			scrollTop: 40,
			scrollHeight: 4856,
			clientHeight: 197,
			getBoundingClientRect: () => ({ top: 100 }),
			querySelector: () => responseEl,
		});
		Object.assign(responseEl, {
			getBoundingClientRect: () => ({ top: 260 }),
		});

		markdown.resolve();
		await vi.waitFor(() => expect(context.pendingMarkdownRenders).toBe(0));

		expect(messagesEl.scrollTop).toBe(200);
		expect(context.responseStartMessageId).toBeNull();
	});
});

type CapacityFields = Pick<
	ProviderConfig,
	'contextWindowTokens' | 'outputReserveTokens' | 'contextCapacityInvalid'
>;

interface CapacityViewOptions {
	mode?: Mode;
	selectedText?: string;
	sourceText?: string;
	markdown?: string;
	selectionFrom?: number;
	selectionTo?: number;
	capacity?: Partial<CapacityFields>;
	includeNotePath?: boolean;
	historyMessageLimit?: number;
	maxContextCharacters?: number;
}

function capacityProvider(fields: Partial<CapacityFields> = {}): ProviderConfig {
	return {
		name: 'Local',
		baseUrl: 'http://127.0.0.1:8787/v1',
		apiKey: 'dummy-test-key',
		model: 'Test model',
		reasoningEffort: 'low',
		requestUsage: false,
		discoveredModels: [],
		contextWindowTokens: null,
		outputReserveTokens: null,
		contextCapacityInvalid: false,
		...fields,
	};
}

function createCapacityView(options: CapacityViewOptions = {}) {
	const sourceText = options.sourceText ?? 'Alpha beta.';
	const markdown = options.markdown ?? sourceText;
	const selectedText = options.selectedText ?? '';
	const includeNotePath = options.includeNotePath ?? false;
	const file = new TFile();
	file.path = 'Note.md';
	const snapshot: SelectionSnapshot = {
		file,
		fullText: sourceText,
		selectedText: selectedText || 'beta',
		from: options.selectionFrom ?? (selectedText ? sourceText.indexOf(selectedText) : 6),
		to: options.selectionTo ?? (selectedText
			? sourceText.indexOf(selectedText) + selectedText.length
			: 10),
	};
	const provider = capacityProvider(options.capacity);
	const requestContext = {
		file,
		sourceText,
		selection: { from: snapshot.from, to: snapshot.to },
		noteLabel: file.path,
		notePath: includeNotePath
			? formatVaultQualifiedPath('Vault', file.path)
			: undefined,
		markdown,
	};
	const editor = {
		readCurrentText: () => sourceText,
		isTargetCurrent: () => true,
		replaceRange: vi.fn(),
	};
	const contentEl = new FakeElement();
	const read = vi.fn();
	const captureChatContext = vi.fn(() => requestContext);
	const captureSelectionEditTarget = vi.fn(() => ({ snapshot, editor }));
	const additionalNotesStore = new AdditionalNotesStore();
	const requestChatCompletion = vi.fn(async (submission: {
		mode: Mode;
		prompt: string;
		history: ProviderHistoryMessage[];
		additionalNotePaths: readonly string[];
		callbacks?: { onContent?: (text: string) => void };
	}) => {
		submission.callbacks?.onContent?.('Answer');
		return {
			content: 'Answer',
			reasoning: '',
			failedExtractions: 0,
			failedSearches: 0,
			skippedWebCalls: 0,
			omittedEvidence: false,
			usage: {
				promptTokens: 3,
				completionTokens: 1,
				totalTokens: 4,
				source: 'provider' as const,
			},
		};
	});
	const requestSelectionEdit = vi.fn(async () => ({
		applied: false,
		changeCount: 0,
		usage: {
			promptTokens: 3,
			completionTokens: 1,
			totalTokens: 4,
			source: 'provider' as const,
		},
	}));
	const savedSnapshots: ChatMessage[][] = [];
	const context = {
		app: { vault: { getName: () => 'Vault', adapter: { read } } },
		contentEl,
		plugin: {
			getActiveNotePath: () => file.path,
			getActiveNoteLabel: () => file.path,
			hasUsableSelection: () => Boolean(selectedText.trim()),
			captureChatContext,
			captureSelectionEditTarget,
			conversationStore: {
				loadConversation: vi.fn(async () => loadedConversation([])),
			},
			additionalNotesStore,
			requestChatCompletion,
			requestSelectionEdit,
			settings: {
				activeProvider: 'custom',
				providers: { custom: provider },
				defaultMode: 'ask',
				includeNotePathInContext: includeNotePath,
				smartSelectionContext: true,
				maxContextCharacters: options.maxContextCharacters ?? 12000,
				maxWebToolCalls: 8,
				maxWebContentCharactersPerCall: 20000,
				historyMessageLimit: options.historyMessageLimit ?? 0,
			},
		},
		notePath: null as string | null,
		conversationGeneration: 0,
		sessions: [] as ChatSession[],
		activeSessionId: null as string | null,
		activeRequest: null,
		isSessionMutating: false,
		transientSessionIds: new Set<string>(),
		transientSessions: new Map<string, ChatSession>(),
		messages: [] as ChatMessage[],
		selectedMode: options.mode ?? 'ask',
		webSearchMode: 'off' as const,
		isThreadLoading: false,
		isSending: false,
		activeController: null as AbortController | null,
		closed: false,
		inputEl: null as FakeElement | null,
		drafts: new Map<string, Map<string, string>>(),
		additionalNotesControl: null,
		pendingMessages: new Set<ChatMessage>(),
		messageBodyEls: new Map<string, HTMLElement>(),
		activeModelEl: null,
		editTargetChoice: 'auto' as 'auto' | 'full-note' | 'selection',
		displayedEditTarget: 'full-note' as 'full-note' | 'selection',
		editTargetSelectEl: null as FakeElement | null,
		webReviewModal: null,
		pendingRenderFrame: null,
		pendingMarkdownRenders: 0,
		pendingScrollRestore: null,
		responseStartMessageId: null,
		followLatestMessages: true,
		renderGeneration: 0,
		cancelPendingRender: vi.fn(),
		sendButtonEl: null as FakeElement | null,
		quickActionButtons: [] as Array<{ action: { id: string; prompt: string }; button: FakeElement }>,
		quickActionCapacityMessages: new Map<string, string>(),
		capacityDisplay: null,
		capacityRefreshTimer: null as number | null,
		draftCapacityBlocked: false,
		persistMessages: vi.fn(async (_path: string, messages: ChatMessage[]) => {
			savedSnapshots.push(messages.map((message) => ({ ...message })));
		}),
		scheduleMessageRender: vi.fn(),
	};
	Object.setPrototypeOf(context, EmendChatView.prototype);
	const render = vi.fn(() => viewPrototype.render.call(context));
	Object.assign(context, { render });

	const history = () => viewPrototype.toProviderHistory.call(context);
	const askEstimate = (prompt: string) => buildDraftCapacityEstimate({
		provider,
		request: {
			systemPrompt: getSystemPrompt('ask'),
			userPrompt: buildUserPrompt(requestContext, prompt, []),
			history: history(),
		},
	});
	const fullNoteEstimate = (prompt: string) => buildDraftCapacityEstimate({
		provider,
		request: {
			systemPrompt: getEditStrategy().getFullNotePrompt(undefined),
			userPrompt: buildUserPrompt(requestContext, prompt, [], sourceText),
			history: history(),
		},
	});
	const selectionEstimate = (prompt: string) => buildDraftCapacityEstimate({
		provider,
		request: {
			systemPrompt: getEditStrategy().getSelectionPrompt(undefined),
			userPrompt: buildSelectionUserPrompt({
				snapshot,
				prompt,
				maxContextCharacters: normalizeContextLimit(
					options.maxContextCharacters,
				),
				smartSelectionContext: true,
				additionalNotes: [],
				notePath: includeNotePath
					? formatVaultQualifiedPath('Vault', file.path)
					: undefined,
			}),
			history: history(),
		},
	});

	return {
		context,
		contentEl,
		render,
		read,
		provider,
		requestContext,
		snapshot,
		editor,
		additionalNotesStore,
		captureChatContext,
		captureSelectionEditTarget,
		requestChatCompletion,
		requestSelectionEdit,
		savedSnapshots,
		askEstimate,
		fullNoteEstimate,
		selectionEstimate,
	};
}

const INVALID_CAPACITY_TEXT =
	'Context capacity settings are invalid. Requests are blocked until both token values are positive and the window exceeds the reserve.';
const AUTHORITATIVE_INVALID_CAPACITY_TEXT =
	'Context capacity settings are invalid. Requests are blocked until both token values are positive and the window exceeds the reserve.';
const CAPACITY_EXCLUSION_TEXT =
	'Excluded from this estimate: instructions and skills, additional-note contents, the first Web round\'s system prompt and tool declarations, and later Web or correction rounds; the exact submission check remains authoritative.';

function expectedCapacitySummary(
	estimate: ReturnType<typeof buildDraftCapacityEstimate>,
): string {
	const tokens = estimate.categories.estimatedInputTokens;
	if (estimate.capacity.kind === 'invalid') {
		return INVALID_CAPACITY_TEXT;
	}
	if (estimate.capacity.kind === 'unconfigured') {
		return `Estimated input: ${tokens} tokens. Capacity checks are off.`;
	}
	const base =
		`Estimated input: ${tokens} tokens of ${estimate.capacity.effectiveInputTokens} effective capacity.`;
	return estimate.overCapacity ? `${base} This draft is over capacity.` : base;
}

function expectedBlockedNotice(
	estimate: ReturnType<typeof buildDraftCapacityEstimate>,
): string {
	if (estimate.capacity.kind === 'invalid') {
		return `Emend: ${AUTHORITATIVE_INVALID_CAPACITY_TEXT}`;
	}
	return `Emend: This draft is over capacity at about ${estimate.categories.estimatedInputTokens} input tokens of ${estimate.capacity.kind === 'valid' ? estimate.capacity.effectiveInputTokens : 0} effective capacity. Reduce the draft, chat history, or the selected target.`;
}

function findCapacityRoot(contentEl: FakeElement): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) => element.className.split(' ').includes('emend-context-capacity'),
	)[0];
}

function findCapacitySummary(contentEl: FakeElement): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) => element.className.split(' ').includes('emend-context-capacity-summary'),
	)[0];
}

function findSendButton(contentEl: FakeElement): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) => element.tagName === 'button' && element.textContent === 'Send',
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

function noticeMessages(): string[] {
	return (Notice as unknown as { messages: string[] }).messages;
}

function findWebSelect(contentEl: FakeElement): FakeElement | undefined {
	return findElements(
		contentEl,
		(element) =>
			element.tagName === 'select' &&
			element.attributes['aria-label'] === 'Web search mode',
	)[0];
}

function findActiveModeButtonIndex(contentEl: FakeElement): number {
	return findElements(
		contentEl,
		(element) => element.className.split(' ').includes('emend-chat-mode-button'),
	).findIndex((element) => element.className.split(' ').includes('is-active'));
}

function keydownEvent(overrides: Partial<ShortcutEvent> = {}) {
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

describe('EmendChatView draft capacity estimate', () => {
	beforeEach(() => {
		noticeMessages().length = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('places the compact bar between mode and session controls, never in the composer', async () => {
		const fixture = createCapacityView({
			capacity: { contextWindowTokens: 1000, outputReserveTokens: 100 },
		});

		await viewPrototype.refreshTargetNote.call(fixture.context);

		const root = findCapacityRoot(fixture.contentEl);
		const rootIndex = fixture.contentEl.children.indexOf(root as FakeElement);
		const modeIndex = fixture.contentEl.children.findIndex((element) =>
			element.className.split(' ').includes('emend-chat-mode-selector'),
		);
		const sessionIndex = fixture.contentEl.children.findIndex((element) =>
			element.className.split(' ').includes('emend-chat-session-controls'),
		);
		const messagesIndex = fixture.contentEl.children.findIndex((element) =>
			element.className.split(' ').includes('emend-chat-messages'),
		);
		const composer = fixture.contentEl.children.find((element) =>
			element.className.split(' ').includes('emend-chat-composer'),
		);
		expect(root).toBeDefined();
		expect(rootIndex).toBe(modeIndex + 1);
		expect(sessionIndex).toBe(rootIndex + 1);
		expect(messagesIndex).toBe(sessionIndex + 1);
		expect(rootIndex).toBeGreaterThan(0);
		expect(findElements(root as FakeElement, (element) =>
			element.attributes.role === 'meter',
		)).toHaveLength(1);
		expect(findElements(root as FakeElement, (element) =>
			element.tagName === 'button',
		)).toHaveLength(0);
		expect(findElements(composer as FakeElement, (element) =>
			element.className.split(' ').includes('emend-context-capacity'),
		)).toHaveLength(0);
	});

	it('shows the shared read-only estimate without provider calls or vault reads', async () => {
		const fixture = createCapacityView({
			capacity: { contextWindowTokens: 1000, outputReserveTokens: 100 },
		});

		await viewPrototype.refreshTargetNote.call(fixture.context);

		const estimate = fixture.askEstimate('');
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(estimate),
		);
		expect(fixture.context.draftCapacityBlocked).toBe(false);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(false);
		const quickActions = findElements(
			fixture.contentEl,
			(element) => element.className.split(' ').includes('emend-chat-quick-action'),
		);
		expect(quickActions).toHaveLength(3);
		expect(quickActions.every((button) => !button.disabled)).toBe(true);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.read).not.toHaveBeenCalled();
	});

	it('updates the estimate while typing without re-rendering or losing the composer', async () => {
		const fixture = createCapacityView({
			capacity: { contextWindowTokens: 1000, outputReserveTokens: 100 },
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const input = fixture.context.inputEl;
		if (!input) {
			throw new Error('Composer missing.');
		}
		const before = findCapacitySummary(fixture.contentEl)?.textContent;
		fixture.render.mockClear();
		fixture.captureChatContext.mockClear();

		input.value = 'A longer typed draft';
		input.dispatch('input');

		const estimate = fixture.askEstimate('A longer typed draft');
		const after = findCapacitySummary(fixture.contentEl)?.textContent;
		expect(after).toBe(expectedCapacitySummary(estimate));
		expect(after).not.toBe(before);
		expect(fixture.render).not.toHaveBeenCalled();
		expect(fixture.context.inputEl).toBe(input);
		expect(input.value).toBe('A longer typed draft');
		expect(fixture.captureChatContext).toHaveBeenCalled();
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.read).not.toHaveBeenCalled();
	});

	it('blocks Send, Enter, Mod+Enter, and quick actions when the draft is at capacity', async () => {
		const fixture = createCapacityView({
			capacity: { contextWindowTokens: 100, outputReserveTokens: 96 },
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const input = fixture.context.inputEl;
		if (!input) {
			throw new Error('Composer missing.');
		}
		input.value = 'Question';
		input.dispatch('input');

		const estimate = fixture.askEstimate('Question');
		expect(estimate.overCapacity).toBe(true);
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(estimate),
		);
		expect(fixture.context.draftCapacityBlocked).toBe(true);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(true);
		const quickActions = findElements(
			fixture.contentEl,
			(element) => element.className.split(' ').includes('emend-chat-quick-action'),
		);
		expect(quickActions.every((button) => button.disabled)).toBe(true);

		const enter = keydownEvent();
		viewPrototype.handleComposerKeydown.call(fixture.context, enter);
		expect(enter.preventDefault).toHaveBeenCalledOnce();
		expect(noticeMessages()).toContain(expectedBlockedNotice(estimate));

		const modEnter = keydownEvent({ metaKey: true });
		viewPrototype.handleComposerKeydown.call(fixture.context, modEnter);
		expect(modEnter.preventDefault).toHaveBeenCalledOnce();

		const shiftEnter = keydownEvent({ shiftKey: true });
		viewPrototype.handleComposerKeydown.call(fixture.context, shiftEnter);
		expect(shiftEnter.preventDefault).not.toHaveBeenCalled();

		const quickAction = findQuickActionButton(fixture.contentEl, 'fix-grammar');
		quickAction?.dispatch('click');

		expect(fixture.context.messages).toEqual([]);
		expect(fixture.savedSnapshots).toEqual([]);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
		expect(fixture.editor.replaceRange).not.toHaveBeenCalled();
	});

	it('blocks submissions and shows the invalid-capacity text for invalid settings', async () => {
		const fixture = createCapacityView({
			capacity: { contextWindowTokens: 100, outputReserveTokens: 100 },
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const input = fixture.context.inputEl;
		if (!input) {
			throw new Error('Composer missing.');
		}
		input.value = 'Question';

		const estimate = fixture.askEstimate('Question');
		expect(estimate.capacity.kind).toBe('invalid');
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(INVALID_CAPACITY_TEXT);
		expect(fixture.context.draftCapacityBlocked).toBe(true);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(true);
		const quickActions = findElements(
			fixture.contentEl,
			(element) => element.className.split(' ').includes('emend-chat-quick-action'),
		);
		expect(quickActions.every((button) => button.disabled)).toBe(true);

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(noticeMessages()).toContain(expectedBlockedNotice(estimate));
		expect(fixture.context.messages).toEqual([]);
		expect(fixture.savedSnapshots).toEqual([]);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	});

	it('refreshes the visible meter when a stale typed submission is blocked', async () => {
		const fixture = createCapacityView();
		await viewPrototype.refreshTargetNote.call(fixture.context);
		if (!fixture.context.inputEl) {
			throw new Error('Composer missing.');
		}
		fixture.context.inputEl.value = 'Question';
		const staleSummary = findCapacitySummary(fixture.contentEl)?.textContent;
		expect(staleSummary).toBe(
			expectedCapacitySummary(fixture.askEstimate('')),
		);
		const blockedEstimate = fixture.askEstimate('Question');
		fixture.provider.contextWindowTokens =
			blockedEstimate.categories.estimatedInputTokens + 1;
		fixture.provider.outputReserveTokens = 1;
		fixture.render.mockClear();

		const enter = keydownEvent();
		viewPrototype.handleComposerKeydown.call(fixture.context, enter);

		expect(enter.preventDefault).toHaveBeenCalledOnce();
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(fixture.askEstimate('Question')),
		);
		expect(findCapacitySummary(fixture.contentEl)?.textContent).not.toBe(
			staleSummary,
		);
		expect(fixture.context.draftCapacityBlocked).toBe(true);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(true);
		expect(noticeMessages()).toContain(
			expectedBlockedNotice(fixture.askEstimate('Question')),
		);
		expect(fixture.render).not.toHaveBeenCalled();
		expect(fixture.context.messages).toEqual([]);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	});

	it('renders an unavailable meter instead of throwing from a settings callback', async () => {
		const fixture = createCapacityView({
			capacity: { contextWindowTokens: 1000, outputReserveTokens: 100 },
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);
		Object.defineProperty(fixture.context.plugin.settings, 'providers', {
			configurable: true,
			get() {
				throw new Error('Unexpected settings failure.');
			},
		});

		expect(() => {
			viewPrototype.refreshCapacityEstimate.call(fixture.context);
		}).not.toThrow();

		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			'Draft estimate unavailable.',
		);
		expect(fixture.context.draftCapacityBlocked).toBe(false);
		expect(noticeMessages()).toEqual([]);
	});

	it('keeps Send enabled and submits below capacity', async () => {
		const fixture = createCapacityView({
			capacity: { contextWindowTokens: 100000, outputReserveTokens: 1000 },
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const input = fixture.context.inputEl;
		if (!input) {
			throw new Error('Composer missing.');
		}
		input.value = 'Question';
		input.dispatch('input');

		const estimate = fixture.askEstimate('Question');
		expect(estimate.blocked).toBe(false);
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(estimate),
		);
		expect(fixture.context.draftCapacityBlocked).toBe(false);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(false);
		expect(noticeMessages()).toEqual([]);

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.requestChatCompletion).toHaveBeenCalledOnce();
		expect(fixture.requestChatCompletion.mock.calls[0]?.[0].prompt).toBe('Question');
		expect(fixture.context.messages).toHaveLength(2);
	});

	it('uses the complete full-note source instead of the bounded Markdown window', async () => {
		const sourceText = `Intro.\n${'Long paragraph. '.repeat(300)}`;
		const fixture = createCapacityView({
			mode: 'edit',
			sourceText,
			markdown: 'Window only.',
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);
		expect(fixture.context.displayedEditTarget).toBe('full-note');

		const fullTokens = fixture.fullNoteEstimate('').categories.estimatedInputTokens;
		const windowTokens = buildDraftCapacityEstimate({
			provider: fixture.provider,
			request: {
				systemPrompt: getSystemPrompt('ask'),
				userPrompt: buildUserPrompt(fixture.requestContext, '', []),
				history: [],
			},
		}).categories.estimatedInputTokens;
		expect(windowTokens).toBeLessThan(fullTokens);

		fixture.provider.contextWindowTokens = fullTokens + 1;
		fixture.provider.outputReserveTokens = 1;
		viewPrototype.refreshCapacityEstimate.call(fixture.context);

		const estimate = fixture.fullNoteEstimate('');
		expect(estimate.capacity).toMatchObject({ effectiveInputTokens: fullTokens });
		expect(estimate.overCapacity).toBe(true);
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			`Estimated input: ${fullTokens} tokens of ${fullTokens} effective capacity. This draft is over capacity.`,
		);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(true);
		expect(fixture.captureSelectionEditTarget).not.toHaveBeenCalled();
	});

	it('shows an unavailable estimate and does not block when the target capture fails', async () => {
		const fixture = createCapacityView({
			mode: 'edit',
			selectedText: 'beta',
			capacity: { contextWindowTokens: 1000, outputReserveTokens: 100 },
		});
		fixture.captureSelectionEditTarget.mockImplementation(() => {
			throw new Error('Select non-whitespace text first.');
		});

		await viewPrototype.refreshTargetNote.call(fixture.context);

		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			'Draft estimate unavailable.',
		);
		expect(fixture.context.draftCapacityBlocked).toBe(false);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(false);
		const quickActions = findElements(
			fixture.contentEl,
			(element) => element.className.split(' ').includes('emend-chat-quick-action'),
		);
		expect(quickActions.every((button) => !button.disabled)).toBe(true);

		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Edit selection';
		}
		await viewPrototype.submitPrompt.call(fixture.context);

		expect(noticeMessages()).toContain(
			'Emend: Select non-whitespace text first.',
		);
		expect(fixture.context.messages).toEqual([]);
		expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	});

	it('uses the captured Selection snapshot and updates when the Edit target changes', async () => {
		const fixture = createCapacityView({
			mode: 'edit',
			selectedText: 'beta',
			selectionFrom: 6,
			selectionTo: 10,
			includeNotePath: true,
			capacity: { contextWindowTokens: 1000, outputReserveTokens: 100 },
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);

		expect(fixture.context.displayedEditTarget).toBe('selection');
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(fixture.selectionEstimate('')),
		);
		expect(fixture.captureSelectionEditTarget).toHaveBeenCalled();
		expect(fixture.captureChatContext).not.toHaveBeenCalled();

		const select = findEditTargetSelect(fixture.contentEl);
		if (select) {
			select.value = 'full-note';
			select.dispatch('change');
		}

		expect(fixture.context.displayedEditTarget).toBe('full-note');
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(fixture.fullNoteEstimate('')),
		);
		expect(fixture.captureChatContext).toHaveBeenCalled();
	});

	it('counts recent ready chat history in the estimate', async () => {
		const fixture = createCapacityView({
			capacity: { contextWindowTokens: 1000, outputReserveTokens: 100 },
			historyMessageLimit: 8,
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const withoutHistory = fixture.askEstimate('');
		fixture.context.messages.push(
			{
				...message('earlier-question', 'Note.md'),
				role: 'user',
				content: 'Earlier question',
			},
			message('earlier-answer', 'Note.md'),
		);

		viewPrototype.refreshCapacityEstimate.call(fixture.context);

		const withHistory = fixture.askEstimate('');
		expect(withHistory.categories.history).toBeGreaterThan(0);
		expect(withHistory.categories.estimatedInputTokens).toBeGreaterThan(
			withoutHistory.categories.estimatedInputTokens,
		);
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(withHistory),
		);
	});

	it('visibly excludes additional notes and keeps their contents out of the estimate', async () => {
		const fixture = createCapacityView({
			capacity: { contextWindowTokens: 1000, outputReserveTokens: 100 },
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const before = findCapacitySummary(fixture.contentEl)?.textContent;
		expect(textOf(fixture.contentEl)).toContain(CAPACITY_EXCLUSION_TEXT);

		fixture.additionalNotesStore.add('Note.md', 'Extra.md');
		viewPrototype.refreshCapacityEstimate.call(fixture.context);

		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(before);
		expect(fixture.read).not.toHaveBeenCalled();
	});

	it('disables and blocks only the quick actions whose own prompt is over capacity', async () => {
		const fixture = createCapacityView({ mode: 'edit' });
		await viewPrototype.refreshTargetNote.call(fixture.context);

		const fixEstimate = fixture.fullNoteEstimate(QUICK_ACTIONS[0].prompt);
		const conciseEstimate = fixture.fullNoteEstimate(QUICK_ACTIONS[1].prompt);
		const examplesEstimate = fixture.fullNoteEstimate(QUICK_ACTIONS[2].prompt);
		const fixTokens = fixEstimate.categories.estimatedInputTokens;
		expect(conciseEstimate.categories.estimatedInputTokens).toBeLessThan(fixTokens);
		expect(examplesEstimate.categories.estimatedInputTokens).toBeGreaterThanOrEqual(
			fixTokens,
		);

		fixture.provider.contextWindowTokens = fixTokens + 1;
		fixture.provider.outputReserveTokens = 1;
		viewPrototype.refreshCapacityEstimate.call(fixture.context);

		expect(findQuickActionButton(fixture.contentEl, 'fix-grammar')?.disabled).toBe(true);
		expect(findQuickActionButton(fixture.contentEl, 'add-examples')?.disabled).toBe(true);
		expect(findQuickActionButton(fixture.contentEl, 'make-concise')?.disabled).toBe(false);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(false);

		findQuickActionButton(fixture.contentEl, 'fix-grammar')?.dispatch('click');
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.context.messages).toEqual([]);

		findQuickActionButton(fixture.contentEl, 'make-concise')?.dispatch('click');
		await vi.waitFor(() => expect(fixture.requestChatCompletion).toHaveBeenCalledOnce());
		expect(fixture.requestChatCompletion.mock.calls[0]?.[0].prompt).toBe(
			QUICK_ACTIONS[1].prompt,
		);
	});

	it('recomputes after a mode switch without submitting a request', async () => {
		const fixture = createCapacityView({
			capacity: { contextWindowTokens: 1000, outputReserveTokens: 100 },
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(fixture.askEstimate('')),
		);

		viewPrototype.setMode.call(fixture.context, 'edit');

		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(fixture.fullNoteEstimate('')),
		);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	});

	it('recomputes with the restored draft after a mode switch', async () => {
		const fixture = createCapacityView();
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const emptyEditTokens = fixture.fullNoteEstimate('').categories.estimatedInputTokens;
		fixture.provider.contextWindowTokens = emptyEditTokens + 6;
		fixture.provider.outputReserveTokens = 1;
		viewPrototype.refreshCapacityEstimate.call(fixture.context);
		if (!fixture.context.inputEl) {
			throw new Error('Composer missing.');
		}
		const draft = `Draft ${'x'.repeat(400)}`;
		fixture.context.inputEl.value = draft;
		fixture.context.inputEl.dispatch('input');

		expect(fixture.askEstimate(draft).overCapacity).toBe(false);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(false);

		viewPrototype.setMode.call(fixture.context, 'edit');

		const editDraft = fixture.fullNoteEstimate(draft);
		expect(editDraft.overCapacity).toBe(true);
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(editDraft),
		);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(true);
		expect(fixture.context.inputEl?.value).toBe(draft);
	});

	it('recomputes with the restored draft after a Web control change', async () => {
		const fixture = createCapacityView();
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const emptyAskTokens = fixture.askEstimate('').categories.estimatedInputTokens;
		fixture.provider.contextWindowTokens = emptyAskTokens + 6;
		fixture.provider.outputReserveTokens = 1;
		viewPrototype.refreshCapacityEstimate.call(fixture.context);
		if (!fixture.context.inputEl) {
			throw new Error('Composer missing.');
		}
		const draft = `Draft ${'x'.repeat(400)}`;
		fixture.context.inputEl.value = draft;
		fixture.context.inputEl.dispatch('input');
		expect(fixture.askEstimate(draft).overCapacity).toBe(true);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(true);

		const webSelect = findWebSelect(fixture.contentEl);
		if (webSelect) {
			webSelect.value = 'review';
			webSelect.dispatch('change');
		}

		expect(fixture.context.webSearchMode).toBe('review');
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(fixture.askEstimate(draft)),
		);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(true);
		expect(fixture.context.inputEl?.value).toBe(draft);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	});

	it('estimates read-only quick actions against their Edit target, not the bounded window', async () => {
		const sourceText = `Intro.\n${'Long paragraph. '.repeat(400)}`;
		const fixture = createCapacityView({
			sourceText,
			markdown: 'Window only.',
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const readOnlyTokens = fixture.askEstimate('').categories.estimatedInputTokens;
		const editTokens = fixture.fullNoteEstimate('').categories.estimatedInputTokens;
		const readOnlyActionTokens = Math.max(
			...QUICK_ACTIONS.map(
				(action) => fixture.askEstimate(action.prompt).categories.estimatedInputTokens,
			),
		);
		expect(readOnlyTokens).toBeLessThan(editTokens);
		expect(readOnlyActionTokens).toBeLessThan(readOnlyTokens + 40);
		fixture.provider.contextWindowTokens = readOnlyTokens + 41;
		fixture.provider.outputReserveTokens = 1;
		viewPrototype.refreshCapacityEstimate.call(fixture.context);

		expect(fixture.askEstimate('').overCapacity).toBe(false);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(false);
		for (const action of QUICK_ACTIONS) {
			expect(findQuickActionButton(fixture.contentEl, action.id)?.disabled).toBe(true);
		}
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	});

	it('keeps small Selection quick actions enabled while the full note is over capacity', async () => {
		const sourceText = `Intro.\n${'x'.repeat(20000)}\nbeta\n${'y'.repeat(20000)}`;
		const fixture = createCapacityView({
			mode: 'ask',
			sourceText,
			markdown: sourceText,
			selectedText: 'beta',
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);
		expect(fixture.context.displayedEditTarget).toBe('selection');
		const selectionTokens = Math.max(
			...QUICK_ACTIONS.map(
				(action) =>
					fixture.selectionEstimate(action.prompt).categories.estimatedInputTokens,
			),
		);
		const fullNoteTokens =
			fixture.fullNoteEstimate(QUICK_ACTIONS[1].prompt).categories.estimatedInputTokens;
		expect(fullNoteTokens).toBeGreaterThan(selectionTokens);
		fixture.provider.contextWindowTokens = selectionTokens + 2;
		fixture.provider.outputReserveTokens = 1;
		viewPrototype.refreshCapacityEstimate.call(fixture.context);

		expect(fixture.askEstimate('').overCapacity).toBe(true);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(true);
		for (const action of QUICK_ACTIONS) {
			expect(findQuickActionButton(fixture.contentEl, action.id)?.disabled).toBe(false);
		}
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	});

	it('keeps the visible mode and next request mode when a quick action is blocked', async () => {
		const fixture = createCapacityView();
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const emptyEditTokens = fixture.fullNoteEstimate('').categories.estimatedInputTokens;
		fixture.provider.contextWindowTokens = emptyEditTokens + 2;
		fixture.provider.outputReserveTokens = 1;
		viewPrototype.refreshCapacityEstimate.call(fixture.context);
		if (!fixture.context.inputEl) {
			throw new Error('Composer missing.');
		}
		fixture.context.inputEl.value = 'Question';
		fixture.context.inputEl.dispatch('input');
		expect(fixture.askEstimate('Question').overCapacity).toBe(false);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(false);
		expect(findQuickActionButton(fixture.contentEl, 'fix-grammar')?.disabled).toBe(true);
		const fixEstimate = fixture.fullNoteEstimate(QUICK_ACTIONS[0].prompt);

		findQuickActionButton(fixture.contentEl, 'fix-grammar')?.dispatch('click');

		expect(fixture.context.selectedMode).toBe('ask');
		expect(findActiveModeButtonIndex(fixture.contentEl)).toBe(0);
		expect(fixture.context.inputEl?.attributes.placeholder).toBe(
			'Ask about the active note...',
		);
		expect(findWebSelect(fixture.contentEl)?.disabled).toBe(false);
		expect(noticeMessages()).toContain(expectedBlockedNotice(fixEstimate));
		expect(fixture.context.messages).toEqual([]);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();

		await viewPrototype.submitPrompt.call(fixture.context);

		expect(fixture.requestChatCompletion).toHaveBeenCalledOnce();
		expect(fixture.requestChatCompletion.mock.calls[0]?.[0].mode).toBe('ask');
	});

	it('rechecks a quick action on click when capacity changed without a refresh', async () => {
		const fixture = createCapacityView();
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const emptyEditTokens = fixture.fullNoteEstimate('').categories.estimatedInputTokens;
		fixture.provider.contextWindowTokens = emptyEditTokens + 100;
		fixture.provider.outputReserveTokens = 1;
		viewPrototype.refreshCapacityEstimate.call(fixture.context);
		expect(findQuickActionButton(fixture.contentEl, 'fix-grammar')?.disabled).toBe(false);
		expect(fixture.context.selectedMode).toBe('ask');
		if (!fixture.context.inputEl) {
			throw new Error('Composer missing.');
		}
		fixture.context.inputEl.value = 'Question';
		const staleSummary = findCapacitySummary(fixture.contentEl)?.textContent;

		fixture.provider.contextWindowTokens = emptyEditTokens + 2;
		const blockedEstimate = fixture.fullNoteEstimate(QUICK_ACTIONS[0].prompt);
		expect(blockedEstimate.blocked).toBe(true);
		fixture.render.mockClear();

		findQuickActionButton(fixture.contentEl, 'fix-grammar')?.dispatch('click');

		expect(fixture.context.selectedMode).toBe('ask');
		expect(fixture.render).not.toHaveBeenCalled();
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(fixture.askEstimate('Question')),
		);
		expect(findCapacitySummary(fixture.contentEl)?.textContent).not.toBe(
			staleSummary,
		);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(false);
		expect(noticeMessages()).toContain(expectedBlockedNotice(blockedEstimate));
		expect(fixture.context.messages).toEqual([]);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.requestSelectionEdit).not.toHaveBeenCalled();
		expect(fixture.editor.replaceRange).not.toHaveBeenCalled();
	});

	it('re-renders the active mode when submitPrompt blocks after a quick action', async () => {
		const fixture = createCapacityView();
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const smallEstimate = fixture.fullNoteEstimate(QUICK_ACTIONS[0].prompt);
		const largeSource = `Intro.\n${'Long paragraph. '.repeat(500)}`;
		const largeContext = {
			...fixture.requestContext,
			sourceText: largeSource,
			markdown: largeSource,
		};
		const largeRequest = {
			systemPrompt: getEditStrategy().getFullNotePrompt(undefined),
			userPrompt: buildUserPrompt(
				largeContext,
				QUICK_ACTIONS[0].prompt,
				[],
				largeSource,
			),
			history: [],
		};
		const largeTokens =
			buildDraftCapacityEstimate({ provider: fixture.provider, request: largeRequest })
				.categories.estimatedInputTokens;
		expect(smallEstimate.categories.estimatedInputTokens).toBeLessThan(largeTokens);
		fixture.provider.contextWindowTokens = largeTokens + 1;
		fixture.provider.outputReserveTokens = 1;
		const largeEstimate = buildDraftCapacityEstimate({
			provider: fixture.provider,
			request: largeRequest,
		});
		expect(largeEstimate.blocked).toBe(true);
		fixture.captureChatContext.mockReturnValue(largeContext);
		fixture.captureChatContext.mockReturnValueOnce(fixture.requestContext);
		if (fixture.context.inputEl) {
			fixture.context.inputEl.value = 'Preserve this draft';
		}

		findQuickActionButton(fixture.contentEl, 'fix-grammar')?.dispatch('click');

		expect(fixture.context.selectedMode).toBe('edit');
		expect(findActiveModeButtonIndex(fixture.contentEl)).toBe(1);
		expect(fixture.context.inputEl?.value).toBe('Preserve this draft');
		expect(noticeMessages()).toContain(expectedBlockedNotice(largeEstimate));
		expect(fixture.context.messages).toEqual([]);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	});

	it('uses the shared context-limit normalization and vault-qualified note path', async () => {
		const sourceText = `Alpha ${'word '.repeat(600)}beta ${'tail '.repeat(200)}`;
		const fixture = createCapacityView({
			mode: 'edit',
			sourceText,
			selectedText: 'beta',
			includeNotePath: true,
			maxContextCharacters: 0,
			capacity: { contextWindowTokens: 1000, outputReserveTokens: 100 },
		});
		await viewPrototype.refreshTargetNote.call(fixture.context);

		expect(normalizeContextLimit(0)).toBe(1000);
		expect(formatVaultQualifiedPath('Vault', 'Note.md')).toBe('Vault/Note.md');
		const expected = buildDraftCapacityEstimate({
			provider: fixture.provider,
			request: {
				systemPrompt: getEditStrategy().getSelectionPrompt(undefined),
				userPrompt: buildSelectionUserPrompt({
					snapshot: fixture.snapshot,
					prompt: '',
					maxContextCharacters: normalizeContextLimit(0),
					smartSelectionContext: true,
					additionalNotes: [],
					notePath: formatVaultQualifiedPath('Vault', 'Note.md'),
				}),
				history: [],
			},
		});
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(expected),
		);
	});
});

function createWiredCapacityView(options: CapacityViewOptions = {}) {
	const fixture = createCapacityView(options);
	const handlers = new Map<string, (...args: unknown[]) => void>();
	const registerEvent = vi.fn();
	const register = vi.fn();
	const context = fixture.context as unknown as Record<string, unknown>;
	const app = (fixture.context as unknown as { app: Record<string, unknown> }).app;
	app.scope = new Scope();
	app.workspace = {
		on: (event: string, handler: (...args: unknown[]) => void) => {
			handlers.set(event, handler);
			return event;
		},
	};
	context.registerEvent = registerEvent;
	context.register = register;
	let activeNotePath = 'Note.md';
	const plugin = (fixture.context as unknown as {
		plugin: Record<string, unknown>;
	}).plugin;
	plugin.getActiveNotePath = () => activeNotePath;
	return {
		...fixture,
		handlers,
		registerEvent,
		register,
		setActiveNotePath: (path: string) => {
			activeNotePath = path;
		},
	};
}

async function waitForCapacityRefresh() {
	await new Promise<void>((resolve) => {
		window.setTimeout(resolve, 220);
	});
}

describe('EmendChatView capacity refresh sources', () => {
	beforeEach(() => {
		vi.stubGlobal('window', {
			setTimeout,
			clearTimeout,
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('refreshes once per debounced editor content burst without reads or requests', async () => {
		const fixture = createWiredCapacityView({
			capacity: { contextWindowTokens: 1000, outputReserveTokens: 100 },
		});
		await viewPrototype.onOpen.call(fixture.context);
		expect(fixture.registerEvent).toHaveBeenCalledTimes(2);
		expect(fixture.register).toHaveBeenCalledWith(expect.any(Function));
		const editorChange = fixture.handlers.get('editor-change');
		expect(editorChange).toBeDefined();
		expect(fixture.handlers.get('editor-selection-change')).toBeDefined();

		fixture.captureChatContext.mockClear();
		fixture.requestContext.markdown = 'Fresh editor content for the estimate.';
		editorChange?.();
		editorChange?.();
		editorChange?.();
		expect(fixture.captureChatContext).not.toHaveBeenCalled();

		await waitForCapacityRefresh();

		expect(fixture.captureChatContext).toHaveBeenCalledTimes(1);
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(fixture.askEstimate('')),
		);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.read).not.toHaveBeenCalled();

		fixture.captureChatContext.mockClear();
		editorChange?.();
		await waitForCapacityRefresh();
		expect(fixture.captureChatContext).toHaveBeenCalledTimes(1);
	});

	it('refreshes from caret-window changes in read-only modes', async () => {
		const fixture = createWiredCapacityView({
			capacity: { contextWindowTokens: 1000, outputReserveTokens: 100 },
		});
		await viewPrototype.onOpen.call(fixture.context);
		fixture.requestContext.markdown = 'Caret moved to another paragraph.';

		fixture.handlers.get('editor-selection-change')?.();
		await waitForCapacityRefresh();

		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(fixture.askEstimate('')),
		);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
	});

	it('refreshes the automatic Edit target when the selection appears', async () => {
		const fixture = createWiredCapacityView({
			mode: 'edit',
			selectedText: 'beta',
			capacity: { contextWindowTokens: 1000, outputReserveTokens: 100 },
		});
		let usableSelection = false;
		(
			fixture.context.plugin as unknown as {
				hasUsableSelection: () => boolean;
			}
		).hasUsableSelection = () => usableSelection;
		await viewPrototype.onOpen.call(fixture.context);
		expect(fixture.context.displayedEditTarget).toBe('full-note');
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(fixture.fullNoteEstimate('')),
		);

		usableSelection = true;
		fixture.handlers.get('editor-selection-change')?.();
		await waitForCapacityRefresh();

		expect(fixture.context.displayedEditTarget).toBe('selection');
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(fixture.selectionEstimate('')),
		);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.editor.replaceRange).not.toHaveBeenCalled();
	});

	it('applies a capacity change made by a settings save', async () => {
		const fixture = createWiredCapacityView({
			capacity: { contextWindowTokens: 1000, outputReserveTokens: 100 },
		});
		await viewPrototype.onOpen.call(fixture.context);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(false);

		fixture.provider.contextWindowTokens = 100;
		fixture.provider.outputReserveTokens = 96;
		viewPrototype.refreshCapacityEstimate.call(fixture.context);

		const estimate = fixture.askEstimate('');
		expect(estimate.overCapacity).toBe(true);
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(estimate),
		);
		expect(findSendButton(fixture.contentEl)?.disabled).toBe(true);
		const quickActions = findElements(
			fixture.contentEl,
			(element) => element.className.split(' ').includes('emend-chat-quick-action'),
		);
		expect(quickActions.every((button) => button.disabled)).toBe(true);
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.read).not.toHaveBeenCalled();
	});

	it('refreshes when an additional note is selected without reading its contents', async () => {
		const fixture = createWiredCapacityView({
			capacity: { contextWindowTokens: 1000, outputReserveTokens: 100 },
		});
		await viewPrototype.onOpen.call(fixture.context);
		const before = findCapacitySummary(fixture.contentEl)?.textContent;
		fixture.captureChatContext.mockClear();

		fixture.additionalNotesStore.add('Note.md', 'Extra.md');
		expect(fixture.captureChatContext).not.toHaveBeenCalled();

		await waitForCapacityRefresh();

		expect(fixture.captureChatContext).toHaveBeenCalledTimes(1);
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(before);
		expect(fixture.read).not.toHaveBeenCalled();
	});

	it('ends a note switch and same-note thread refresh with a fresh estimate', async () => {
		const fixture = createWiredCapacityView({
			capacity: { contextWindowTokens: 1000, outputReserveTokens: 100 },
			historyMessageLimit: 8,
		});
		await viewPrototype.onOpen.call(fixture.context);
		expect(fixture.context.notePath).toBe('Note.md');

		fixture.requestContext.file.path = 'Other.md';
		fixture.requestContext.noteLabel = 'Other.md';
		fixture.requestContext.markdown = 'Other note body for the estimate.';
		fixture.requestContext.sourceText = 'Other note body for the estimate.';
		fixture.setActiveNotePath('Other.md');

		await viewPrototype.refreshTargetNote.call(fixture.context);

		expect(fixture.context.notePath).toBe('Other.md');
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(fixture.askEstimate('')),
		);

		const withoutHistory = fixture.askEstimate('');
		fixture.context.messages.push(
			{ ...message('earlier-question', 'Other.md'), role: 'user' },
			message('earlier-answer', 'Other.md'),
		);
		await viewPrototype.refreshTargetNote.call(fixture.context);
		const withHistory = fixture.askEstimate('');

		expect(withHistory.categories.history).toBeGreaterThan(
			withoutHistory.categories.history,
		);
		expect(findCapacitySummary(fixture.contentEl)?.textContent).toBe(
			expectedCapacitySummary(withHistory),
		);
	});

	it('cancels the pending refresh and unsubscribes when the view closes', async () => {
		const fixture = createWiredCapacityView({
			capacity: { contextWindowTokens: 1000, outputReserveTokens: 100 },
		});
		const store = fixture.additionalNotesStore;
		const originalSubscribe = store.subscribe.bind(store);
		vi.spyOn(store, 'subscribe').mockImplementation((listener) => {
			const unsubscribe = originalSubscribe(listener);
			return vi.fn(unsubscribe);
		});
		await viewPrototype.onOpen.call(fixture.context);
		const registeredUnsubscribe = fixture.register.mock.calls
			.map((call) => call[0] as unknown)
			.find(
				(value): value is ReturnType<typeof vi.fn> =>
					typeof value === 'function',
			);
		expect(registeredUnsubscribe).toBeDefined();
		fixture.captureChatContext.mockClear();

		fixture.handlers.get('editor-change')?.();
		await viewPrototype.onClose.call(fixture.context);

		expect(registeredUnsubscribe).toHaveBeenCalledTimes(1);
		await waitForCapacityRefresh();
		expect(fixture.captureChatContext).not.toHaveBeenCalled();

		fixture.handlers.get('editor-change')?.();
		await waitForCapacityRefresh();
		expect(fixture.captureChatContext).not.toHaveBeenCalled();
		expect(fixture.requestChatCompletion).not.toHaveBeenCalled();
		expect(fixture.read).not.toHaveBeenCalled();
	});
});
