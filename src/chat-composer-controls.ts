import { Menu, setIcon, type MenuItem } from 'obsidian';
import type { ResolvedEditTarget } from './edit-target';
import type { SelectableMode } from './mode';
import {
	WEB_SEARCH_DISCLOSURE,
	type WebSearchMode,
} from './web-search';

export type ComposerWritingChoice =
	| { mode: 'ask' }
	| { mode: 'edit'; editTarget: ResolvedEditTarget };

export interface ComposerPermissionState {
	mode: SelectableMode;
	editTarget: ResolvedEditTarget;
	webSearchMode: WebSearchMode;
	disabled: boolean;
	sendDisabled: boolean;
	isSending: boolean;
	isStopping: boolean;
}

export interface ComposerPermissionCallbacks {
	onWritingChoice(choice: ComposerWritingChoice): void;
	onWebSearchMode(mode: WebSearchMode): void;
	onSend(): void;
	onStop(): void;
}

interface ActiveComposerMenu {
	menu: Menu;
	chatItem: MenuItem;
	selectionItem: MenuItem;
	fullNoteItem: MenuItem;
	webItems: Record<WebSearchMode, MenuItem>;
}

export class ChatComposerControls {
	private state: ComposerPermissionState = {
		mode: 'ask',
		editTarget: 'full-note',
		webSearchMode: 'off',
		disabled: false,
		sendDisabled: false,
		isSending: false,
		isStopping: false,
	};
	private triggerEl: HTMLButtonElement | null = null;
	private submissionButtonEl: HTMLButtonElement | null = null;
	private activeMenu: ActiveComposerMenu | null = null;
	private destroyed = false;

	constructor(private readonly callbacks: ComposerPermissionCallbacks) {}

	render(container: HTMLElement, state: ComposerPermissionState): void {
		if (this.destroyed) {
			return;
		}
		if (this.triggerEl && this.submissionButtonEl) {
			this.update(state);
			return;
		}
		this.state = state;
		const modelLabel = container.lastElementChild;
		this.triggerEl = container.createEl('button', {
			cls: 'emend-chat-writing-trigger',
			attr: {
				type: 'button',
				'aria-haspopup': 'menu',
				'aria-expanded': 'false',
			},
		});
		container.insertBefore(this.triggerEl, modelLabel);
		this.triggerEl.addEventListener('click', () => {
			if (!this.destroyed && !this.state.disabled) {
				this.openMenu();
			}
		});
		this.submissionButtonEl = container.createEl('button', {
			cls: 'emend-chat-send-button',
			attr: { type: 'button' },
		});
		this.submissionButtonEl.addEventListener('click', () => {
			if (this.destroyed || this.submissionButtonEl?.disabled) {
				return;
			}
			if (this.state.isSending) {
				this.callbacks.onStop();
			} else {
				this.callbacks.onSend();
			}
		});
		this.update(state);
	}

	update(state: ComposerPermissionState): void {
		this.state = state;
		if (this.destroyed) {
			return;
		}
		const summary = writingSummary(state);
		if (this.triggerEl) {
			this.triggerEl.textContent = summary;
			this.triggerEl.title = WEB_SEARCH_DISCLOSURE;
			this.triggerEl.disabled = state.disabled;
			this.triggerEl.setAttribute('aria-label', `Writing and web search: ${summary}`);
		}
		if (this.submissionButtonEl) {
			const label = state.isSending
				? state.isStopping ? 'Stopping' : 'Stop'
				: 'Send';
			this.submissionButtonEl.className = state.isSending
				? 'emend-chat-secondary-button emend-chat-send-button'
				: 'emend-chat-primary-button emend-chat-send-button';
			this.submissionButtonEl.disabled = state.isSending
				? state.isStopping
				: state.disabled || state.sendDisabled;
			this.submissionButtonEl.title = label;
			this.submissionButtonEl.setAttribute('aria-label', label);
			setIcon(this.submissionButtonEl, state.isSending ? 'square' : 'send');
		}
		if (this.activeMenu) {
			this.updateMenu(this.activeMenu);
		}
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.activeMenu?.menu.hide();
		this.activeMenu = null;
		this.triggerEl?.remove();
		this.submissionButtonEl?.remove();
		this.triggerEl = null;
		this.submissionButtonEl = null;
	}

