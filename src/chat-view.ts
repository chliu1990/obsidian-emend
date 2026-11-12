import {
	ItemView,
	MarkdownRenderer,
	Notice,
	Platform,
	Scope,
	setIcon,
	WorkspaceLeaf,
	type EventRef,
} from 'obsidian';
import { AdditionalNotesControl } from './additional-notes-ui';
import {
	createChatSession,
	createChatSessionId,
	normalizeManualTitle,
	resolveActiveSession,
	type ChatSession,
} from './chat-sessions';
import { ChatSessionControls } from './chat-session-controls';
import { EMEND_BUILD_ID } from './build-info';
import type EmendPlugin from './main';
import { getComposerShortcut, getDefaultShortcutLabels } from './chat-shortcuts';
import {
	buildFullNoteDraftEstimate,
	buildReadOnlyDraftEstimate,
	buildSelectionDraftEstimate,
	ContextCapacityDisplay,
	formatDraftCapacityBlockMessage,
	type DraftCapacityEstimate,
} from './context-capacity-ui';
import { formatEditSummary, formatNoChangeSummary } from './edit-summary';
import { formatVaultQualifiedPath, type RequestContext } from './context';
import {
	resolveEditTarget,
	type EditTargetChoice,
	type ResolvedEditTarget,
} from './edit-target';
import { MODES } from './mode';
import {
	areQuickActionsDisabled,
	QUICK_ACTIONS,
	type QuickAction,
} from './quick-actions';
import type { SelectionEditTarget } from './selection-editor';
import { normalizeContextLimit } from './settings';
import { formatTokenUsage } from './token-usage';
import type {
	ChatMessage,
	EmendSettings,
	Mode,
	ProviderHistoryMessage,
	SelectionSnapshot,
} from './types';
import { WebSearchModal } from './web-search-modal';
import { WEB_EXTRACTION_DISCLOSURE } from './web-search';
import type {
	WebActivityRecord,
	WebSearchActivity,
	WebSearchMode,
	WebSource,
	WebToolCall,
} from './web-search';

export const EMEND_CHAT_VIEW_TYPE = 'emend-chat-view';
export const WEB_SEARCH_DISCLOSURE = `DeepSeek may generate search queries and fetch URLs from note context. Review asks before each batch; Auto runs directly. Successful search/fetch calls may be billed separately. Queries, URLs, and outcomes are stored locally with ready chats. ${WEB_EXTRACTION_DISCLOSURE}`;

function formatExtractionWarning(failedExtractions: number) {
	return `Emend could not extract information from ${failedExtractions} web ${failedExtractions === 1 ? 'query' : 'queries'}. The answer may be incomplete.`;
}

function formatSearchWarning(failedSearches: number) {
	return `Emend could not complete ${failedSearches} web ${failedSearches === 1 ? 'search' : 'searches'}. The answer may be incomplete.`;
}

const MODE_PLACEHOLDERS: Record<Mode, string> = {
	ask: 'Ask about the active note...',
	edit: 'Edit the note or selection with CriticMarkup...',
	discuss: 'Discuss an idea in the active note...',
	brainstorm: 'Brainstorm ideas for the active note...',
};

const CAPACITY_REFRESH_DEBOUNCE_MS = 150;

interface UntypedWorkspaceEvents {
	on(name: string, callback: (...data: unknown[]) => unknown): EventRef;
}

type DraftCapacityTarget =
	| { type: 'read-only'; mode: Exclude<Mode, 'edit'>; context: RequestContext }
	| { type: 'full-note'; mode: 'edit'; context: RequestContext }
	| { type: 'selection'; mode: 'edit'; snapshot: SelectionSnapshot };

type CapturedDraftTarget =
	| { type: 'full-note'; mode: 'edit'; context: RequestContext }
	| { type: 'selection'; mode: 'edit'; target: SelectionEditTarget }
	| { type: 'read-only'; mode: Exclude<Mode, 'edit'>; context: RequestContext };

export interface ChatIdentity {
	notePath: string;
	sessionId: string;
	generation: number;
}

export interface ActiveRequest {
	identity: ChatIdentity;
	controller: AbortController;
	loadingMessage: ChatMessage;
}

interface MessagePersistence {
	session: ChatSession;
	message: ChatMessage;
	request: ActiveRequest;
	titlePrompt?: string;
}

