import { App, PluginSettingTab, setIcon, Setting } from 'obsidian';
import type EmendPlugin from './main';
import type {
	DiscoveredModel,
	EmendSettings,
	ProviderConfig,
	ProviderId,
	ReasoningEffort,
} from './types';

export const AI_PROVIDERS = [
	{
		id: 'deepseek',
		name: 'DeepSeek',
		defaultModel: 'deepseek-flash',
		defaultBaseUrl: 'https://api.deepseek.com',
	},
	{
		id: 'kimi',
		name: 'Kimi',
		defaultModel: 'k3.1-pro',
		defaultBaseUrl: 'https://api.kimi.com/coding/v1',
	},
	{
		id: 'custom',
		name: 'Custom',
		defaultModel: '',
		defaultBaseUrl: '',
	},
] as const;

const DEFAULT_MODES = ['ask', 'edit', 'discuss', 'brainstorm'] as const;
const REASONING_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high'];
const CUSTOM_MODEL_OPTION = '__custom__';

export const DEFAULT_SETTINGS: EmendSettings = {
	activeProvider: 'deepseek',
	providers: {
		deepseek: {
			name: 'DeepSeek',
			baseUrl: 'https://api.deepseek.com',
			apiKey: '',
			model: 'deepseek-flash',
			reasoningEffort: 'high',
			requestUsage: true,
			discoveredModels: [],
		},
		kimi: {
			name: 'Kimi',
			baseUrl: 'https://api.kimi.com/coding/v1',
			apiKey: '',
			model: 'k3.1-pro',
			reasoningEffort: 'high',
			requestUsage: true,
			discoveredModels: [],
		},
		custom: {
			name: 'Custom',
			baseUrl: '',
			apiKey: '',
			model: '',
			reasoningEffort: 'high',
			requestUsage: false,
			discoveredModels: [],
		},
	},
	defaultMode: 'ask',
	includeNotePathInContext: false,
	smartSelectionContext: true,
	maxContextCharacters: 12000,
};

export function normalizeSettings(data: unknown): EmendSettings {
	const root = isRecord(data) ? data : {};
	const persistedProviders = isRecord(root.providers) ? root.providers : {};
	const activeProvider = isProviderId(root.activeProvider)
		? root.activeProvider
		: DEFAULT_SETTINGS.activeProvider;
	const defaultMode = isDefaultMode(root.defaultMode)
		? root.defaultMode
		: DEFAULT_SETTINGS.defaultMode;

	return {
		activeProvider,
		providers: {
			deepseek: normalizeProviderConfig(
				DEFAULT_SETTINGS.providers.deepseek,
				persistedProviders.deepseek,
			),
			kimi: normalizeProviderConfig(
				DEFAULT_SETTINGS.providers.kimi,
				persistedProviders.kimi,
			),
			custom: normalizeProviderConfig(
				DEFAULT_SETTINGS.providers.custom,
				persistedProviders.custom,
			),
		},
		defaultMode,
		includeNotePathInContext:
			typeof root.includeNotePathInContext === 'boolean'
				? root.includeNotePathInContext
				: DEFAULT_SETTINGS.includeNotePathInContext,
		smartSelectionContext:
			typeof root.smartSelectionContext === 'boolean'
				? root.smartSelectionContext
				: DEFAULT_SETTINGS.smartSelectionContext,
		maxContextCharacters: normalizeContextLimit(root.maxContextCharacters),
	};
}

export function sanitizeSettings(settings: EmendSettings): EmendSettings {
	return {
		...settings,
		providers: {
			deepseek: { ...settings.providers.deepseek, apiKey: '' },
			kimi: { ...settings.providers.kimi, apiKey: '' },
			custom: { ...settings.providers.custom, apiKey: '' },
		},
	};
}

export function getProviderName(providerId: ProviderId) {
	return (
		AI_PROVIDERS.find((provider) => provider.id === providerId)?.name ??
		providerId
	);
}

