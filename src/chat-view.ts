import {
	ItemView,
	MarkdownRenderer,
	Notice,
	setIcon,
	WorkspaceLeaf,
} from 'obsidian';
import type EmendPlugin from './main';
import { MODES } from './mode';
import {
	areQuickActionsDisabled,
	QUICK_ACTIONS,
	type QuickAction,
} from './quick-actions';
import type { ChatMessage, Mode, ProviderHistoryMessage } from './types';

export const EMEND_CHAT_VIEW_TYPE = 'emend-chat-view';

const MODE_PLACEHOLDERS: Record<Mode, string> = {
	ask: 'Ask about the active note...',
	edit: 'Edit the complete note with CriticMarkup...',
	discuss: 'Discuss an idea in the active note...',
	brainstorm: 'Brainstorm ideas for the active note...',
};

export class EmendChatView extends ItemView {
	private messages: ChatMessage[] = [];
	private inputEl: HTMLTextAreaElement | null = null;
	private activeModelEl: HTMLElement | null = null;
	private isSending = false;
	private isThreadLoading = false;
	private selectedMode: Mode;
	private activeController: AbortController | null = null;
	private pendingRenderFrame: number | null = null;
	private pendingMessages = new Set<ChatMessage>();
	private messageBodyEls = new Map<string, HTMLElement>();
	private closed = false;
	private notePath: string | null = null;
	private noteLoadGeneration = 0;

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
		return 'AI chat';
	}

	getIcon() {
		return 'messages-square';
	}

	protected async onOpen() {
		this.closed = false;
		this.render();
		await this.refreshTargetNote();
	}

	protected async onClose() {
		this.closed = true;
		this.isThreadLoading = false;
		this.noteLoadGeneration++;
		this.notePath = null;
		this.activeController?.abort();
		this.cancelPendingRender();
		this.pendingMessages.clear();
		this.messageBodyEls.clear();
		this.activeModelEl = null;
		this.inputEl = null;
		this.contentEl.empty();
	}

	refreshActiveModelLabel() {
		if (!this.activeModelEl) {
			this.render();
			return;
		}

		this.activeModelEl.textContent = this.getActiveModelLabel();
	}

	async refreshTargetNote() {
		const notePath = this.plugin.getActiveNotePath();
		if (notePath === this.notePath) {
			return;
		}

		this.notePath = notePath;
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

	private render() {
		this.cancelPendingRender();
		this.pendingMessages.clear();
		this.messageBodyEls.clear();
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('emend-chat-view');

		const headerEl = contentEl.createDiv('emend-chat-header');
		headerEl.createDiv({
			cls: 'emend-chat-title',
			text: 'AI chat',
		});
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
				this.selectedMode = mode.id;
				this.render();
			});
		}

		const messagesEl = contentEl.createDiv('emend-chat-messages');
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

		const composerEl = contentEl.createDiv('emend-chat-composer');
		this.inputEl = composerEl.createEl('textarea', {
			cls: 'emend-chat-input',
			attr: {
				placeholder: MODE_PLACEHOLDERS[this.selectedMode],
				rows: '4',
			},
		});
		this.inputEl.disabled = this.isSending || this.isThreadLoading;
		this.inputEl.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				void this.submitPrompt();
			}
		});

		const actionsEl = composerEl.createDiv('emend-chat-composer-actions');
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
		const messageEl = containerEl.createDiv(
			`emend-chat-message is-${message.role} is-${message.status}`,
		);
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
				void copyToClipboard(message.content);
			});
		}

		const bodyEl = messageEl.createDiv('emend-chat-message-body');
		this.messageBodyEls.set(message.id, bodyEl);
		this.renderMessageBody(message);
	}

	private renderMessageBody(message: ChatMessage) {
		const bodyEl = this.messageBodyEls.get(message.id);
		if (!bodyEl || this.closed) {
			return;
		}
		bodyEl.empty();

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

		if (message.role === 'user' || message.status === 'error') {
			bodyEl.createDiv({
				cls: 'emend-chat-message-content',
				text: message.content,
			});
			return;
		}

		const currentContentEl = bodyEl.createDiv('emend-chat-message-content');
		const renderedEl = bodyEl.ownerDocument.createElement('div');
		renderedEl.className = 'emend-chat-message-content';
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
				}
			})
			.catch(() => {
				if (!this.closed && currentContentEl.isConnected) {
					currentContentEl.textContent = message.content;
				}
			});
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
		});
	}

	private cancelPendingRender() {
		if (this.pendingRenderFrame !== null) {
			const view = this.contentEl.ownerDocument.defaultView ?? window;
			view.cancelAnimationFrame(this.pendingRenderFrame);
			this.pendingRenderFrame = null;
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

		let context;
		try {
			context = this.plugin.captureChatContext();
		} catch (error) {
			new Notice(`Emend: ${getErrorMessage(error)}`);
			return;
		}

		const history = this.toProviderHistory();
		const mode = this.selectedMode;
		const sourcePath = context.file.path;
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

		this.messages.push({
			id: createMessageId(),
			role: 'user',
			content: prompt,
			reasoning: '',
			mode,
			sourcePath,
			status: 'ready',
			timestamp: Date.now(),
		});
		this.messages.push(loadingMessage);
		this.activeController = controller;
		this.isSending = true;
		this.render();

		try {
			await this.persistMessages(
				sourcePath,
				noteMessages.filter((message) => message.status === 'ready'),
			);
			controller.signal.throwIfAborted();
			if (mode === 'edit') {
				const result = await this.plugin.requestChatCompletion({
					context,
					mode,
					prompt,
					history,
					callbacks: {
						onReasoning: (text) => {
							loadingMessage.reasoning += text;
							this.scheduleMessageRender(loadingMessage);
						},
					},
					signal: controller.signal,
				});
				loadingMessage.content = result.applied
					? `Edit applied — ${result.changeCount} changes tracked. Review in Track Changes.`
					: 'No changes were needed.';
			} else {
				const result = await this.plugin.requestChatCompletion({
					context,
					mode,
					prompt,
					history,
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
				});
				loadingMessage.usage = result.usage;
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
				this.render();
			}
		}
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
				content: message.content,
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