export class EmendChatView extends ItemView {
	private messages: ChatMessage[] = [];
	private sessions: ChatSession[] = [];
	private activeSessionId: string | null = null;
	private conversationGeneration = 0;
	private activeRequest: ActiveRequest | null = null;
	private isSessionMutating = false;
	private readonly transientSessionIds = new Set<string>();
	private readonly transientSessions = new Map<string, ChatSession>();
	private messagesEl: HTMLElement | null = null;
	private followLatestMessages = true;
	private responseStartMessageId: string | null = null;
	private inputEl: HTMLTextAreaElement | null = null;
	private activeModelEl: HTMLElement | null = null;
	private isSending = false;
	private isThreadLoading = false;
	private selectedMode: Mode;
	private webSearchMode: WebSearchMode = 'off';
	private editTargetChoice: EditTargetChoice = 'auto';
	private displayedEditTarget: ResolvedEditTarget = 'full-note';
	private editTargetSelectEl: HTMLSelectElement | null = null;
	private webReviewModal: WebSearchModal | null = null;
	private activeController: AbortController | null = null;
	private pendingRenderFrame: number | null = null;
	private pendingMarkdownRenders = 0;
	private pendingScrollRestore: { previousScrollTop: number; wasFollowing: boolean } | null = null;
	private renderGeneration = 0;
	private pendingMessages = new Set<ChatMessage>();
	private messageBodyEls = new Map<string, HTMLElement>();
	private closed = false;
	private notePath: string | null = null;
	private additionalNotesControl: AdditionalNotesControl | null = null;
	private sessionControls: ChatSessionControls | null = null;
	private capacityDisplay: ContextCapacityDisplay | null = null;
	private capacityRefreshTimer: number | null = null;
	private unsubscribeAdditionalNotes: (() => void) | null = null;
	private sendButtonEl: HTMLButtonElement | null = null;
	private quickActionButtons: Array<{
		action: QuickAction;
		button: HTMLButtonElement;
	}> = [];
	private draftCapacityBlocked = false;
	private readonly drafts = new Map<string, Map<string, string>>();

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: EmendPlugin,
	) {
		super(leaf);
		this.selectedMode = plugin.settings.defaultMode;
	}

	getViewType() {
		return EMEND_CHAT_VIEW_TYPE;
	}

	getDisplayText() {
		return 'Emend';
	}

	getIcon() {
		return 'messages-square';
	}

	protected async onOpen() {
		this.closed = false;
		this.registerComposerScope();
		this.registerCapacityRefreshSources();
		this.render();
		await this.refreshTargetNote();
	}

	protected async onClose() {
		this.closed = true;
		this.conversationGeneration++;
		this.clearCapacityRefreshTimer();
		this.unsubscribeAdditionalNotes?.();
		this.unsubscribeAdditionalNotes = null;
		this.isThreadLoading = false;
		this.isSessionMutating = false;
		this.notePath = null;
		this.activeSessionId = null;
		this.abortActiveRequest();
		this.renderGeneration++;
		this.pendingMarkdownRenders = 0;
		this.pendingScrollRestore = null;
		this.cancelPendingRender();
		this.pendingMessages.clear();
		this.messageBodyEls.clear();
		this.activeModelEl = null;
		this.messagesEl = null;
		this.additionalNotesControl?.destroy();
		this.additionalNotesControl = null;
		this.sessionControls?.destroy();
		this.sessionControls = null;
		this.capacityDisplay?.destroy();
		this.capacityDisplay = null;
		this.sendButtonEl = null;
		this.quickActionButtons = [];
		this.draftCapacityBlocked = false;
		this.inputEl = null;
		this.editTargetSelectEl = null;
		this.contentEl.empty();
	}

	refreshCapacityEstimate() {
		if (!this.capacityDisplay) {
			return;
		}
		this.clearCapacityRefreshTimer();
		this.refreshDraftEstimate();
	}

	private registerCapacityRefreshSources() {
		this.registerEvent(
			this.app.workspace.on('editor-change', () => {
				this.scheduleCapacityRefresh();
			}),
		);
		// Obsidian documents this event at runtime, but the installed 1.14.4 typings omit it; this narrow cast is the only typed-compatible registration.
		const untypedWorkspace = this.app.workspace as unknown as UntypedWorkspaceEvents;
		this.registerEvent(
			untypedWorkspace.on('editor-selection-change', () => {
				this.scheduleCapacityRefresh();
			}),
		);
		const unsubscribe = this.plugin.additionalNotesStore.subscribe(() => {
			this.scheduleCapacityRefresh();
		});
		this.unsubscribeAdditionalNotes = unsubscribe;
		this.register(unsubscribe);
	}

	private scheduleCapacityRefresh() {
		if (this.closed || !this.capacityDisplay) {
			return;
		}
		this.clearCapacityRefreshTimer();
		this.capacityRefreshTimer = window.setTimeout(() => {
			this.capacityRefreshTimer = null;
			if (this.closed || !this.capacityDisplay) {
				return;
			}
			this.refreshEditTargetControl();
			this.refreshDraftEstimate();
		}, CAPACITY_REFRESH_DEBOUNCE_MS);
	}

	private clearCapacityRefreshTimer() {
		const timer = this.capacityRefreshTimer;
		if (timer === null) {
			return;
		}
		window.clearTimeout(timer);
		this.capacityRefreshTimer = null;
	}

	refreshActiveModelLabel() {
		if (!this.activeModelEl) {
			this.render();
			return;
		}

		this.activeModelEl.textContent = this.getActiveModelLabel();
	}

	setMode(mode: Mode) {
		const draft = this.inputEl?.value ?? '';
		this.selectedMode = mode;
		this.render();
		if (this.inputEl) {
			this.inputEl.value = draft;
		}
		if (this.capacityDisplay) {
			this.refreshDraftEstimate(draft);
		}
	}

	async refreshTargetNote() {
		const notePath = this.plugin.getActiveNotePath();
		if (notePath === this.notePath) {
			this.refreshEditTargetControl();
			this.refreshDraftEstimate();
			return;
		}

		this.saveCurrentDraft();
		const generation = ++this.conversationGeneration;
		this.notePath = notePath;
		this.activeSessionId = null;
		this.sessions = [];
		this.messages = [];
		this.isSessionMutating = false;
		this.abortActiveRequest();
		this.editTargetChoice = 'auto';
		this.followLatestMessages = true;
		this.responseStartMessageId = null;
		this.isThreadLoading = notePath !== null;
		this.render();
		if (!notePath) {
			return;
		}

		try {
			const loaded = await this.plugin.conversationStore.loadConversation(notePath);
			if (!this.isCurrentNoteLoad(notePath, generation)) {
				return;
			}
			const active = resolveActiveSession(loaded.conversation);
			if (active) {
				this.sessions = loaded.conversation.sessions;
				this.activeSessionId = active.id;
				this.messages = active.messages;
			} else {
				const transient = this.getTransientSession(notePath);
				this.sessions = [transient];
				this.activeSessionId = transient.id;
				this.messages = transient.messages;
			}
		} catch (error) {
			if (this.isCurrentNoteLoad(notePath, generation)) {
				new Notice(`Emend: Could not load this chat. ${getErrorMessage(error)}`);
			}
		} finally {
			if (this.isCurrentNoteLoad(notePath, generation)) {
				this.isThreadLoading = false;
				this.render();
			}
		}
	}

	async switchActiveSession(sessionId: string): Promise<void> {
		const notePath = this.notePath;
		const currentSessionId = this.activeSessionId;
		if (
			!notePath ||
			!currentSessionId ||
			sessionId === currentSessionId ||
			this.isThreadLoading ||
			this.isSessionMutating
		) {
			return;
		}
		const target = this.sessions.find((session) => session.id === sessionId);
		if (!target) {
			return;
		}
		const identity: ChatIdentity = {
			notePath,
			sessionId: currentSessionId,
			generation: this.conversationGeneration,
		};
		this.saveCurrentDraft();
		this.isSessionMutating = true;
		this.render();
		try {
			await this.plugin.conversationStore.setActiveSession(notePath, sessionId);
			if (!this.isCurrent(identity)) {
				return;
			}
			this.conversationGeneration++;
			this.abortActiveRequest();
			this.activeSessionId = target.id;
			this.messages = target.messages;
			this.followLatestMessages = true;
			this.responseStartMessageId = null;
			this.isSessionMutating = false;
			this.render();
		} catch (error) {
			if (!this.isCurrent(identity)) {
				return;
			}
			this.isSessionMutating = false;
			new Notice(`Emend: Could not switch chat session. ${getErrorMessage(error)}`);
			this.render();
		}
	}

	async createNewSession(): Promise<void> {
		const identity = this.beginSessionMutation();
		if (!identity) {
			return;
		}
		const { notePath } = identity;
		const current = this.sessions.find((session) => session.id === identity.sessionId);
		if (!current) {
			return;
		}
		this.saveCurrentDraft();
		this.isSessionMutating = true;
		this.render();
		try {
			if (this.sessions.length === 1 && this.transientSessionIds.has(current.id)) {
				const hasReadyUser = current.messages.some(
					(message) => message.role === 'user' && message.status === 'ready',
				);
				const recovered = await this.materializeTransientSession(notePath, current);
				if (!this.isCurrent(identity)) {
					return;
				}
				this.transientSessionIds.delete(current.id);
				if (this.transientSessions.get(notePath)?.id === current.id) {
					this.transientSessions.delete(notePath);
				}
				this.sessions = [recovered];
				this.activeSessionId = recovered.id;
				this.messages = recovered.messages;
				if (!hasReadyUser) {
					this.isSessionMutating = false;
					this.render();
					return;
				}
				this.render();
			}

			const created = await this.plugin.conversationStore.createSession(
				notePath,
				createChatSession({ id: createChatSessionId(), now: Date.now() }),
			);
			if (!this.isCurrent(identity)) {
				return;
			}
			this.sessions = [...this.sessions, created];
			this.drafts.get(notePath)?.delete(created.id);
			this.conversationGeneration++;
			this.abortActiveRequest();
			this.activeSessionId = created.id;
			this.messages = created.messages;
			this.followLatestMessages = true;
			this.responseStartMessageId = null;
			this.isSessionMutating = false;
			this.render();
		} catch (error) {
			this.failSessionMutation(identity, 'create', error);
		}
	}

	async renameActiveSession(title: string): Promise<void> {
		const identity = this.beginSessionMutation();
		if (!identity) {
			return;
		}
		const { notePath } = identity;
		const current = this.sessions.find((session) => session.id === identity.sessionId);
		if (!current) {
			return;
		}
		this.saveCurrentDraft();
		this.isSessionMutating = true;
		this.render();
		try {
			const normalizedTitle = normalizeManualTitle(title);
			if (this.transientSessionIds.has(current.id)) {
				const persisted = await this.materializeTransientSession(
					notePath,
					current,
					normalizedTitle,
				);
				if (!this.isCurrent(identity)) {
					return;
				}
				this.transientSessionIds.delete(current.id);
				if (this.transientSessions.get(notePath)?.id === current.id) {
					this.transientSessions.delete(notePath);
				}
				const index = this.sessions.findIndex((session) => session.id === current.id);
				this.sessions[index] = persisted;
				this.messages = persisted.messages;
			} else {
				const persisted = await this.plugin.conversationStore.renameSession(
					notePath,
					current.id,
					normalizedTitle,
				);
				if (!this.isCurrent(identity)) {
					return;
				}
				this.applyPersistedMetadata(current, persisted);
			}
			this.isSessionMutating = false;
			this.render();
		} catch (error) {
			this.failSessionMutation(identity, 'rename', error);
		}
	}

	async deleteActiveSession(): Promise<void> {
		const identity = this.beginSessionMutation();
		if (!identity) {
			return;
		}
		const { notePath } = identity;
		const current = this.sessions.find((session) => session.id === identity.sessionId);
		if (!current) {
			return;
		}
		if (this.transientSessionIds.has(current.id)) {
			const fresh = createChatSession({
				id: createChatSessionId(),
				now: Date.now(),
			});
			this.transientSessionIds.delete(current.id);
			this.transientSessionIds.add(fresh.id);
			this.transientSessions.set(notePath, fresh);
			this.drafts.get(notePath)?.delete(current.id);
			this.conversationGeneration++;
			this.abortActiveRequest();
			this.sessions = [fresh];
			this.activeSessionId = fresh.id;
			this.messages = fresh.messages;
			this.followLatestMessages = true;
			this.responseStartMessageId = null;
			this.render();
			return;
		}

		this.isSessionMutating = true;
		this.render();
		try {
			const result = await this.plugin.conversationStore.deleteSession(notePath, current.id);
			if (!this.isCurrent(identity)) {
				return;
			}
			const remaining = this.sessions.filter((session) => session.id !== current.id);
			this.drafts.get(notePath)?.delete(current.id);
			this.conversationGeneration++;
			this.abortActiveRequest();
			if (remaining.length === 0) {
				const transient = this.getTransientSession(notePath);
				this.sessions = [transient];
				this.activeSessionId = transient.id;
				this.messages = transient.messages;
			} else {
				const next = remaining.find(
					(session) => session.id === result.activeSessionId,
				) ?? remaining[0];
				if (!next) {
					throw new Error('Chat session fallback does not exist.');
				}
				this.sessions = remaining;
				this.activeSessionId = next.id;
				this.messages = next.messages;
			}
			this.followLatestMessages = true;
			this.responseStartMessageId = null;
			this.isSessionMutating = false;
			this.render();
		} catch (error) {
			this.failSessionMutation(identity, 'delete', error);
		}
	}

	async moveActiveSession(direction: -1 | 1): Promise<void> {
		const identity = this.beginSessionMutation();
		if (!identity) {
			return;
		}
		const { notePath } = identity;
		const index = this.sessions.findIndex((session) => session.id === identity.sessionId);
		const targetIndex = index + direction;
		if (index < 0 || targetIndex < 0 || targetIndex >= this.sessions.length) {
			return;
		}
		const orderedIds = this.sessions.map((session) => session.id);
		const [movedId] = orderedIds.splice(index, 1);
		if (!movedId) {
			return;
		}
		orderedIds.splice(targetIndex, 0, movedId);
		this.isSessionMutating = true;
		this.render();
		try {
			await this.plugin.conversationStore.reorderSessions(notePath, orderedIds);
			if (!this.isCurrent(identity)) {
				return;
			}
			const sessionsById = new Map(
				this.sessions.map((session) => [session.id, session]),
			);
			const reordered = orderedIds.flatMap((id) => {
				const session = sessionsById.get(id);
				return session ? [session] : [];
			});
			if (reordered.length !== this.sessions.length) {
				throw new Error('Chat session order does not match the current sessions.');
			}
			this.sessions = reordered;
			this.isSessionMutating = false;
			this.render();
		} catch (error) {
			this.failSessionMutation(identity, 'move', error);
		}
	}

	private beginSessionMutation(): ChatIdentity | null {
		const notePath = this.notePath;
		const sessionId = this.activeSessionId;
		if (
			!notePath ||
			!sessionId ||
			this.isSending ||
			this.isThreadLoading ||
			this.isSessionMutating
		) {
			return null;
		}
		const session = this.sessions.find((item) => item.id === sessionId);
		if (!session || this.messages !== session.messages) {
			return null;
		}
		return { notePath, sessionId, generation: this.conversationGeneration };
	}

	private async materializeTransientSession(
		notePath: string,
		session: ChatSession,
		manualTitle?: string,
	): Promise<ChatSession> {
		return this.plugin.conversationStore.createSession(
			notePath,
			createChatSession({
				id: session.id,
				now: Date.now(),
				title: manualTitle ?? session.title,
				titleSource: manualTitle === undefined ? session.titleSource : 'manual',
				messages: session.messages,
			}),
		);
	}

	private failSessionMutation(
		identity: ChatIdentity,
		action: 'create' | 'rename' | 'delete' | 'move',
		error: unknown,
	): void {
		if (!this.isCurrent(identity)) {
			return;
		}
		this.isSessionMutating = false;
		new Notice(`Emend: Could not ${action} chat session. ${getErrorMessage(error)}`);
		this.render();
	}

	private isCurrentNoteLoad(notePath: string, generation: number) {
		return !this.closed &&
			this.notePath === notePath &&
			this.conversationGeneration === generation &&
			this.plugin.getActiveNotePath() === notePath;
	}

	private isCurrent(identity: ChatIdentity) {
		return !this.closed &&
			this.notePath === identity.notePath &&
			this.activeSessionId === identity.sessionId &&
			this.conversationGeneration === identity.generation;
	}

	private isActiveRequest(request: ActiveRequest) {
		return this.activeRequest === request &&
			!request.controller.signal.aborted &&
			this.isCurrent(request.identity);
	}

	private requireActiveRequest(request: ActiveRequest) {
		request.controller.signal.throwIfAborted();
		if (!this.isActiveRequest(request)) {
			throw new DOMException('Response stopped.', 'AbortError');
		}
	}

	private scheduleRequestRender(request: ActiveRequest) {
		if (this.isActiveRequest(request)) {
			this.scheduleMessageRender(request.loadingMessage);
		}
	}

	private abortActiveRequest() {
		const controller = this.activeRequest?.controller ?? this.activeController;
		this.activeRequest = null;
		this.activeController = null;
		this.isSending = false;
		controller?.abort();
		this.webReviewModal?.close();
		this.webReviewModal = null;
	}

	private getTransientSession(notePath: string) {
		const cached = this.transientSessions.get(notePath);
		if (cached) {
			this.transientSessionIds.add(cached.id);
			return cached;
		}
		const session = createChatSession({
			id: createChatSessionId(),
			now: Date.now(),
		});
		this.transientSessions.set(notePath, session);
		this.transientSessionIds.add(session.id);
		return session;
	}

	private saveCurrentDraft() {
		if (this.notePath && this.activeSessionId && this.inputEl) {
			let noteDrafts = this.drafts.get(this.notePath);
			if (!noteDrafts) {
				noteDrafts = new Map<string, string>();
				this.drafts.set(this.notePath, noteDrafts);
			}
			noteDrafts.set(this.activeSessionId, this.inputEl.value);
		}
	}

	private currentDraft() {
		return this.notePath && this.activeSessionId
			? this.drafts.get(this.notePath)?.get(this.activeSessionId) ?? ''
			: '';
	}

	private refreshEditTargetControl() {
		if (!this.editTargetSelectEl) {
			return;
		}
		const editTarget = resolveEditTarget(
			this.editTargetChoice,
			this.plugin.hasUsableSelection(),
		);
		this.displayedEditTarget = editTarget;
		this.editTargetSelectEl.value = editTarget;
		this.editTargetSelectEl.disabled = this.isSending || this.isThreadLoading || this.isSessionMutating;
	}

	private refreshDraftEstimate(prompt = this.inputEl?.value ?? '') {
		if (!this.capacityDisplay) {
			return;
		}
		try {
			const target = this.captureDraftCapacityTarget(this.selectedMode);
			const actionTarget = this.captureActionCapacityTarget(target);
			const history = this.safeProviderHistory();
			const estimate = target
				? buildCapacityForTarget(
					this.plugin.settings,
					this.app,
					target,
					prompt,
					history,
				)
				: undefined;
			this.draftCapacityBlocked = estimate?.blocked ?? false;
			this.capacityDisplay.render(estimate);
			this.applyDraftCapacityControls(actionTarget, history);
		} catch {
			this.draftCapacityBlocked = false;
			this.capacityDisplay.render(undefined);
			this.applyDraftCapacityControls(undefined, []);
		}
	}

	private captureDraftCapacityTarget(
		mode: Mode,
	): DraftCapacityTarget | undefined {
		if (mode === 'edit') {
			if (this.displayedEditTarget === 'selection') {
				const snapshot = this.captureSelectionSnapshot();
				return snapshot
					? { type: 'selection', mode: 'edit', snapshot }
					: undefined;
			}
			const context = this.captureComposerContext();
			return context
				? { type: 'full-note', mode: 'edit', context }
				: undefined;
		}
		const context = this.captureComposerContext();
		return context ? { type: 'read-only', mode, context } : undefined;
	}

	private captureSelectionSnapshot(): SelectionSnapshot | undefined {
		try {
			return this.plugin.captureSelectionEditTarget().snapshot;
		} catch {
			return undefined;
		}
	}

	private captureComposerContext(): RequestContext | undefined {
		try {
			return this.plugin.captureChatContext();
		} catch {
			return undefined;
		}
	}

	private captureActionCapacityTarget(
		draftTarget: DraftCapacityTarget | undefined,
	): DraftCapacityTarget | undefined {
		if (this.displayedEditTarget === 'selection') {
			return this.selectedMode === 'edit'
				? draftTarget
				: this.captureDraftCapacityTarget('edit');
		}
		if (draftTarget?.type === 'read-only') {
			return {
				type: 'full-note',
				mode: 'edit',
				context: draftTarget.context,
			};
		}
		return draftTarget;
	}

	private applyDraftCapacityControls(
		actionTarget: DraftCapacityTarget | undefined,
		history: ProviderHistoryMessage[],
	) {
		if (this.sendButtonEl && !this.isSending) {
			this.sendButtonEl.disabled = this.isThreadLoading ||
				this.isSessionMutating ||
				this.draftCapacityBlocked;
		}
		const quickActionsDisabled = this.isSessionMutating || areQuickActionsDisabled({
			notePath: this.notePath,
			isSending: this.isSending,
			isThreadLoading: this.isThreadLoading,
		});
		for (const { action, button } of this.quickActionButtons) {
			const { estimate } = this.getQuickActionCapacity(
				action,
				actionTarget,
				history,
			);
			button.disabled = quickActionsDisabled || (estimate?.blocked ?? false);
		}
	}

	private getQuickActionCapacity(
		action: QuickAction,
		actionTarget: DraftCapacityTarget | undefined,
		history: ProviderHistoryMessage[],
	): {
		estimate: DraftCapacityEstimate | undefined;
		blockMessage: string | undefined;
	} {
		const estimate = actionTarget
			? buildCapacityForTarget(
				this.plugin.settings,
				this.app,
				actionTarget,
				action.prompt,
				history,
			)
			: undefined;
		return {
			estimate,
			blockMessage: formatDraftCapacityBlockMessage(estimate),
		};
	}

	private evaluateQuickActionCapacity(action: QuickAction) {
		return this.getQuickActionCapacity(
			action,
			this.captureDraftCapacityTarget(action.mode),
			this.safeProviderHistory(),
		);
	}

	private safeProviderHistory(): ProviderHistoryMessage[] {
		try {
			return this.toProviderHistory();
		} catch {
			return [];
		}
	}

	private render() {
		const previousScrollTop = this.messagesEl?.scrollTop ?? 0;
		const wasFollowing = this.followLatestMessages;
		this.renderGeneration++;
		this.pendingMarkdownRenders = 0;
		this.pendingScrollRestore = null;
		this.cancelPendingRender();
		this.pendingMessages.clear();
		this.messageBodyEls.clear();
		this.additionalNotesControl?.destroy();
		this.sessionControls?.destroy();
		this.sessionControls = null;
		this.capacityDisplay?.destroy();
		this.capacityDisplay = null;
		this.sendButtonEl = null;
		this.quickActionButtons = [];
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('emend-chat-view');

		const headerEl = contentEl.createDiv('emend-chat-header');
		const titleRowEl = headerEl.createDiv('emend-chat-title-row');
		titleRowEl.createDiv({ cls: 'emend-chat-title', text: 'Emend' });
		titleRowEl.createSpan({ cls: 'emend-chat-build', text: EMEND_BUILD_ID });
		this.sessionControls = new ChatSessionControls(headerEl, {
			onNew: () => {
				void this.createNewSession();
			},
			onSwitch: (sessionId) => {
				void this.switchActiveSession(sessionId);
			},
			onRename: (title) => {
				void this.renameActiveSession(title);
			},
			onDelete: () => {
				void this.deleteActiveSession();
			},
			onMove: (direction) => {
				void this.moveActiveSession(direction);
			},
		}, this.app);
		this.sessionControls.render({
			sessions: this.sessions,
			activeSessionId: this.activeSessionId,
			disabled: this.isSending || this.isThreadLoading || this.isSessionMutating,
		});
		const shortcutsEl = headerEl.createDiv('emend-chat-shortcuts');
		const modeGroupEl = shortcutsEl.createDiv('emend-chat-shortcut-group');
		modeGroupEl.createSpan({
			cls: 'emend-chat-shortcuts-label',
			text: 'Default shortcuts',
		});
		const composerGroupEl = shortcutsEl.createDiv('emend-chat-shortcut-group');
		for (const [index, shortcut] of getDefaultShortcutLabels(Platform.isMacOS).entries()) {
			const groupEl = index < 2 ? modeGroupEl : composerGroupEl;
			const itemEl = groupEl.createSpan({ cls: 'emend-chat-shortcut' });
			itemEl.createEl('kbd', { text: shortcut.keys });
			itemEl.createSpan({ text: shortcut.action });
		}
		headerEl.createDiv({
			cls: 'emend-chat-context',
			text: this.plugin.getActiveNoteLabel(),
		});

		const modeSelectorEl = contentEl.createDiv('emend-chat-mode-selector');
		for (const mode of MODES) {
			const button = modeSelectorEl.createEl('button', {
				cls: `emend-chat-mode-button${this.selectedMode === mode.id ? ' is-active' : ''}`,
				attr: {
					'aria-pressed': String(this.selectedMode === mode.id),
					title: mode.label,
				},
			});
			setIcon(button, mode.icon);
			button.createSpan({ text: mode.label });
			button.disabled = this.isSending || this.isSessionMutating;
			button.addEventListener('click', () => {
				this.setMode(mode.id);
			});
		}

		this.capacityDisplay = new ContextCapacityDisplay(contentEl);

		const messagesEl = contentEl.createDiv('emend-chat-messages');
		this.messagesEl = messagesEl;
		messagesEl.addEventListener('scroll', () => {
			this.followLatestMessages =
				messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <= 24;
		});
		if (this.messages.length === 0) {
			this.renderEmptyState(messagesEl);
		} else {
			for (const message of this.messages) {
				this.renderMessage(messagesEl, message);
			}
		}

		const quickActionsEl = contentEl.createDiv('emend-chat-quick-actions');
		const quickActionsDisabled = this.isSessionMutating || areQuickActionsDisabled({
			notePath: this.notePath,
			isSending: this.isSending,
			isThreadLoading: this.isThreadLoading,
		});
		for (const action of QUICK_ACTIONS) {
			const button = quickActionsEl.createEl('button', {
				cls: 'emend-chat-quick-action',
				text: action.label,
				attr: { 'data-action-id': action.id },
			});
			button.disabled = quickActionsDisabled;
			button.addEventListener('click', () => {
				void this.submitQuickAction(action);
			});
			this.quickActionButtons.push({ action, button });
		}

		this.additionalNotesControl = new AdditionalNotesControl(
			this.app,
			this.plugin.additionalNotesStore,
			() => this.notePath,
		);
		this.additionalNotesControl.render(
			contentEl,
			this.isSending || this.isThreadLoading || this.isSessionMutating,
		);

		const composerEl = contentEl.createDiv('emend-chat-composer');
		this.inputEl = composerEl.createEl('textarea', {
			cls: 'emend-chat-input',
			attr: {
				placeholder: MODE_PLACEHOLDERS[this.selectedMode],
				rows: '4',
			},
		});
		this.inputEl.value = this.currentDraft();
		this.inputEl.disabled = this.isSending || this.isThreadLoading || this.isSessionMutating;
		this.inputEl.addEventListener('keydown', (event) => {
			this.handleComposerKeydown(event);
		});
		this.inputEl.addEventListener('input', () => {
			this.refreshDraftEstimate();
		});

		const actionsEl = composerEl.createDiv('emend-chat-composer-actions');
		const webLabelEl = actionsEl.createEl('label', { cls: 'emend-chat-web-mode' });
		webLabelEl.createSpan({ text: 'Web' });
		const webSelectEl = webLabelEl.createEl('select', {
			attr: { 'aria-label': 'Web search mode' },
		});
		webSelectEl.title = WEB_SEARCH_DISCLOSURE;
		for (const [value, label] of [
			['off', 'Off'],
			['review', 'Review'],
			['auto', 'Auto'],
		] as const) {
			webSelectEl.createEl('option', { text: label, attr: { value } });
		}
		webSelectEl.value = this.webSearchMode ?? 'off';
		webSelectEl.disabled = this.isSending || this.isThreadLoading || this.isSessionMutating || this.selectedMode === 'edit';
		webSelectEl.addEventListener('change', () => {
			const value = webSelectEl.value;
			if (value !== 'off' && value !== 'review' && value !== 'auto') {
				return;
			}
			const draft = this.inputEl?.value ?? '';
			this.webSearchMode = value;
			this.render();
			if (this.inputEl) {
				this.inputEl.value = draft;
			}
			if (this.capacityDisplay) {
				this.refreshDraftEstimate(draft);
			}
		});
		const editTargetLabelEl = actionsEl.createEl('label', {
			cls: 'emend-chat-edit-target',
		});
		editTargetLabelEl.createSpan({ text: 'Edit target' });
		this.editTargetSelectEl = editTargetLabelEl.createEl('select', {
			attr: { 'aria-label': 'Edit target' },
		});
		// eslint-disable-next-line obsidianmd/ui/sentence-case -- Required Task 2 tooltip.
		this.editTargetSelectEl.title = 'Applies to Edit and quick actions.';
		for (const [value, label] of [
			['full-note', 'Full note'],
			['selection', 'Selection'],
		] as const) {
			this.editTargetSelectEl.createEl('option', { text: label, attr: { value } });
		}
		this.editTargetSelectEl.addEventListener('change', () => {
			const value = this.editTargetSelectEl?.value;
			if (value !== 'full-note' && value !== 'selection') {
				return;
			}
			this.editTargetChoice = value;
			this.refreshEditTargetControl();
			this.refreshDraftEstimate();
		});
		this.activeModelEl = actionsEl.createDiv({
			cls: 'emend-chat-active-model',
			text: this.getActiveModelLabel(),
		});
		const actionButton = actionsEl.createEl('button', {
			cls: this.isSending
				? 'emend-chat-secondary-button'
				: 'emend-chat-primary-button',
			text: this.isSending ? 'Stop' : 'Send',
		});
		actionButton.disabled = !this.isSending && this.isThreadLoading;
		this.sendButtonEl = actionButton;
		actionButton.addEventListener('click', () => {
			if (this.isSending) {
				this.activeController?.abort();
				actionButton.disabled = true;
				actionButton.textContent = 'Stopping...';
			} else {
				void this.submitPrompt();
			}
		});
		this.refreshEditTargetControl();
		this.refreshDraftEstimate();
		this.pendingScrollRestore = { previousScrollTop, wasFollowing };
		if (this.pendingMarkdownRenders === 0) {
			this.settleMarkdownRender(this.renderGeneration);
		}
	}

	private renderEmptyState(containerEl: HTMLElement) {
		const emptyEl = containerEl.createDiv('emend-chat-empty');
		emptyEl.createDiv({
			cls: 'emend-chat-empty-title',
			text: 'Chat with the active note',
		});
		emptyEl.createDiv({
			cls: 'emend-chat-empty-body',
			text: 'Ask, discuss, or brainstorm in chat. Edit applies validated CriticMarkup for review in Track Changes.',
		});
	}

	private renderMessage(containerEl: HTMLElement, message: ChatMessage) {
		const messageEl = containerEl.createDiv({
			cls: `emend-chat-message is-${message.role} is-${message.status}`,
			attr: { 'data-message-id': message.id },
		});
		const headerEl = messageEl.createDiv('emend-chat-message-header');
		const labelsEl = headerEl.createDiv('emend-chat-message-labels');
		labelsEl.createDiv({
			cls: 'emend-chat-message-label',
			text: message.role === 'user' ? 'You' : 'Emend',
		});
		labelsEl.createDiv({
			cls: 'emend-chat-mode-badge',
			text: getModeLabel(message.mode),
		});
		if (message.webSearchMode) {
			labelsEl.createDiv({
				cls: 'emend-chat-mode-badge',
				text: `Web: ${message.webSearchMode === 'review' ? 'Review' : 'Auto'}`,
			});
		}
		if (message.status === 'stopped') {
			labelsEl.createDiv({
				cls: 'emend-chat-mode-badge',
				text: 'Stopped',
			});
		}

		if (
			message.role === 'assistant' &&
			(message.status === 'ready' || message.status === 'stopped') &&
			message.content
		) {
			const copyButton = headerEl.createEl('button', {
				cls: 'emend-chat-copy-button',
				text: 'Copy',
			});
			copyButton.addEventListener('click', () => {
				void copyToClipboard(formatChatMessageForCopy(message));
			});
		}

		const bodyEl = messageEl.createDiv('emend-chat-message-body');
		this.messageBodyEls.set(message.id, bodyEl);
		this.renderMessageBody(message);
		if (message.role === 'assistant' && message.status === 'ready') {
			renderWebActivities(messageEl, message.webActivities);
			renderWebSources(messageEl, message.webSources);
		}
		if (
			message.role === 'assistant' &&
			message.status === 'ready' &&
			message.usage
		) {
			messageEl.createDiv({
				cls: 'emend-chat-message-usage',
				text: formatTokenUsage(message.usage),
			});
		}
	}

	private renderMessageBody(message: ChatMessage) {
		const bodyEl = this.messageBodyEls.get(message.id);
		if (!bodyEl || this.closed) {
			return;
		}
		bodyEl.empty();

		if (message.status === 'loading' && message.webActivity) {
			bodyEl.createDiv({
				cls: 'emend-chat-web-activity',
				text: message.webActivity,
			});
		}

		if (message.reasoning) {
			const detailsEl = bodyEl.createEl('details', {
				cls: 'emend-chat-reasoning',
			});
			detailsEl.open = false;
			detailsEl.createEl('summary', { text: 'Reasoning' });
			detailsEl.createDiv({
				cls: 'emend-chat-reasoning-content',
				text: message.reasoning,
			});
		}

		if (!message.content) {
			if (message.status === 'loading') {
				bodyEl.createDiv({
					cls: 'emend-chat-message-content',
					text: message.reasoning ? '' : 'Waiting for a response...',
				});
			}
			return;
		}

		if (message.role === 'user' || message.status === 'error' || message.status === 'loading') {
			bodyEl.createDiv({
				cls: 'emend-chat-message-content',
				text: message.content,
			});
			return;
		}

		const currentContentEl = bodyEl.createDiv('emend-chat-message-content');
		const renderedEl = bodyEl.ownerDocument.createElement('div');
		renderedEl.className = 'emend-chat-message-content';
		const generation = this.renderGeneration;
		this.pendingMarkdownRenders = (this.pendingMarkdownRenders ?? 0) + 1;
		void MarkdownRenderer.render(
			this.app,
			message.content,
			renderedEl,
			message.sourcePath,
			this,
		)
			.then(() => {
				if (!this.closed && currentContentEl.isConnected) {
					currentContentEl.replaceWith(renderedEl);
					this.scrollMessagesToBottomIfFollowing();
				}
				this.settleMarkdownRender(generation);
			})
			.catch(() => {
				if (!this.closed && currentContentEl.isConnected) {
					currentContentEl.textContent = message.content;
					this.scrollMessagesToBottomIfFollowing();
				}
				this.settleMarkdownRender(generation);
			});
	}

	private scrollMessagesToBottom() {
		if (this.closed || !this.messagesEl) {
			return;
		}
		this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
	}

	private scrollMessagesToBottomIfFollowing() {
		if (this.followLatestMessages) {
			this.scrollMessagesToBottom();
		}
	}

	private restoreMessageScroll(previousScrollTop: number, wasFollowing: boolean) {
		if (wasFollowing) {
			this.scrollMessagesToBottom();
			return;
		}
		if (this.messagesEl) {
			this.messagesEl.scrollTop = previousScrollTop;
		}
	}

	private settleMarkdownRender(generation: number) {
		if (generation !== this.renderGeneration) {
			return;
		}
		this.pendingMarkdownRenders = Math.max(0, (this.pendingMarkdownRenders ?? 0) - 1);
		if (this.pendingMarkdownRenders > 0) {
			return;
		}
		const responseStartMessageId = this.responseStartMessageId;
		this.responseStartMessageId = null;
		const restore = this.pendingScrollRestore;
		this.pendingScrollRestore = null;
		if (responseStartMessageId) {
			const messageEl = this.messagesEl?.querySelector<HTMLElement>(
				`[data-message-id="${responseStartMessageId}"]`,
			);
			if (this.messagesEl && messageEl) {
				const scrollerTop = this.messagesEl.getBoundingClientRect().top;
				const messageTop = messageEl.getBoundingClientRect().top;
				this.messagesEl.scrollTop += messageTop - scrollerTop;
			}
			return;
		}
		if (restore) {
			this.restoreMessageScroll(restore.previousScrollTop, restore.wasFollowing);
		}
	}

	private scheduleMessageRender(message: ChatMessage) {
		if (this.closed) {
			return;
		}
		this.pendingMessages.add(message);
		if (this.pendingRenderFrame !== null) {
			return;
		}

		const view = this.contentEl.ownerDocument.defaultView ?? window;
		this.pendingRenderFrame = view.requestAnimationFrame(() => {
			this.pendingRenderFrame = null;
			const messages = Array.from(this.pendingMessages);
			this.pendingMessages.clear();
			for (const pendingMessage of messages) {
				this.renderMessageBody(pendingMessage);
			}
			this.scrollMessagesToBottomIfFollowing();
		});
	}

	private cancelPendingRender() {
		if (this.pendingRenderFrame !== null) {
			const view = this.contentEl.ownerDocument.defaultView ?? window;
			view.cancelAnimationFrame(this.pendingRenderFrame);
			this.pendingRenderFrame = null;
		}
	}

	private registerComposerScope() {
		this.scope = new Scope(this.app.scope);
		this.scope.register(['Mod'], 'Enter', (event) => {
			if (event.target !== this.inputEl) {
				return;
			}
			this.handleComposerKeydown(event);
			return false;
		});
	}

	private handleComposerKeydown(event: KeyboardEvent) {
		const shortcut = getComposerShortcut(event, {
			isSending: this.isSending || this.isSessionMutating,
			isThreadLoading: this.isThreadLoading,
		});
		if (shortcut === 'send') {
			event.preventDefault();
			void this.submitPrompt();
		}
	}

	private async submitQuickAction(action: QuickAction) {
		if (this.isSessionMutating || areQuickActionsDisabled({
			notePath: this.notePath,
			isSending: this.isSending,
			isThreadLoading: this.isThreadLoading,
		})) {
			return;
		}
		const { blockMessage } = this.evaluateQuickActionCapacity(action);
		if (blockMessage) {
			this.refreshDraftEstimate();
			new Notice(`Emend: ${blockMessage}`);
			return;
		}
		this.selectedMode = action.mode;
		await this.submitPrompt(action.prompt, { fromQuickAction: true });
	}

	private async submitPrompt(
		prompt = this.inputEl?.value.trim() ?? '',
		options?: { fromQuickAction?: boolean },
	) {
		if (!prompt || this.isSending || this.isThreadLoading || this.isSessionMutating) {
			return;
		}
		const notePath = this.notePath;
		const sessionId = this.activeSessionId;
		const session = this.sessions.find((item) => item.id === sessionId);
		if (!notePath || !sessionId || !session || this.messages !== session.messages) {
			return;
		}

		const requestedMode = this.selectedMode;
		let capturedTarget: CapturedDraftTarget;
		try {
			if (requestedMode === 'edit') {
				capturedTarget = this.displayedEditTarget === 'selection'
					? {
						type: 'selection',
						mode: requestedMode,
						target: this.plugin.captureSelectionEditTarget(),
					}
					: {
						type: 'full-note',
						mode: requestedMode,
						context: this.plugin.captureChatContext(),
					};
			} else {
				capturedTarget = {
					type: 'read-only',
					mode: requestedMode,
					context: this.plugin.captureChatContext(),
				};
			}
		} catch (error) {
			new Notice(`Emend: ${getErrorMessage(error)}`);
			const draft = this.inputEl?.value ?? '';
			this.render();
			if (this.inputEl) {
				this.inputEl.value = draft;
			}
			return;
		}

		const history = this.toProviderHistory();
		const mode = capturedTarget.mode;
		const webSearchMode: WebSearchMode = mode === 'edit'
			? 'off'
			: this.webSearchMode ?? 'off';
		const sourcePath = capturedTarget.type === 'selection'
			? capturedTarget.target.snapshot.file.path
			: capturedTarget.context.file.path;
		if (sourcePath !== notePath) {
			new Notice('Emend: The active note changed before the request started. Try again.');
			return;
		}
		const additionalNotePaths =
			this.plugin.additionalNotesStore?.list(notePath) ?? [];
		const capacityBlockMessage = formatDraftCapacityBlockMessage(
			buildCapacityForTarget(
				this.plugin.settings,
				this.app,
				toDraftCapacityTarget(capturedTarget),
				prompt,
				history,
			),
		);
		if (capacityBlockMessage) {
			new Notice(`Emend: ${capacityBlockMessage}`);
			this.refreshDraftEstimate();
			if (options?.fromQuickAction) {
				const draft = this.inputEl?.value ?? '';
				this.render();
				if (this.inputEl) {
					this.inputEl.value = draft;
				}
				if (this.capacityDisplay) {
					this.refreshDraftEstimate(draft);
				}
			}
			return;
		}
		const identity: ChatIdentity = {
			notePath,
			sessionId,
			generation: this.conversationGeneration,
		};
		const userMessage: ChatMessage = {
			id: createMessageId(),
			role: 'user',
			content: prompt,
			reasoning: '',
			mode,
			sourcePath,
			status: 'ready',
			timestamp: Date.now(),
			...(webSearchMode !== 'off' ? { webSearchMode } : {}),
		};
		const loadingMessage: ChatMessage = {
			id: createMessageId(),
			role: 'assistant',
			content: '',
			reasoning: '',
			mode,
			sourcePath,
			status: 'loading',
			timestamp: Date.now(),
		};
		const controller = new AbortController();
		const request: ActiveRequest = { identity, controller, loadingMessage };
		let finalSaveAttempted = false;

		this.drafts.get(notePath)?.delete(sessionId);
		session.messages.push(userMessage, loadingMessage);
		this.activeRequest = request;
		this.activeController = controller;
		this.isSending = true;
		this.responseStartMessageId = null;
		this.followLatestMessages = true;
		this.render();

		try {
			const persistedUser = await this.persistMessages(
				notePath,
				session.messages.filter((message) => message.status === 'ready'),
				{ session, message: userMessage, request },
			);
			this.requireActiveRequest(request);
			this.applyPersistedMetadata(session, persistedUser);
			if (capturedTarget.type !== 'read-only') {
				const callbacks = {
					onReasoning: (text: string) => {
						loadingMessage.reasoning += text;
						this.scheduleRequestRender(request);
					},
					onRetry: () => {
						loadingMessage.reasoning = '';
						this.scheduleRequestRender(request);
					},
				};
				const result = capturedTarget.type === 'selection'
					? await this.plugin.requestSelectionEdit(
						capturedTarget.target.snapshot,
						prompt,
						controller.signal,
						capturedTarget.target.editor,
						additionalNotePaths,
						history,
						callbacks,
					)
					: await this.plugin.requestChatCompletion({
						context: capturedTarget.context,
						mode: capturedTarget.mode,
						prompt,
						history,
						additionalNotePaths,
						callbacks,
						signal: controller.signal,
					});
				const summaryText = capturedTarget.type === 'selection'
					? capturedTarget.target.snapshot.fullText
					: capturedTarget.context.sourceText;
				const summaryOffset = capturedTarget.type === 'selection'
					? capturedTarget.target.snapshot.from
					: 0;
				loadingMessage.content = result.applied
					? formatEditSummary(
						result.changeCount,
						result.summaryItems,
						summaryText,
						summaryOffset,
						{
							target: capturedTarget.type === 'selection' ? 'selection' : 'full-note',
							summary: result.summary,
						},
					)
					: formatNoChangeSummary(result.summary);
				loadingMessage.usage = result.usage;
			} else {
				const result = await this.plugin.requestChatCompletion({
					context: capturedTarget.context,
					mode: capturedTarget.mode,
					prompt,
					history,
					additionalNotePaths,
					callbacks: {
						onContent: (text) => {
							loadingMessage.content += text;
							this.scheduleRequestRender(request);
						},
						onReasoning: (text) => {
							loadingMessage.reasoning += text;
							this.scheduleRequestRender(request);
						},
					},
					signal: controller.signal,
					...(webSearchMode !== 'off'
						? {
							webSearch: {
								mode: webSearchMode,
								maxToolCalls: this.plugin.settings.maxWebToolCalls,
								maxContentCharactersPerCall: this.plugin.settings.maxWebContentCharactersPerCall,
								reviewCalls: (calls: readonly WebToolCall[]) =>
									this.reviewWebCalls(calls, controller.signal),
								onActivity: (activity: WebSearchActivity) => {
									loadingMessage.webActivity = activity.label;
									this.scheduleRequestRender(request);
								},
							},
						}
						: {}),
				});
				loadingMessage.usage = result.usage;
				loadingMessage.webSources = result.sources;
				loadingMessage.webActivities = result.activities;
				const unreadPages = getUnreadPageCount(result.activities);
				if (unreadPages > 0) {
					loadingMessage.content += `${loadingMessage.content ? '\n\n' : ''}Emend could not read ${unreadPages} requested page${unreadPages === 1 ? '' : 's'}. The answer may be incomplete.`;
				}
				if (result.failedExtractions > 0) {
					loadingMessage.content += `${loadingMessage.content ? '\n\n' : ''}${formatExtractionWarning(result.failedExtractions)}`;
				}
				if (result.failedSearches > 0) {
					loadingMessage.content += `${loadingMessage.content ? '\n\n' : ''}${formatSearchWarning(result.failedSearches)}`;
				}
				if (result.omittedEvidence) {
					loadingMessage.content += `${loadingMessage.content ? '\n\n' : ''}Emend omitted some extracted evidence to fit the per-call output cap. The answer may be incomplete.`;
				}
				if (result.skippedWebCalls > 0) {
					const skipped = result.skippedWebCalls;
					loadingMessage.content += `${loadingMessage.content ? '\n\n' : ''}Web retrieval reached the ${this.plugin.settings.maxWebToolCalls}-call limit. ${skipped} proposed ${skipped === 1 ? 'call was' : 'calls were'} skipped; the answer may be incomplete.`;
				}
			}
			controller.signal.throwIfAborted();
			const readyAssistant: ChatMessage = { ...loadingMessage, status: 'ready' };
			finalSaveAttempted = true;
			const persistedAssistant = await this.persistMessages(
				notePath,
				[
					...session.messages.filter((message) => message.status === 'ready'),
					readyAssistant,
				],
				{
					session,
					message: readyAssistant,
					request,
					titlePrompt: userMessage.content,
				},
			);
			this.requireActiveRequest(request);
			loadingMessage.status = 'ready';
			this.applyPersistedMetadata(session, persistedAssistant);
		} catch (error) {
			if (controller.signal.aborted || isAbortError(error)) {
				loadingMessage.status = 'stopped';
				if (!loadingMessage.content && !loadingMessage.reasoning) {
					loadingMessage.content = 'Response stopped.';
				}
			} else {
				if (!finalSaveAttempted) {
					loadingMessage.content = getErrorMessage(error);
				}
				loadingMessage.status = 'error';
				if (this.isActiveRequest(request)) {
					new Notice(`Emend: ${finalSaveAttempted ? getErrorMessage(error) : loadingMessage.content}`);
				}
			}
		} finally {
			// An aborted request must still release itself; only a newer request suppresses cleanup.
			if (this.activeRequest === request) {
				this.activeRequest = null;
				if (this.activeController === controller) {
					this.activeController = null;
				}
				this.isSending = false;
				if (this.isCurrent(identity)) {
					if (loadingMessage.status === 'ready') {
						this.responseStartMessageId = loadingMessage.id;
						this.followLatestMessages = false;
					}
					this.render();
				}
			}
		}
	}

	private reviewWebCalls(
		calls: readonly WebToolCall[],
		signal: AbortSignal,
	): Promise<readonly WebToolCall[]> {
		return new Promise((resolve, reject) => {
			if (signal.aborted || this.activeRequest?.controller.signal !== signal) {
				reject(new Error('Response stopped.'));
				return;
			}
			const modal = new WebSearchModal(
				this.app,
				calls,
				(value) => {
					if (this.webReviewModal === modal) {
						this.webReviewModal = null;
					}
					resolve(value);
				},
				(error: unknown) => {
					if (this.webReviewModal === modal) {
						this.webReviewModal = null;
					}
					reject(error instanceof Error ? error : new Error(String(error)));
				},
				() => {
					if (this.activeRequest?.controller.signal === signal) {
						this.activeRequest.controller.abort();
					}
				},
			);
			this.webReviewModal = modal;
			signal.addEventListener('abort', () => {
				modal.close();
			}, { once: true });
			modal.open();
		});
	}

	private async persistMessages(
		notePath: string,
		messages: ChatMessage[],
		persistence: MessagePersistence,
	): Promise<ChatSession | undefined> {
		try {
			if (this.transientSessionIds.has(persistence.session.id)) {
				const persisted = await this.plugin.conversationStore.createSession(
					notePath,
					{ ...persistence.session, messages },
				);
				if (this.isActiveRequest(persistence.request)) {
					this.transientSessionIds.delete(persistence.session.id);
					if (this.transientSessions.get(notePath)?.id === persistence.session.id) {
						this.transientSessions.delete(notePath);
					}
				}
				return persisted;
			}
			return await this.plugin.conversationStore.appendReadyMessage(
				notePath,
				persistence.session.id,
				persistence.message,
				persistence.titlePrompt === undefined
					? undefined
					: {
						titlePrompt: persistence.titlePrompt,
						signal: persistence.request.controller.signal,
					},
			);
		} catch (error) {
			throw new Error(`Could not save this chat. ${getErrorMessage(error)}`);
		}
	}

	private applyPersistedMetadata(
		session: ChatSession,
		persisted: ChatSession | undefined,
	) {
		if (!persisted) {
			return;
		}
		session.title = persisted.title;
		session.titleSource = persisted.titleSource;
		session.createdAt = persisted.createdAt;
		session.updatedAt = persisted.updatedAt;
	}

	private toProviderHistory(): ProviderHistoryMessage[] {
		const limit = this.plugin.settings.historyMessageLimit;
		const ready = this.messages.filter((message) => message.status === 'ready');
		const selected = limit > 0 ? ready.slice(-limit) : [];
		return selected.map((message) => ({
			role: message.role,
			content: message.role === 'assistant'
				? formatChatMessageForCopy(message)
				: message.content,
			mode: message.mode,
			origin: message.role === 'user'
				? 'user'
				: message.mode === 'edit' ? 'local-edit-status' : 'model',
		}));
	}

	private getActiveModelLabel() {
		const provider = this.plugin.settings.providers[
			this.plugin.settings.activeProvider
		];
		const model = provider.model.trim();
		return model ? `${provider.name} · ${model}` : provider.name;
	}
}