	private openMenu(): void {
		const trigger = this.triggerEl;
		if (!trigger) {
			return;
		}
		this.activeMenu?.menu.hide();
		const menu = new Menu();
		const active: ActiveComposerMenu = {
			menu,
			chatItem: this.addChoiceItem(menu, 'Chat', () => {
				this.choose(menu, () => this.callbacks.onWritingChoice({ mode: 'ask' }));
			}),
			selectionItem: this.addChoiceItem(menu, 'Edit · Selection', () => {
				this.choose(menu, () => this.callbacks.onWritingChoice({
					mode: 'edit',
					editTarget: 'selection',
				}));
			}),
			fullNoteItem: this.addChoiceItem(menu, 'Edit · Full note', () => {
				this.choose(menu, () => this.callbacks.onWritingChoice({
					mode: 'edit',
					editTarget: 'full-note',
				}));
			}),
			webItems: {} as Record<WebSearchMode, MenuItem>,
		};
		menu.addSeparator();
		active.webItems = {
			off: this.addChoiceItem(menu, 'Web Off', () => {
				this.chooseWebMode(menu, 'off');
			}),
			review: this.addChoiceItem(menu, 'Web Review', () => {
				this.chooseWebMode(menu, 'review');
			}),
			auto: this.addChoiceItem(menu, 'Web Auto', () => {
				this.chooseWebMode(menu, 'auto');
			}),
		};
		this.activeMenu = active;
		this.updateMenu(active);
		menu.onHide(() => {
			if (this.activeMenu === active) {
				this.activeMenu = null;
				this.triggerEl?.setAttribute('aria-expanded', 'false');
			}
		});
		const rectangle = trigger.getBoundingClientRect();
		menu.showAtPosition(
			{ x: rectangle.left, y: rectangle.bottom },
			trigger.ownerDocument,
		);
		trigger.setAttribute('aria-expanded', 'true');
	}

	private addChoiceItem(
		menu: Menu,
		title: string,
		onClick: () => void,
	): MenuItem {
		let created: MenuItem | null = null;
		menu.addItem((item) => {
			created = item;
			item.setTitle(title).onClick(onClick);
		});
		if (!created) {
			throw new Error('Obsidian did not create the composer menu item.');
		}
		return created;
	}

	private choose(menu: Menu, callback: () => void): void {
		if (
			this.destroyed ||
			this.activeMenu?.menu !== menu ||
			this.state.disabled
		) {
			return;
		}
		menu.hide();
		callback();
	}

	private chooseWebMode(menu: Menu, mode: WebSearchMode): void {
		if (this.state.mode !== 'ask') {
			return;
		}
		this.choose(menu, () => this.callbacks.onWebSearchMode(mode));
	}

	private updateMenu(active: ActiveComposerMenu): void {
		const { state } = this;
		active.chatItem.setChecked(state.mode === 'ask').setDisabled(state.disabled);
		active.selectionItem.setChecked(
			state.mode === 'edit' && state.editTarget === 'selection',
		).setDisabled(state.disabled);
		active.fullNoteItem.setChecked(
			state.mode === 'edit' && state.editTarget === 'full-note',
		).setDisabled(state.disabled);
		const displayedWebMode = state.mode === 'edit' ? 'off' : state.webSearchMode;
		for (const mode of ['off', 'review', 'auto'] as const) {
			active.webItems[mode]
				.setChecked(displayedWebMode === mode)
				.setDisabled(state.disabled || state.mode === 'edit');
		}
	}
}

function writingSummary(state: ComposerPermissionState): string {
	if (state.mode === 'edit') {
		return state.editTarget === 'selection' ? 'Edit · Selection' : 'Edit · Full note';
	}
	if (state.webSearchMode === 'review') {
		return 'Chat · Review search';
	}
	if (state.webSearchMode === 'auto') {
		return 'Chat · Auto search';
	}
	return 'Chat';
}
