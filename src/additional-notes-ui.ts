import { App, FuzzySuggestModal, TFile } from 'obsidian';
import type { AdditionalNotesStore } from './additional-notes-store';

export class AdditionalNotesPicker extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly store: AdditionalNotesStore,
		private readonly targetFile: TFile,
	) {
		super(app);
	}

	getItems(): TFile[] {
		const targetPath = this.targetFile.path;
		const selected = new Set(this.store.list(targetPath));
		return this.app.vault.getMarkdownFiles().filter(
		(file) => file.path !== targetPath && !selected.has(file.path),
		);
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile): void {
		this.store.add(this.targetFile.path, item.path);
	}
}

export class AdditionalNotesControl {
	private listEl: HTMLElement | null = null;
	private addButton: HTMLButtonElement | null = null;
	private clearButton: HTMLButtonElement | null = null;
	private pendingFocusIndex: number | null = null;
	private readonly buttons = new Set<HTMLButtonElement>();
	private readonly removeButtons = new Set<HTMLButtonElement>();
	private unsubscribe: (() => void) | null = null;
	private activePicker: AdditionalNotesPicker | null = null;
	private disabled = false;

	constructor(
		private readonly app: App,
		private readonly store: AdditionalNotesStore,
		private readonly getTargetPath: () => string | null,
	) {}

	render(container: HTMLElement, disabled: boolean): void {
		this.destroy();
		this.disabled = disabled;
		const rootEl = container.createDiv('emend-additional-notes');
		const headerEl = rootEl.createDiv('emend-additional-notes-header');
		headerEl.createSpan({
			cls: 'emend-additional-notes-title',
			text: 'Additional notes',
		});
		const actionsEl = headerEl.createDiv('emend-additional-notes-actions');
		const addButton = this.createButton(
			actionsEl,
			'emend-additional-notes-add',
			'Add notes',
			'Add notes',
		);
		this.addButton = addButton;
		addButton.addEventListener('click', () => {
			const targetPath = this.getTargetPath();
			const targetFile = !this.disabled && targetPath
				? this.app.vault.getAbstractFileByPath(targetPath)
				: null;
			if (targetFile instanceof TFile) {
				this.activePicker?.close();
				this.activePicker = new AdditionalNotesPicker(this.app, this.store, targetFile);
				this.activePicker.open();
			}
		});
		const clearButton = this.createButton(
			actionsEl,
			'emend-additional-notes-clear',
			'Clear all',
			'Clear all additional notes',
		);
		this.clearButton = clearButton;
		clearButton.addEventListener('click', () => {
			const targetPath = this.getTargetPath();
			if (!this.disabled && targetPath) {
				this.store.clear(targetPath);
			}
		});
		this.listEl = rootEl.createDiv('emend-additional-notes-list');
		rootEl.createDiv({
			cls: 'emend-additional-notes-disclosure',
			text: 'Selected note content is sent with your next request.',
		});
		this.unsubscribe = this.store.subscribe(() => this.renderPaths());
		this.renderPaths();
	}

	setDisabled(disabled: boolean): void {
		this.disabled = disabled;
		this.updateDisabled();
	}

	destroy(): void {
		this.activePicker?.close();
		this.activePicker = null;
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.listEl = null;
		this.addButton = null;
		this.clearButton = null;
		this.pendingFocusIndex = null;
		this.buttons.clear();
		this.removeButtons.clear();
	}

	private renderPaths(): void {
		if (!this.listEl) {
			return;
		}
		for (const button of this.removeButtons) {
			this.buttons.delete(button);
		}
		this.removeButtons.clear();
		this.listEl.empty();
		const targetPath = this.getTargetPath();
		const paths = targetPath ? this.store.list(targetPath) : [];
		if (paths.length === 0) {
			this.listEl.createDiv({
				cls: 'emend-additional-notes-empty',
				text: 'No additional notes selected.',
			});
			this.updateDisabled();
			this.restoreRemovalFocus();
			return;
		}

		for (const [index, path] of paths.entries()) {
			const itemEl = this.listEl.createDiv('emend-additional-notes-item');
			itemEl.createSpan({
				cls: 'emend-additional-notes-path',
				text: path,
				attr: { title: path },
			});
			const removeButton = this.createButton(
				itemEl,
				'emend-additional-notes-remove',
				'Remove',
				`Remove ${path}`,
			);
			this.removeButtons.add(removeButton);
			removeButton.addEventListener('click', () => {
				const currentTargetPath = this.getTargetPath();
				if (!this.disabled && currentTargetPath) {
					this.pendingFocusIndex = index;
					this.store.remove(currentTargetPath, path);
				}
			});
		}
		this.updateDisabled();
		this.restoreRemovalFocus();
	}

	private restoreRemovalFocus(): void {
		const index = this.pendingFocusIndex;
		this.pendingFocusIndex = null;
		if (index === null) {
			return;
		}
		const removeButtons = [...this.removeButtons];
		const target = removeButtons[index] ??
			(removeButtons.length === 0
				? this.addButton ?? this.clearButton
				: this.clearButton ?? removeButtons[removeButtons.length - 1]);
		target?.focus();
	}

	private createButton(
		container: HTMLElement,
		className: string,
		text: string,
		label: string,
	): HTMLButtonElement {
		const button = container.createEl('button', {
			cls: className,
			text,
			attr: { 'aria-label': label, type: 'button' },
		});
		this.buttons.add(button);
		button.disabled = this.disabled || !this.getTargetPath();
		return button;
	}

	private updateDisabled(): void {
		const disabled = this.disabled || !this.getTargetPath();
		for (const button of this.buttons) {
			button.disabled = disabled;
		}
	}
}