interface VaultNameSource {
	vault: { getName(): string };
}

function toDraftCapacityTarget(
	capturedTarget: CapturedDraftTarget,
): DraftCapacityTarget {
	if (capturedTarget.type === 'selection') {
		return {
			type: 'selection',
			mode: 'edit',
			snapshot: capturedTarget.target.snapshot,
		};
	}
	if (capturedTarget.type === 'full-note') {
		return { type: 'full-note', mode: 'edit', context: capturedTarget.context };
	}
	return {
		type: 'read-only',
		mode: capturedTarget.mode,
		context: capturedTarget.context,
	};
}

function buildCapacityForTarget(
	settings: EmendSettings,
	app: VaultNameSource,
	target: DraftCapacityTarget,
	prompt: string,
	history: ProviderHistoryMessage[],
): DraftCapacityEstimate | undefined {
	if (!settings || !settings.providers) {
		return undefined;
	}
	const provider = settings.providers[settings.activeProvider];
	if (!provider) {
		return undefined;
	}
	switch (target.type) {
		case 'read-only':
			return buildReadOnlyDraftEstimate({
				provider,
				context: target.context,
				mode: target.mode,
				prompt,
				history,
			});
		case 'full-note':
			return buildFullNoteDraftEstimate({
				provider,
				context: target.context,
				prompt,
				history,
			});
		case 'selection':
			return buildSelectionDraftEstimate({
				provider,
				snapshot: target.snapshot,
				prompt,
				maxContextCharacters: normalizeContextLimit(
					settings.maxContextCharacters,
				),
				smartSelectionContext: settings.smartSelectionContext,
				notePath: settings.includeNotePathInContext
					? formatVaultQualifiedPath(
						app.vault.getName(),
						target.snapshot.file.path,
					)
					: undefined,
				history,
			});
	}
}

