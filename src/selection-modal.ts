import { App, Modal, Notice, TFile } from 'obsidian';
import type { AdditionalNotesStore } from './additional-notes-store';
import { AdditionalNotesControl } from './additional-notes-ui';
import {
	ContextCapacityDisplay,
	formatDraftCapacityBlockMessage,
	type DraftCapacityEstimate,
} from './context-capacity-ui';
import type { EditResult } from './note-writer';
import { QUICK_ACTIONS, type QuickAction } from './quick-actions';
import type { SelectionContextPolicy } from './selection-focus';

export class SelectionModal extends Modal {
	private inputEl: HTMLTextAreaElement | null = null;
	private submitButton: HTMLButtonElement | null = null;
	private cancelButton: HTMLButtonElement | null = null;
	private quickActionButtons: Array<{
		action: QuickAction;
		button: HTMLButtonElement;
	}> = [];
	private activeController: AbortController | null = null;
	private additionalNotesControl: AdditionalNotesControl | null = null;
	private targetFile: TFile | null = null;
	private capacityDisplay: ContextCapacityDisplay | null = null;
	private selectionContextSelect: HTMLSelectElement | null = null;
	private selectionContext: SelectionContextPolicy = 'default';
	private draftCapacityBlocked = false;

	constructor(
		app: App,
		private readonly submitSelection: (
			prompt: string,
			signal: AbortSignal,
			additionalNotePaths: readonly string[],
			selectionContext: SelectionContextPolicy,
		) => Promise<EditResult>,
		private readonly additionalNotesStore: AdditionalNotesStore,
		private readonly targetPath: string,
		private readonly estimateDraft: (
			prompt: string,
			selectionContext: SelectionContextPolicy,
		) => DraftCapacityEstimate,
		private readonly smartSelectionContext: boolean,
		private readonly notifyClosed?: (modal: SelectionModal) => void,
	) {
		super(app);
	}

	onOpen() {
		this.selectionContext = 'default';
		this.setTitle('Modify selected text');
		this.contentEl.empty();
		this.contentEl.addClass('emend-selection-modal');
		const targetFile = this.app.vault.getAbstractFileByPath(this.targetPath);
		this.targetFile = targetFile instanceof TFile ? targetFile : null;
		this.capacityDisplay = new ContextCapacityDisplay(this.contentEl);
		const quickActionsEl = this.contentEl.createDiv('emend-chat-quick-actions');
		for (const action of QUICK_ACTIONS) {
			const button = quickActionsEl.createEl('button', {
				cls: 'emend-chat-quick-action',
				text: action.label,
				attr: { 'data-action-id': action.id },
			});
			this.quickActionButtons.push({ action, button });
			button.addEventListener('click', () => {
				void this.submit(action.prompt);
			});
		}

		const selectionContextEl = this.contentEl.createDiv('emend-selection-context');
		selectionContextEl.createEl('label', {
			text: 'Selection context',
			attr: { for: 'emend-selection-context-select' },
		});
		this.selectionContextSelect = selectionContextEl.createEl('select', {
			cls: 'emend-selection-context-select',
			attr: {
				id: 'emend-selection-context-select',
				'aria-label': 'Selection context',
			},
		});
		this.selectionContextSelect.createEl('option', {
			text: this.smartSelectionContext ? 'Default (Smart)' : 'Default (Symmetric)',
			attr: { value: 'default' },
		});
		this.selectionContextSelect.createEl('option', {
			text: 'Full note',
			attr: { value: 'full-note' },
		});
		this.selectionContextSelect.value = this.selectionContext;
		this.selectionContextSelect.addEventListener('change', () => {
			this.selectionContext = this.selectionContextSelect?.value === 'full-note'
				? 'full-note'
				: 'default';
			this.refreshCapacityEstimate();
		});
		selectionContextEl.createSpan({
			cls: 'emend-selection-context-description',
			text: 'Full note sends the complete note; only the selection is edited.',
		});

		this.additionalNotesControl = new AdditionalNotesControl(
			this.app,
			this.additionalNotesStore,
			() => this.getTargetPath(),
		);
		this.additionalNotesControl.render(this.contentEl, false);

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
		this.inputEl.addEventListener('input', () => {
			this.refreshCapacityEstimate();
		});

		const actionsEl = this.contentEl.createDiv('emend-chat-composer-actions');
		this.cancelButton = actionsEl.createEl('button', {
			cls: 'emend-chat-secondary-button',
			text: 'Cancel',
		});
		const cancelButton = this.cancelButton;
		cancelButton.addEventListener('click', () => {
			if (this.activeController) {
				this.activeController.abort();
				cancelButton.disabled = true;
				cancelButton.textContent = 'Stopping...';
			} else {
				this.close();
			}
		});
		this.submitButton = actionsEl.createEl('button', {
			cls: 'emend-chat-primary-button',
			text: 'Modify selection',
		});
		this.submitButton.addEventListener('click', () => {
			void this.submit();
		});
		this.refreshCapacityEstimate();
		this.inputEl.focus();
	}

