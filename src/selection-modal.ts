import { App, Modal, Notice } from 'obsidian';
import type { EditResult } from './note-writer';

export class SelectionModal extends Modal {
	private inputEl: HTMLTextAreaElement | null = null;
	private activeController: AbortController | null = null;

	constructor(
		app: App,
		private readonly submitSelection: (
			prompt: string,
			signal: AbortSignal,
		) => Promise<EditResult>,
	) {
		super(app);
	}

	onOpen() {
		this.setTitle('Modify selected text');
		this.contentEl.empty();
		this.contentEl.addClass('emend-selection-modal');
		this.contentEl.createEl('label', {
			text: 'How do you want to modify this selection?',
		});
		this.inputEl = this.contentEl.createEl('textarea', {
			cls: 'emend-chat-input',
			attr: {
				rows: '4',
				placeholder: 'Describe the change...',
			},
		});
		this.inputEl.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				void this.submit();
			}
		});

		const actionsEl = this.contentEl.createDiv('emend-chat-composer-actions');
		const cancelButton = actionsEl.createEl('button', {
			cls: 'emend-chat-secondary-button',
			text: 'Cancel',
		});
		cancelButton.addEventListener('click', () => {
			if (this.activeController) {
				this.activeController.abort();
				cancelButton.disabled = true;
				cancelButton.textContent = 'Stopping...';
			} else {
				this.close();
			}
		});
		const submitButton = actionsEl.createEl('button', {
			cls: 'emend-chat-primary-button',
			text: 'Modify selection',
		});
		submitButton.addEventListener('click', () => {
			void this.submit();
		});
		this.inputEl.focus();
	}

	onClose() {
		this.activeController?.abort();
		this.activeController = null;
		this.inputEl = null;
		this.contentEl.empty();
	}

	private async submit() {
		const prompt = this.inputEl?.value.trim() ?? '';
		if (!prompt || this.activeController) {
			return;
		}

		const controller = new AbortController();
		this.activeController = controller;
		if (this.inputEl) {
			this.inputEl.disabled = true;
		}

		try {
			const result = await this.submitSelection(prompt, controller.signal);
			if (controller.signal.aborted) {
				return;
			}
			new Notice(
				result.applied
					? `Selection updated — ${result.changeCount} changes tracked. Review in Track Changes.`
					: 'No changes were needed.',
			);
			this.close();
		} catch (error) {
			if (!controller.signal.aborted) {
				new Notice(`Emend: ${getErrorMessage(error)}`);
				if (this.inputEl) {
					this.inputEl.disabled = false;
				}
			}
		} finally {
			if (this.activeController === controller) {
				this.activeController = null;
			}
		}
	}
}

function getErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