export function getUnreadPageCount(activities: WebActivityRecord[] | undefined) {
	const completedTargets = new Set(
		(activities ?? [])
			.filter((activity) => activity.type === 'fetch' && activity.status === 'completed')
			.map((activity) => activity.target),
	);
	return new Set(
		(activities ?? [])
			.filter((activity) =>
				activity.type === 'fetch' &&
				activity.status === 'failed' &&
				activity.failureKind !== 'extraction' &&
				!completedTargets.has(activity.target)
			)
			.map((activity) => activity.target),
	).size;
}

export function formatChatMessageForCopy(message: ChatMessage) {
	const sources = message.webSources ?? [];
	if (sources.length === 0) {
		return message.content;
	}
	const sourceList = sources.map((source) =>
		`- [${source.id}] [${source.title}](${source.url})`
	).join('\n');
	return `${message.content}\n\n### Sources\n${sourceList}`;
}

const WEB_FAILURE_REASON_LABELS: Record<string, string | undefined> = {
	network: 'network',
	http: 'HTTP',
	empty: 'empty page',
	reader: 'reader',
};

const WEB_READER_FAILURE_LABELS: Record<string, string | undefined> = {
	format: 'reader format',
	provider: 'reader service',
	limit: 'reader limit',
};

function formatWebFailureReason(activity: WebActivityRecord) {
	const attempts = activity.attempts !== undefined && activity.attempts > 1
		? `${activity.attempts} attempts`
		: undefined;
	const reason = formatWebFailureCategory(activity);
	if (!reason) {
		return attempts;
	}
	return attempts ? `${reason}, ${attempts}` : reason;
}

