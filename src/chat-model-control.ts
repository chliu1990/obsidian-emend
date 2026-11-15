import { Menu, type MenuItem } from 'obsidian';
import { getProviderModelOptions } from './provider-model-options';
import {
	AI_PROVIDERS,
	DEFAULT_SETTINGS,
	getProviderName,
	REASONING_EFFORTS,
} from './settings';
import type {
	EmendSettings,
	ProviderId,
	ReasoningEffort,
} from './types';

export interface ChatModelSelection {
	providerId: ProviderId;
	modelId: string;
}

export interface ChatModelControlState {
	settings: EmendSettings;
	disabled: boolean;
}

export interface ChatModelControlCallbacks {
	onSelect(
		selection: ChatModelSelection,
		effort: ReasoningEffort,
	): Promise<void>;
}

type ModelMenuEntry = {
	item: MenuItem;
	providerId: ProviderId;
	disabled: boolean;
} & (
	| { kind: 'model'; modelId: string }
	| { kind: 'effort'; effort: ReasoningEffort }
);

interface ActiveChatModelMenu {
	menu: Menu;
	entries: ModelMenuEntry[];
}

export class ChatModelControl {
	private state: ChatModelControlState = {
		settings: DEFAULT_SETTINGS,
		disabled: false,
	};
	private triggerEl: HTMLButtonElement | null = null;
	private activeMenu: ActiveChatModelMenu | null = null;
	private destroyed = false;

	constructor(private readonly callbacks: ChatModelControlCallbacks) {}

	render(container: HTMLElement, state: ChatModelControlState): void {
		if (this.destroyed) {
			return;
		}
		if (this.triggerEl) {
			this.update(state);
			return;
		}
		this.state = state;
		this.triggerEl = container.createEl('button', {
			cls: 'emend-chat-active-model',
			attr: {
				type: 'button',
				'aria-haspopup': 'menu',
				'aria-expanded': 'false',
			},
		});
		this.triggerEl.addEventListener('click', () => {
			if (!this.destroyed && !this.state.disabled) {
				this.openMenu();
			}
		});
		this.update(state);
	}

	update(state: ChatModelControlState): void {
		this.state = state;
		if (this.destroyed) {
			return;
		}
		this.updateTrigger();
		if (this.activeMenu) {
			this.updateMenu(this.activeMenu);
		}
	}

	refresh(settings: EmendSettings): void {
		this.update({ ...this.state, settings });
		this.activeMenu?.menu.hide();
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.activeMenu?.menu.hide();
		this.activeMenu = null;
		this.triggerEl?.remove();
		this.triggerEl = null;
	}

	private updateTrigger(): void {
		if (!this.triggerEl) {
			return;
		}
		const summary = modelSummary(this.state.settings);
		this.triggerEl.textContent = summary;
		this.triggerEl.title = summary;
		this.triggerEl.disabled = this.state.disabled;
		this.triggerEl.setAttribute(
			'aria-label',
			`Provider, model, and reasoning: ${summary}`,
		);
	}

	private openMenu(): void {
		const trigger = this.triggerEl;
		if (!trigger) {
			return;
		}
		this.activeMenu?.menu.hide();
		const menu = new Menu();
		const active: ActiveChatModelMenu = { menu, entries: [] };
		for (const [providerIndex, provider] of AI_PROVIDERS.entries()) {
			if (providerIndex > 0) {
				menu.addSeparator();
			}
			this.addItem(menu, provider.name).setDisabled(true);
			const config = this.state.settings.providers[provider.id];
			const options = getProviderModelOptions(provider.id, config);
			if (options.length === 0) {
				this.addItem(menu, 'No model configured').setDisabled(true);
			}
			for (const option of options) {
				const item = this.addItem(menu, option.label, () => {
					this.choose(active, false, () => this.callbacks.onSelect(
						{ providerId: provider.id, modelId: option.id },
						this.state.settings.providers[provider.id].reasoningEffort,
					));
				});
				active.entries.push({
					item,
					providerId: provider.id,
					kind: 'model',
					modelId: option.id,
					disabled: false,
				});
			}
			for (const effort of REASONING_EFFORTS) {
				const item = this.addItem(menu, effortLabel(effort), () => {
					this.choose(active, options.length === 0, () => this.callbacks.onSelect(
						{
							providerId: provider.id,
							modelId: this.state.settings.providers[provider.id].model.trim(),
						},
						effort,
					));
				});
				active.entries.push({
					item,
					providerId: provider.id,
					kind: 'effort',
					effort,
					disabled: options.length === 0,
				});
			}
		}
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

	private addItem(
		menu: Menu,
		title: string,
		onClick?: () => void,
	): MenuItem {
		let created: MenuItem | null = null;
		menu.addItem((item) => {
			created = item;
			item.setTitle(title);
			if (onClick) {
				item.onClick(onClick);
			}
		});
		if (!created) {
			throw new Error('Obsidian did not create the model menu item.');
		}
		return created;
	}

	private choose(
		active: ActiveChatModelMenu,
		itemDisabled: boolean,
		callback: () => Promise<void>,
	): void {
		if (
			this.destroyed ||
			this.activeMenu !== active ||
			this.state.disabled ||
			itemDisabled
		) {
			return;
		}
		active.menu.hide();
		void callback();
	}

	private updateMenu(active: ActiveChatModelMenu): void {
		const { settings, disabled } = this.state;
		for (const entry of active.entries) {
			const config = settings.providers[entry.providerId];
			const activeProvider = settings.activeProvider === entry.providerId;
			const checked = activeProvider && (entry.kind === 'model'
				? config.model.trim() === entry.modelId
				: config.reasoningEffort === entry.effort);
			entry.item
				.setChecked(checked)
				.setDisabled(disabled || entry.disabled);
		}
	}
}

function modelSummary(settings: EmendSettings): string {
	const providerId = settings.activeProvider;
	const config = settings.providers[providerId];
	const model = config.model.trim();
	const providerAndModel = model
		? `${getProviderName(providerId)} · ${model}`
		: getProviderName(providerId);
	return `${providerAndModel} · ${effortLabel(config.reasoningEffort, false)}`;
}

function effortLabel(effort: ReasoningEffort, reasoning = true): string {
	const label = effort.charAt(0).toUpperCase() + effort.slice(1);
	return reasoning ? `${label} reasoning` : label;
}