export class EmendSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: EmendPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		this.renderSettings();
	}

	private renderSettings() {
		const { containerEl } = this;
		const activeProvider = this.plugin.settings.activeProvider;
		const provider = AI_PROVIDERS.find(
			(item) => item.id === activeProvider,
		);

		containerEl.empty();
		new Setting(containerEl)
			.setName('Active provider')
			.setDesc('Choose which provider receives AI requests.')
			.addDropdown((dropdown) => {
				for (const item of AI_PROVIDERS) {
					dropdown.addOption(item.id, item.name);
				}

				dropdown.setValue(activeProvider).onChange(async (value) => {
					if (!isProviderId(value)) {
						return;
					}

					this.plugin.settings.activeProvider = value;
					await this.plugin.saveSettings();
					this.renderSettings();
				});
			});

		if (!provider) {
			return;
		}

		const config = this.plugin.settings.providers[provider.id];
		new Setting(containerEl)
			.setName(`${provider.name} API key`)
			.setDesc('The key is stored locally in Obsidian secret storage.')
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder(`${provider.name} API key`)
					.setValue(this.plugin.getApiKey(provider.id))
					.onChange(async (value) => {
						await this.plugin.setApiKey(provider.id, value.trim());
					});
			});

		new Setting(containerEl)
			.setName(`${provider.name} base URL`)
			.setDesc('OpenAI-compatible API base URL.')
			.addText((text) =>
				text
					.setPlaceholder(provider.defaultBaseUrl || 'https://example.com/v1')
					.setValue(config.baseUrl)
					.onChange(async (value) => {
						config.baseUrl = value.trim();
						config.discoveredModels = [];
						await this.plugin.saveSettings();
					}),
			);

		const modelSetting = new Setting(containerEl)
			.setName(`${provider.name} model`)
			.setDesc('Choose the preset or enter a custom model name.');
		setIcon(modelSetting.nameEl.createSpan(), 'cpu');
		modelSetting
			.addDropdown((dropdown) => {
				if (provider.defaultModel) {
					dropdown.addOption(provider.defaultModel, provider.defaultModel);
				}
				if (config.model && config.model !== provider.defaultModel) {
					dropdown.addOption(config.model, config.model);
				}
				dropdown.addOption(CUSTOM_MODEL_OPTION, 'Custom model');
				dropdown
					.setValue(config.model || CUSTOM_MODEL_OPTION)
					.onChange(async (value) => {
						if (value === CUSTOM_MODEL_OPTION) {
							return;
						}

						config.model = value;
						await this.plugin.saveSettings();
						this.renderSettings();
					});
			})
			.addText((text) =>
				text
					.setPlaceholder('Custom model name')
					.setValue(config.model)
					.onChange(async (value) => {
						config.model = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		const reasoningSetting = new Setting(containerEl)
			.setName('Reasoning effort')
			.setDesc('Default reasoning effort for this provider.');
		setIcon(reasoningSetting.nameEl.createSpan(), 'brain');
		reasoningSetting.addDropdown((dropdown) => {
			for (const effort of REASONING_EFFORTS) {
				dropdown.addOption(effort, capitalize(effort));
			}

			dropdown
				.setValue(config.reasoningEffort)
				.onChange(async (value) => {
					if (!isReasoningEffort(value)) {
						return;
					}

					config.reasoningEffort = value;
					await this.plugin.saveSettings();
				});
		});

		new Setting(containerEl)
			.setName('Request token usage')
			.setDesc('Ask this provider to report token usage. Disable this if the provider rejects the option.')
			.addToggle((toggle) =>
				toggle.setValue(config.requestUsage).onChange(async (value) => {
					config.requestUsage = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Default mode')
			.setDesc('Initial chat mode for each chat session.')
			.addDropdown((dropdown) => {
				for (const mode of DEFAULT_MODES) {
					dropdown.addOption(mode, capitalize(mode));
				}

				dropdown
					.setValue(this.plugin.settings.defaultMode)
					.onChange(async (value) => {
						if (!isDefaultMode(value)) {
							return;
						}

						this.plugin.settings.defaultMode = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Include note path')
			.setDesc('Send the active note path with each AI request.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeNotePathInContext)
					.onChange(async (value) => {
						this.plugin.settings.includeNotePathInContext = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Smart selection context')
			.setDesc('Expand selection requests to containing and adjacent paragraphs without changing the edit target.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.smartSelectionContext)
					.onChange(async (value) => {
						this.plugin.settings.smartSelectionContext = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Context character limit')
			.setDesc('Maximum characters sent around selected text or the caret position in long notes.')
			.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = '1000';
				text.inputEl.step = '1000';
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.maxContextCharacters))
					.setValue(String(this.plugin.settings.maxContextCharacters))
					.onChange(async (value) => {
						this.plugin.settings.maxContextCharacters = normalizeContextLimit(
							Number.parseInt(value, 10),
						);
						await this.plugin.saveSettings();
					});
			});
	}
}

function normalizeProviderConfig(
	defaults: ProviderConfig,
	data: unknown,
): ProviderConfig {
	const config = isRecord(data) ? data : {};
	return {
		name: stringOrDefault(config.name, defaults.name),
		baseUrl: stringOrDefault(config.baseUrl, defaults.baseUrl),
		apiKey: stringOrDefault(config.apiKey, defaults.apiKey),
		model: stringOrDefault(config.model, defaults.model),
		reasoningEffort: isReasoningEffort(config.reasoningEffort)
			? config.reasoningEffort
			: defaults.reasoningEffort,
		requestUsage:
			typeof config.requestUsage === 'boolean'
				? config.requestUsage
				: defaults.requestUsage,
		discoveredModels: normalizeDiscoveredModels(config.discoveredModels),
	};
}

function normalizeDiscoveredModels(value: unknown): DiscoveredModel[] {
	if (!Array.isArray(value)) return [];
	const models: DiscoveredModel[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim()) continue;
		const id = entry.id.trim();
		if (seen.has(id)) continue;
		seen.add(id);
		models.push({
			id,
			displayName: typeof entry.displayName === 'string' && entry.displayName.trim()
				? entry.displayName.trim()
				: id,
		});
	}
	return models;
}

function normalizeContextLimit(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value)
		? Math.max(1000, Math.floor(value))
		: DEFAULT_SETTINGS.maxContextCharacters;
}

function stringOrDefault(value: unknown, fallback: string) {
	return typeof value === 'string' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProviderId(value: unknown): value is ProviderId {
	return AI_PROVIDERS.some((provider) => provider.id === value);
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
	return REASONING_EFFORTS.some((effort) => effort === value);
}

function isDefaultMode(
	value: unknown,
): value is EmendSettings['defaultMode'] {
	return DEFAULT_MODES.some((mode) => mode === value);
}

function capitalize(value: string) {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
