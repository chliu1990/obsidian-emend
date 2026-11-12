import { App, Modal, setIcon } from 'obsidian';
import { normalizeManualTitle, type ChatSession } from './chat-sessions';

export interface ChatSessionControlsState {
	sessions: readonly ChatSession[];
	activeSessionId: string | null;
	disabled: boolean;
}

export interface ChatSessionControlsCallbacks {
	onNew(): void;
	onSwitch(sessionId: string): void;
	onRename(title: string): void;
	onDelete(): void;
}

export class ChatSessionControls {
	private readonly rootEl: HTMLElement;
	private readonly selectEl: HTMLSelectElement;
	private readonly newButton: HTMLButtonElement;
	private readonly renameButton: HTMLButtonElement;
	private readonly deleteButton: HTMLButtonElement;
	private readonly app: App;
	private state: ChatSessionControlsState = {
		sessions: [],
		activeSessionId: null,
		disabled: true,
	};
	private activeModal: Modal | null = null;

	constructor(
		container: HTMLElement,
		private readonly callbacks: ChatSessionControlsCallbacks,
		app?: App,
	) {
		this.app = app ?? new App();
		this.rootEl = container.createDiv('emend-chat-session-controls');
		this.selectEl = this.rootEl.createEl('select', {
			cls: 'emend-chat-session-select',
			attr: { 'aria-label': 'Chat session' },
		});
		this.selectEl.addEventListener('change', () => {
			if (!this.selectEl.disabled && this.selectEl.value) {
				this.callbacks.onSwitch(this.selectEl.value);
			}
		});
		this.newButton = this.createAction('New chat session', 'plus', () => {
			this.callbacks.onNew();
		});
		this.renameButton = this.createAction('Rename chat session', 'pencil', () => {
			this.openRenameModal();
		});
		this.deleteButton = this.createAction('Delete chat session', 'trash', () => {
			this.openDeleteModal();
		});
	}

	render(state: ChatSessionControlsState): void {
		this.state = state;
		this.selectEl.empty();
		for (const session of state.sessions) {
			this.selectEl.createEl('option', {
				text: session.title,
				attr: { value: session.id },
			});
		}
		this.selectEl.value = state.activeSessionId ?? '';
		this.selectEl.disabled = state.disabled || state.sessions.length < 2;
		this.newButton.disabled = state.disabled;
		this.renameButton.disabled = state.disabled || !state.activeSessionId;
		this.deleteButton.disabled = state.disabled || !state.activeSessionId;
	}

	destroy(): void {
		this.activeModal?.close();
		this.activeModal = null;
		this.rootEl.remove();
		this.rootEl.empty();
	}

	private createAction(
		label: string,
		icon: string,
		action: () => void,
	): HTMLButtonElement {
		const button = this.rootEl.createEl('button', {
			cls: 'emend-chat-session-action',
			attr: {
				type: 'button',
				'aria-label': label,
				title: label,
			},
		});
		setIcon(button, icon);
		button.addEventListener('click', () => {
			if (!this.state.disabled && !button.disabled) {
				action();
			}
		});
		return button;
	}

	private openRenameModal(): void {
		const active = this.activeSession();
		if (!active) {
			return;
		}
		this.openModal(new RenameChatSessionModal(
			this.app,
			active.title,
			(title) => this.callbacks.onRename(title),
			() => {
				this.activeModal = null;
			},
		));
	}

	private openDeleteModal(): void {
		const active = this.activeSession();
		if (!active) {
			return;
		}
		this.openModal(new DeleteChatSessionModal(
			this.app,
			active.title,
			() => this.callbacks.onDelete(),
			() => {
				this.activeModal = null;
			},
		));
	}

	private activeSession(): ChatSession | undefined {
		return this.state.sessions.find(
			(session) => session.id === this.state.activeSessionId,
		);
	}

	private openModal(modal: Modal): void {
		this.activeModal?.close();
		this.activeModal = modal;
		modal.open();
	}
}

class RenameChatSessionModal extends Modal {
	private inputEl: HTMLInputElement | null = null;
	private errorEl: HTMLElement | null = null;

	constructor(
		app: App,
		private readonly currentTitle: string,
		private readonly rename: (title: string) => void,
		private readonly closed: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Rename chat session');
		this.contentEl.empty();
		this.contentEl.addClass('emend-chat-session-modal');
		this.contentEl.createEl('label', { text: 'Session title' });
		this.inputEl = this.contentEl.createEl('input', {
			cls: 'emend-chat-session-title-input',
			attr: { type: 'text', 'aria-label': 'Session title' },
		});
		this.inputEl.value = this.currentTitle;
		this.inputEl.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				this.submit();
			}
		});
		const actionsEl = this.contentEl.createDiv('emend-chat-session-modal-actions');
		actionsEl.createEl('button', {
			cls: 'emend-chat-secondary-button',
			text: 'Cancel',
			attr: { type: 'button' },
		}).addEventListener('click', () => this.close());
		actionsEl.createEl('button', {
			cls: 'emend-chat-primary-button',
			text: 'Rename',
			attr: { type: 'button' },
		}).addEventListener('click', () => this.submit());
		this.inputEl.focus();
	}

	onClose(): void {
		this.inputEl = null;
		this.errorEl = null;
		this.contentEl.empty();
		this.closed();
	}

	private submit(): void {
		try {
			const title = normalizeManualTitle(this.inputEl?.value ?? '');
			this.close();
			this.rename(title);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (this.errorEl) {
				this.errorEl.textContent = message;
			} else {
				this.errorEl = this.contentEl.createDiv({
					cls: 'emend-chat-session-error',
					text: message,
				});
			}
		}
	}
}

class DeleteChatSessionModal extends Modal {
	constructor(
		app: App,
		private readonly currentTitle: string,
		private readonly deleteSession: () => void,
		private readonly closed: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Delete chat session');
		this.contentEl.empty();
		this.contentEl.addClass('emend-chat-session-modal');
		this.contentEl.createDiv({
			cls: 'emend-chat-session-delete-warning',
			text: `Delete “${this.currentTitle}”? This cannot be undone.`,
		});
		const actionsEl = this.contentEl.createDiv('emend-chat-session-modal-actions');
		actionsEl.createEl('button', {
			cls: 'emend-chat-secondary-button',
			text: 'Cancel',
			attr: { type: 'button' },
		}).addEventListener('click', () => this.close());
		actionsEl.createEl('button', {
			cls: 'emend-chat-primary-button',
			text: 'Delete',
			attr: { type: 'button' },
		}).addEventListener('click', () => {
			this.close();
			this.deleteSession();
		});
	}

	onClose(): void {
		this.contentEl.empty();
		this.closed();
	}
}
