import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import { AiMessage } from './providers';
import type EmendPlugin from './main';

export const EMEND_CHAT_VIEW_TYPE = 'emend-chat-view';

interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	status: 'ready' | 'loading' | 'error';
	kind?: 'answer' | 'edit';
}

export class EmendChatView extends ItemView {
	private messages: ChatMessage[] = [];
	private inputEl: HTMLTextAreaElement | null = null;
	private activeModelEl: HTMLElement | null = null;
	private isSending = false;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: EmendPlugin,
	) {
		super(leaf);
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
		this.render();
	}

	protected async onClose() {
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

	private render() {
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

		const messagesEl = contentEl.createDiv('emend-chat-messages');
		if (this.messages.length === 0) {
			this.renderEmptyState(messagesEl);
		} else {
			for (const message of this.messages) {
				this.renderMessage(messagesEl, message);
			}
		}

		const composerEl = contentEl.createDiv('emend-chat-composer');
		this.inputEl = composerEl.createEl('textarea', {
			cls: 'emend-chat-input',
			attr: {
				placeholder: 'What do you want to add or change in the active note?',
				rows: '4',
			},
		});
		this.inputEl.disabled = this.isSending;
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
		const sendButton = actionsEl.createEl('button', {
			cls: 'emend-chat-primary-button',
			text: this.isSending ? 'Sending...' : 'Send',
		});
		sendButton.disabled = this.isSending;
		sendButton.addEventListener('click', () => {
			void this.submitPrompt();
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
			text: 'Ask a question to get a chat answer, or request an edit to preview git-style changes directly in the note.',
		});
	}

	private renderMessage(containerEl: HTMLElement, message: ChatMessage) {
		const messageEl = containerEl.createDiv(
			`emend-chat-message is-${message.role} is-${message.status}`,
		);
		const headerEl = messageEl.createDiv('emend-chat-message-header');
		headerEl.createDiv({
			cls: 'emend-chat-message-label',
			text: message.role === 'user' ? 'You' : 'AI',
		});

		if (message.role === 'assistant' && message.status !== 'loading') {
			const copyButton = headerEl.createEl('button', {
				cls: 'emend-chat-copy-button',
				text: 'Copy',
			});
			copyButton.addEventListener('click', () => {
				void copyToClipboard(message.content);
			});
		}

		if (message.status === 'loading') {
			messageEl.createDiv({
				cls: 'emend-chat-message-content',
				text: 'Preparing a response...',
			});
			return;
		}

		if (message.status === 'error') {
			messageEl.createDiv({
				cls: 'emend-chat-message-content',
				text: message.content,
			});
			return;
		}

		messageEl.createDiv({
			cls: 'emend-chat-message-content',
			text: message.content,
		});
	}

	private async submitPrompt() {
		const prompt = this.inputEl?.value.trim() ?? '';
		if (!prompt || this.isSending) {
			return;
		}

		const history = this.toProviderHistory();
		const loadingMessage: ChatMessage = {
			id: createMessageId(),
			role: 'assistant',
			content: '',
			status: 'loading',
		};

		this.messages.push({
			id: createMessageId(),
			role: 'user',
			content: prompt,
			status: 'ready',
		});
		this.messages.push(loadingMessage);
		this.isSending = true;
		this.render();

		try {
			const response = await this.plugin.requestChatCompletion(prompt, history);
			if (response.type === 'answer') {
				loadingMessage.content = response.message;
				loadingMessage.kind = 'answer';
			} else {
				loadingMessage.content =
					response.summary ||
					'Proposed changes are shown directly in the note.';
				loadingMessage.kind = 'edit';
			}
			loadingMessage.status = 'ready';
		} catch (error) {
			loadingMessage.content = getErrorMessage(error);
			loadingMessage.status = 'error';
			new Notice(`Emend: ${loadingMessage.content}`);
		} finally {
			this.isSending = false;
			this.render();
		}
	}

	private toProviderHistory(): AiMessage[] {
		return this.messages
			.filter((message) => message.status === 'ready')
			.slice(-8)
			.map((message) => ({
				role: message.role,
				content:
					message.kind === 'edit'
						? `Proposed note edit: ${message.content}`
						: message.content,
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

function createMessageId() {
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

async function copyToClipboard(content: string) {
	try {
		await navigator.clipboard.writeText(content);
		new Notice('Copied to clipboard.');
	} catch (error) {
		new Notice(`Copy failed: ${getErrorMessage(error)}`);
	}
}