function formatWebFailureCategory(activity: WebActivityRecord) {
	if (!activity.failureReason) {
		return undefined;
	}
	if (activity.failureReason === 'http' && activity.failureStatus !== undefined) {
		return `HTTP ${activity.failureStatus}`;
	}
	if (activity.failureReason === 'reader' && activity.readerFailureKind) {
		return WEB_READER_FAILURE_LABELS[activity.readerFailureKind]
			?? WEB_FAILURE_REASON_LABELS.reader;
	}
	return WEB_FAILURE_REASON_LABELS[activity.failureReason];
}

function formatWebActivityText(activity: WebActivityRecord) {
	const type = activity.type === 'search' ? 'Search' : 'Fetch';
	const status = activity.status.charAt(0).toUpperCase() + activity.status.slice(1);
	const reason = activity.status === 'failed' ? formatWebFailureReason(activity) : undefined;
	const label = reason ? `${status} (${reason})` : status;
	return `${type} · ${label} · ${activity.target}`;
}

function renderWebActivities(
	containerEl: HTMLElement,
	activities: WebActivityRecord[] | undefined,
) {
	if (!activities?.length) {
		return;
	}
	const detailsEl = containerEl.createEl('details', { cls: 'emend-chat-web-activity' });
	detailsEl.open = false;
	detailsEl.createEl('summary', { text: `Web activity (${activities.length})` });
	for (const activity of activities) {
		detailsEl.createDiv({
			cls: 'emend-chat-web-activity-item',
			text: formatWebActivityText(activity),
		});
	}
}

