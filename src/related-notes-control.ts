import { App, TFile } from 'obsidian';
import type { AdditionalNotesStore } from './additional-notes-store';
import { AdditionalNotesPicker } from './additional-notes-ui';

export class RelatedNotesControl {
	private triggerButton: HTMLButtonElement | null = null;
	private countEl: HTMLElement | null = null;
	private detailsHost: HTMLElement | null = null;
	private detailsEl: HTMLDetailsElement | null = null;
	private clearButton: HTMLButtonElement | null = null;
	private readonly buttons = new Set<HTMLButtonElement>();
	private readonly removeButtons = new Set<HTMLButtonElement>();
	private unsubscribe: (() => void) | null = null;
	private activePicker: AdditionalNotesPicker | null = null;
	private disabled = false;
	private pendingFocus: 'details' | 'trigger' | null = null;
	private generation = 0;

	constructor(
		private readonly app: App,
		private readonly store: AdditionalNotesStore,
		private readonly getTargetPath: () => string | null,
	) {}

	render(container: HTMLElement, disabled: boolean): void {
		this.destroy();
		const generation = this.generation;
		this.disabled = disabled;
		const rootEl = container.createDiv('emend-chat-related-notes');
		const triggerRowEl = rootEl.createDiv('emend-chat-related-notes-trigger-row');
		this.triggerButton = this.createButton(
			triggerRowEl,
			'emend-chat-related-notes-trigger',
			'Related notes',
			'Related notes',
		);
		this.triggerButton.addEventListener('click', () => {
			if (generation !== this.generation) {
				return;
			}
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
		this.countEl = this.triggerButton.createSpan({
			cls: 'emend-chat-related-notes-count',
			text: '0',
			attr: { 'aria-hidden': 'true' },
		});
		this.detailsHost = rootEl.createDiv('emend-chat-related-notes-details-host');
		this.unsubscribe = this.store.subscribe(() => this.renderPaths(generation));
		this.renderPaths(generation);
	}

	setDisabled(disabled: boolean): void {
		this.disabled = disabled;
		this.updateDisabled();
	}

	destroy(): void {
		this.generation += 1;
		this.activePicker?.close();
		this.activePicker = null;
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.triggerButton = null;
		this.countEl = null;
		this.detailsHost = null;
		this.detailsEl = null;
		this.clearButton = null;
		this.buttons.clear();
		this.removeButtons.clear();
		this.pendingFocus = null;
	}

	private renderPaths(generation: number): void {
		if (
			generation !== this.generation ||
			!this.detailsHost ||
			!this.triggerButton ||
			!this.countEl
		) {
			return;
		}
		const wasOpen = this.detailsEl?.open ?? false;
		const targetPath = this.getTargetPath();
		const paths = targetPath ? this.store.list(targetPath) : [];
		this.countEl.textContent = String(paths.length);
		this.triggerButton.setAttribute(
			'aria-label',
			paths.length > 0 ? `Related notes, ${paths.length} selected` : 'Related notes',
		);
		this.detailsHost.empty();
		this.buttons.clear();
		this.buttons.add(this.triggerButton);
		this.removeButtons.clear();
		this.clearButton = null;
		this.detailsEl = null;
		if (paths.length > 0) {
			const detailsEl = this.detailsHost.createEl('details', {
				cls: 'emend-chat-related-notes-details',
			});
			detailsEl.open = wasOpen;
			this.detailsEl = detailsEl;
			detailsEl.createEl('summary', {
				cls: 'emend-chat-related-notes-summary',
				text: 'Selected notes',
			});
			const listEl = detailsEl.createDiv('emend-chat-related-notes-list');
			for (const path of paths) {
				const itemEl = listEl.createDiv('emend-chat-related-notes-item');
				itemEl.createSpan({
					cls: 'emend-chat-related-notes-path',
					text: path,
					attr: { title: path },
				});
				const removeButton = this.createButton(
					itemEl,
					'emend-chat-related-notes-remove',
					'Remove',
					`Remove ${path}`,
				);
				this.removeButtons.add(removeButton);
				removeButton.addEventListener('click', () => {
					if (generation !== this.generation) {
						return;
					}
					const currentTargetPath = this.getTargetPath();
					if (!this.disabled && currentTargetPath) {
						this.pendingFocus = 'details';
						this.store.remove(currentTargetPath, path);
					}
				});
			}
			this.clearButton = this.createButton(
				detailsEl,
				'emend-chat-related-notes-clear',
				'Clear all',
				'Clear all related notes',
			);
			this.clearButton.addEventListener('click', () => {
				if (generation !== this.generation) {
					return;
				}
				const currentTargetPath = this.getTargetPath();
				if (!this.disabled && currentTargetPath) {
					this.pendingFocus = 'trigger';
					this.store.clear(currentTargetPath);
				}
			});
			detailsEl.createDiv({
				cls: 'emend-chat-related-notes-disclosure',
				text: 'Selected note content is sent with your next request.',
			});
		}
		this.updateDisabled();
		const pendingFocus = this.pendingFocus;
		this.pendingFocus = null;
		if (pendingFocus === 'trigger') {
			this.triggerButton.focus();
		} else if (pendingFocus === 'details') {
			const nextButton = this.removeButtons.values().next().value;
			(nextButton ?? this.clearButton ?? this.triggerButton).focus();
		}
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
