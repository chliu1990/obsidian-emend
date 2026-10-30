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

export class Setting {
	constructor(_containerEl: unknown) {}
}
