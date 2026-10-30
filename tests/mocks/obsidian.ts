export class App {}

export class Plugin {}

export class MarkdownView {}

export class Modal {}

export class WorkspaceLeaf {}

export class ItemView {
	app = new App();
	contentEl = {};

	constructor(_leaf: WorkspaceLeaf) {}
}

export class MarkdownRenderer {
	static async render(): Promise<void> {}
}

export class Notice {
	constructor(_message?: string) {}
}

export function setIcon(): void {}

export class TFile {
	path = '';
}

export class FuzzySuggestModal<T> {
	items: T[] = [];

	constructor(_app: App) {}

	open(): void {}
}

export class PluginSettingTab {
	constructor(_app: App, _plugin: unknown) {}
}

interface TextComponent {
	inputEl: { type: string; min: string; step: string };
	value: string;
	onChangeHandler: (value: string) => unknown;
	setPlaceholder(value: string): TextComponent;
	setValue(value: string): TextComponent;
	onChange(handler: (value: string) => unknown): TextComponent;
}

export class Setting {
	static readonly instances: Setting[] = [];
	readonly texts: TextComponent[] = [];
	readonly nameEl = { createSpan: () => ({}) };
	name = '';

	constructor(_containerEl: unknown) {
		Setting.instances.push(this);
	}

	setName(name: string) {
		this.name = name;
		return this;
	}

	setDesc(_description: string) {
		return this;
	}

	addText(callback: (text: TextComponent) => unknown) {
		const text: TextComponent = {
			inputEl: { type: '', min: '', step: '' },
			value: '',
			onChangeHandler: () => undefined,
			setPlaceholder(_value) {
				return this;
			},
			setValue(value) {
				this.value = value;
				return this;
			},
			onChange(handler) {
				this.onChangeHandler = handler;
				return this;
			},
		};
		this.texts.push(text);
		callback(text);
		return this;
	}

	addDropdown(callback: (dropdown: {
		addOption(value: string, label: string): unknown;
		setValue(value: string): unknown;
		onChange(handler: (value: string) => unknown): unknown;
	}) => unknown) {
		const dropdown = {
			addOption: () => dropdown,
			setValue: () => dropdown,
			onChange: () => dropdown,
		};
		callback(dropdown);
		return this;
	}

	addToggle(callback: (toggle: {
		setValue(value: boolean): unknown;
		onChange(handler: (value: boolean) => unknown): unknown;
	}) => unknown) {
		const toggle = {
			setValue: () => toggle,
			onChange: () => toggle,
		};
		callback(toggle);
		return this;
	}
}

export class Scope {
	readonly keys: Array<{
		modifiers: string[] | null;
		key: string | null;
		func: (event: KeyboardEvent) => unknown;
		scope: Scope;
	}> = [];

	constructor(readonly parent?: Scope) {}

	register(
		modifiers: string[] | null,
		key: string | null,
		func: (event: KeyboardEvent) => unknown,
	) {
		const handler = { modifiers, key, func, scope: this };
		this.keys.push(handler);
		return handler;
	}

	unregister(handler: { scope: Scope }) {
		const index = this.keys.indexOf(
			handler as (typeof this.keys)[number],
		);
		if (index >= 0) {
			this.keys.splice(index, 1);
		}
	}
}