function renderWebSources(containerEl: HTMLElement, sources: WebSource[] | undefined) {
	if (!sources?.length) {
		return;
	}
	const detailsEl = containerEl.createEl('details', { cls: 'emend-chat-web-sources' });
	detailsEl.open = false;
	detailsEl.createEl('summary', { text: `Sources (${sources.length})` });
	for (const source of sources) {
		const itemEl = detailsEl.createDiv('emend-chat-web-source');
		const anchorEl = itemEl.createEl('a', {
			text: `[${source.id}] ${source.title}`,
			attr: { href: source.url },
		});
		anchorEl.target = '_blank';
		anchorEl.rel = 'noopener noreferrer';
		if (source.snippet) {
			itemEl.createDiv({ cls: 'emend-chat-web-source-snippet', text: source.snippet });
		}
	}
}

function getModeLabel(mode: Mode) {
	return MODES.find((candidate) => candidate.id === mode)?.label ?? mode;
}

function createMessageId() {
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown) {
	return error instanceof Error && error.name === 'AbortError';
}

async function copyToClipboard(content: string) {
	try {
		await navigator.clipboard.writeText(content);
		new Notice('Copied to clipboard.');
	} catch (error) {
		new Notice(`Copy failed: ${getErrorMessage(error)}`);
	}
}
