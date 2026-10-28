export class App {}

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