	onClose() {
		this.activeController?.abort();
		this.activeController = null;
		this.inputEl = null;
		this.submitButton = null;
		this.cancelButton = null;
		this.quickActionButtons = [];
		this.additionalNotesControl?.destroy();
		this.additionalNotesControl = null;
		this.capacityDisplay?.destroy();
		this.capacityDisplay = null;
		this.selectionContextSelect = null;
		this.draftCapacityBlocked = false;
		this.targetFile = null;
		this.contentEl.empty();
		this.notifyClosed?.(this);
	}

	private getTargetPath(): string {
		return this.targetFile?.path ?? this.targetPath;
	}

	private refreshCapacityEstimate(prompt = this.inputEl?.value ?? '') {
		const estimate = this.safeEstimateDraft(prompt);
		this.draftCapacityBlocked = estimate?.blocked ?? false;
		this.capacityDisplay?.render(estimate);
		if (this.activeController) {
			return;
		}
		this.applyCapacityControls();
	}

	private applyCapacityControls() {
		if (this.submitButton) {
			this.submitButton.disabled = this.draftCapacityBlocked;
		}
		for (const { action, button } of this.quickActionButtons) {
			button.disabled = this.safeEstimateDraft(action.prompt)?.blocked ?? false;
		}
	}

	private safeEstimateDraft(
		prompt: string,
	): DraftCapacityEstimate | undefined {
		try {
			return this.estimateDraft(prompt, this.selectionContext);
		} catch {
			return undefined;
		}
	}

	private setPending(pending: boolean) {
		if (this.inputEl) {
			this.inputEl.disabled = pending;
		}
		if (this.selectionContextSelect) {
			this.selectionContextSelect.disabled = pending;
		}
		this.additionalNotesControl?.setDisabled(pending);
		if (pending) {
			if (this.submitButton) {
				this.submitButton.disabled = true;
			}
			for (const { button } of this.quickActionButtons) {
				button.disabled = true;
			}
			return;
		}
		this.refreshCapacityEstimate();
	}

	private async submit(prompt?: string) {
		const submittedPrompt = prompt === undefined
			? this.inputEl?.value.trim() ?? ''
			: prompt.trim();
		if (!submittedPrompt || this.activeController) {
			return;
		}

		const estimate = this.safeEstimateDraft(submittedPrompt);
		const capacityBlockMessage = formatDraftCapacityBlockMessage(estimate);
		if (capacityBlockMessage) {
			if (prompt === undefined) {
				this.refreshCapacityEstimate(submittedPrompt);
			} else {
				this.refreshCapacityEstimate();
			}
			new Notice(`Emend: ${capacityBlockMessage}`);
			return;
		}

		const additionalNotePaths = this.additionalNotesStore.list(this.getTargetPath());
		const controller = new AbortController();
		this.activeController = controller;
		this.setPending(true);

		try {
			const result = await this.submitSelection(
				submittedPrompt,
				controller.signal,
				additionalNotePaths,
				this.selectionContext,
			);
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
			}
		} finally {
			if (this.activeController === controller) {
				this.activeController = null;
				this.setPending(false);
				if (this.cancelButton) {
					this.cancelButton.disabled = false;
					this.cancelButton.textContent = 'Cancel';
				}
			}
		}
	}
}

function getErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
