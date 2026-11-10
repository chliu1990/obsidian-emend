import {
	ItemView,
	MarkdownRenderer,
	Notice,
	Platform,
	Scope,
	setIcon,
	WorkspaceLeaf,
} from 'obsidian';
import { AdditionalNotesControl } from './additional-notes-ui';
import { EMEND_BUILD_ID } from './build-info';
import type EmendPlugin from './main';
import { getComposerShortcut, getDefaultShortcutLabels } from './chat-shortcuts';
import type { RequestContext } from './context';
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
import { formatTokenUsage } from './token-usage';
import type { ChatMessage, Mode, ProviderHistoryMessage } from './types';
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

export class EmendChatView extends ItemView {
	private messages: ChatMessage[] = [];
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
	private noteLoadGeneration = 0;
	private additionalNotesControl: AdditionalNotesControl | null = null;
	private readonly drafts = new Map<string, string>();

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
		this.render();
		await this.refreshTargetNote();
	}

	protected async onClose() {
		this.closed = true;
		this.isThreadLoading = false;
		this.noteLoadGeneration++;
		this.notePath = null;
		this.activeController?.abort();
		this.webReviewModal?.close();
		this.webReviewModal = null;
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
		this.inputEl = null;
		this.editTargetSelectEl = null;
		this.contentEl.empty();
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
	}

	async refreshTargetNote() {
		const notePath = this.plugin.getActiveNotePath();
		if (notePath === this.notePath) {
			this.refreshEditTargetControl();
			return;
		}

		if (this.notePath && this.inputEl) {
			this.drafts.set(this.notePath, this.inputEl.value);
		}
		this.notePath = notePath;
		this.editTargetChoice = 'auto';
		this.followLatestMessages = true;
		const generation = ++this.noteLoadGeneration;
		if (this.isSending) {
			this.activeController?.abort();
		}
		this.messages = [];
		this.isThreadLoading = notePath !== null;
		this.render();
		if (!notePath) {
			return;
		}

		try {
			const messages = await this.plugin.conversationStore.load(notePath);
			if (
				this.closed ||
				generation !== this.noteLoadGeneration ||
				this.plugin.getActiveNotePath() !== notePath
			) {
				return;
			}
			this.messages = messages;
		} catch (error) {
			if (generation === this.noteLoadGeneration && !this.closed) {
				new Notice(`Emend: Could not load this chat. ${getErrorMessage(error)}`);
			}
		} finally {
			if (generation === this.noteLoadGeneration && !this.closed) {
				this.isThreadLoading = false;
				this.render();
			}
		}
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
		this.editTargetSelectEl.disabled = this.isSending || this.isThreadLoading;
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
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('emend-chat-view');

		const headerEl = contentEl.createDiv('emend-chat-header');
		const titleRowEl = headerEl.createDiv('emend-chat-title-row');
		titleRowEl.createDiv({ cls: 'emend-chat-title', text: 'Emend' });
		titleRowEl.createSpan({ cls: 'emend-chat-build', text: EMEND_BUILD_ID });
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
			button.disabled = this.isSending;
			button.addEventListener('click', () => {
				this.setMode(mode.id);
			});
		}

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
		const quickActionsDisabled = areQuickActionsDisabled({
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
		}

		this.additionalNotesControl = new AdditionalNotesControl(
			this.app,
			this.plugin.additionalNotesStore,
			() => this.notePath,
		);
		this.additionalNotesControl.render(
			contentEl,
			this.isSending || this.isThreadLoading,
		);

		const composerEl = contentEl.createDiv('emend-chat-composer');
		this.inputEl = composerEl.createEl('textarea', {
			cls: 'emend-chat-input',
			attr: {
				placeholder: MODE_PLACEHOLDERS[this.selectedMode],
				rows: '4',
			},
		});
		this.inputEl.value = this.notePath
			? this.drafts.get(this.notePath) ?? ''
			: '';
		this.inputEl.disabled = this.isSending || this.isThreadLoading;
		this.inputEl.addEventListener('keydown', (event) => {
			this.handleComposerKeydown(event);
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
		webSelectEl.disabled = this.isSending || this.isThreadLoading || this.selectedMode === 'edit';
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
			isSending: this.isSending,
			isThreadLoading: this.isThreadLoading,
		});
		if (shortcut === 'send') {
			event.preventDefault();
			void this.submitPrompt();
		}
	}

	private async submitQuickAction(action: QuickAction) {
		if (areQuickActionsDisabled({
			notePath: this.notePath,
			isSending: this.isSending,
			isThreadLoading: this.isThreadLoading,
		})) {
			return;
		}
		this.selectedMode = action.mode;
		await this.submitPrompt(action.prompt);
	}

	private async submitPrompt(prompt = this.inputEl?.value.trim() ?? '') {
		if (!prompt || this.isSending || this.isThreadLoading) {
			return;
		}

		const requestedMode = this.selectedMode;
		let capturedTarget:
			| { type: 'full-note'; mode: 'edit'; context: RequestContext }
			| { type: 'selection'; mode: 'edit'; target: SelectionEditTarget }
			| { type: 'read-only'; mode: Exclude<Mode, 'edit'>; context: RequestContext };
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
		const additionalNotePaths =
			this.plugin.additionalNotesStore?.list(sourcePath) ?? [];
		const noteMessages = this.messages;
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

		this.drafts?.delete(sourcePath);
		this.messages.push({
			id: createMessageId(),
			role: 'user',
			content: prompt,
			reasoning: '',
			mode,
			sourcePath,
			status: 'ready',
			timestamp: Date.now(),
			...(webSearchMode !== 'off' ? { webSearchMode } : {}),
		});
		this.messages.push(loadingMessage);
		this.activeController = controller;
		this.isSending = true;
		this.responseStartMessageId = null;
		this.followLatestMessages = true;
		this.render();

		try {
			await this.persistMessages(
				sourcePath,
				noteMessages.filter((message) => message.status === 'ready'),
			);
			controller.signal.throwIfAborted();
			if (capturedTarget.type !== 'read-only') {
				const callbacks = {
					onReasoning: (text: string) => {
						loadingMessage.reasoning += text;
						this.scheduleMessageRender(loadingMessage);
					},
					onRetry: () => {
						loadingMessage.reasoning = '';
						this.scheduleMessageRender(loadingMessage);
					},
				};
				const result = capturedTarget.type === 'selection'
					? await this.plugin.requestSelectionEdit(
						capturedTarget.target.snapshot,
						prompt,
						controller.signal,
						capturedTarget.target.editor,
						additionalNotePaths,
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
				loadingMessage.content = result.applied
					? `Edit applied — ${result.changeCount} changes tracked. Review in Track Changes.`
					: 'No changes were needed.';
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
							this.scheduleMessageRender(loadingMessage);
						},
						onReasoning: (text) => {
							loadingMessage.reasoning += text;
							this.scheduleMessageRender(loadingMessage);
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
									this.scheduleMessageRender(loadingMessage);
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
				if (result.skippedWebCalls > 0) {
					const skipped = result.skippedWebCalls;
					loadingMessage.content += `${loadingMessage.content ? '\n\n' : ''}Web retrieval reached the ${this.plugin.settings.maxWebToolCalls}-call limit. ${skipped} proposed ${skipped === 1 ? 'call was' : 'calls were'} skipped; the answer may be incomplete.`;
				}
			}
			controller.signal.throwIfAborted();
			loadingMessage.status = 'ready';
			await this.persistMessages(
				sourcePath,
				noteMessages.filter((message) => message.status === 'ready'),
			);
		} catch (error) {
			if (controller.signal.aborted || isAbortError(error)) {
				loadingMessage.status = 'stopped';
				if (!loadingMessage.content && !loadingMessage.reasoning) {
					loadingMessage.content = 'Response stopped.';
				}
			} else {
				loadingMessage.content = getErrorMessage(error);
				loadingMessage.status = 'error';
				new Notice(`Emend: ${loadingMessage.content}`);
			}
		} finally {
			this.activeController = null;
			this.isSending = false;
			if (!this.closed) {
				if (loadingMessage.status === 'ready') {
					this.responseStartMessageId = loadingMessage.id;
					this.followLatestMessages = false;
				}
				this.render();
			}
		}
	}

	private reviewWebCalls(
		calls: readonly WebToolCall[],
		signal: AbortSignal,
	): Promise<readonly WebToolCall[]> {
		return new Promise((resolve, reject) => {
			const modal = new WebSearchModal(
				this.app,
				calls,
				(value) => {
					this.webReviewModal = null;
					resolve(value);
				},
				(error: unknown) => {
					this.webReviewModal = null;
					reject(error instanceof Error ? error : new Error(String(error)));
				},
				() => this.activeController?.abort(),
			);
			this.webReviewModal = modal;
			signal.addEventListener('abort', () => {
				modal.close();
			}, { once: true });
			modal.open();
		});
	}

	private async persistMessages(notePath: string, messages: ChatMessage[]) {
		try {
			await this.plugin.conversationStore.save(notePath, messages);
		} catch (error) {
			new Notice(`Emend: Could not save this chat. ${getErrorMessage(error)}`);
		}
	}

	private toProviderHistory(): ProviderHistoryMessage[] {
		return this.messages
			.filter((message) => message.status === 'ready')
			.slice(-8)
			.map((message) => ({
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

function formatWebActivityText(activity: WebActivityRecord) {
	const type = activity.type === 'search' ? 'Search' : 'Fetch';
	const status = activity.status.charAt(0).toUpperCase() + activity.status.slice(1);
	const reason = activity.status === 'failed' && activity.failureReason
		? WEB_FAILURE_REASON_LABELS[activity.failureReason]
		: undefined;
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
