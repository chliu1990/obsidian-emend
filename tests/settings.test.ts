import { readFileSync } from 'node:fs';
import { Notice, Setting } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverProviderModels } from '../src/model-discovery';
import {
	AI_PROVIDERS,
	DEFAULT_SETTINGS,
	EmendSettingTab,
	normalizeSettings,
} from '../src/settings';
import type EmendPlugin from '../src/main';
import type { Setting as MockSetting } from './mocks/obsidian';

vi.mock('../src/model-discovery', () => ({
	discoverProviderModels: vi.fn(),
}));

const settingInstances = (
	Setting as unknown as { readonly instances: MockSetting[] }
).instances;
const noticeMessages = (Notice as unknown as { readonly messages: string[] }).messages;

const manifest = JSON.parse(
	readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const packageMetadata = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

describe('publication metadata', () => {
	it('uses the current author and public GitHub metadata', () => {
		expect(manifest.author).toBe('Chang Liu and Kimi K3.1 Pro');
		expect(packageMetadata.author).toBe(manifest.author);
		expect(manifest.authorUrl).toBe('https://github.com/chliu1990');
		expect(packageMetadata.repository).toEqual({
			type: 'git',
			url: 'git+https://github.com/chliu1990/obsidian-emend.git',
		});
		expect(packageMetadata.bugs).toEqual({
			url: 'https://github.com/chliu1990/obsidian-emend/issues',
		});
	});

	it('retains version 2.3.0', () => {
		expect(manifest.version).toBe('2.3.0');
		expect(packageMetadata.version).toBe('2.3.0');
	});
});

describe('normalizeSettings', () => {
	it('returns clean Emend defaults for missing persisted data', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
	});

	it.each([
		42,
		'invalid',
		[],
		{ activeProvider: 'invalid' },
		{ providers: 'invalid' },
		{ providers: { deepseek: null, kimi: 42, custom: 'invalid' } },
	])('falls back to defaults for malformed persisted data %#', (data) => {
		expect(normalizeSettings(data)).toEqual(DEFAULT_SETTINGS);
	});

	it('provides exactly the DeepSeek, Kimi, and custom presets', () => {
		expect(AI_PROVIDERS).toEqual([
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
		]);
		expect(Object.keys(DEFAULT_SETTINGS.providers)).toEqual([
			'deepseek',
			'kimi',
			'custom',
		]);
		expect(DEFAULT_SETTINGS.providers.deepseek).toEqual({
			name: 'DeepSeek',
			baseUrl: 'https://api.deepseek.com',
			apiKey: '',
			model: 'deepseek-flash',
			reasoningEffort: 'high',
			requestUsage: true,
			discoveredModels: [],
		});
		expect(DEFAULT_SETTINGS.providers.kimi).toEqual({
			name: 'Kimi',
			baseUrl: 'https://api.kimi.com/coding/v1',
			apiKey: '',
			model: 'k3.1-pro',
			reasoningEffort: 'high',
			requestUsage: true,
			discoveredModels: [],
		});
		expect(DEFAULT_SETTINGS.providers.custom).toEqual({
			name: 'Custom',
			baseUrl: '',
			apiKey: '',
			model: '',
			reasoningEffort: 'high',
			requestUsage: false,
			discoveredModels: [],
		});
	});

	it('defaults to DeepSeek, ask mode, Operations-only editing, disabled note-path sharing, and smart selection context', () => {
		expect(DEFAULT_SETTINGS.activeProvider).toBe('deepseek');
		expect(DEFAULT_SETTINGS.defaultMode).toBe('ask');
		expect(DEFAULT_SETTINGS).not.toHaveProperty('editStrategy');
		expect(DEFAULT_SETTINGS.includeNotePathInContext).toBe(false);
		expect(DEFAULT_SETTINGS.smartSelectionContext).toBe(true);
		expect(DEFAULT_SETTINGS.maxContextCharacters).toBe(12000);
	});

	it.each(['operations', 'critic-markup', null, 'invalid', 0, false, [], {}])(
		'drops the legacy edit strategy while normalizing persisted value %#',
		(editStrategy) => {
			const settings = normalizeSettings({ editStrategy });
			expect(settings).toEqual(DEFAULT_SETTINGS);
			expect(settings).not.toHaveProperty('editStrategy');
		},
	);

	it('retains an explicit smart selection context opt-out', () => {
		expect(normalizeSettings({ smartSelectionContext: false })).toMatchObject({
			smartSelectionContext: false,
		});
	});

	it.each([null, 'false', 0, [], {}])(
		'normalizes malformed smart selection context values to true %#',
		(smartSelectionContext) => {
			expect(normalizeSettings({ smartSelectionContext })).toMatchObject({
				smartSelectionContext: true,
			});
		},
	);

	it('normalizes and deduplicates discovered model caches', () => {
		const settings = normalizeSettings({ providers: { deepseek: {
			discoveredModels: [
				{ id: ' model-a ', displayName: ' Model A ' },
				{ id: 'model-a', displayName: 'Duplicate' },
				{ id: '', displayName: 'Invalid' },
				{ id: 'model-b', displayName: '' },
				null,
			],
		} } });
		expect(settings.providers.deepseek.discoveredModels).toEqual([
			{ id: 'model-a', displayName: 'Model A' },
			{ id: 'model-b', displayName: 'model-b' },
		]);
		expect(settings.providers.kimi.discoveredModels).toEqual([]);
	});

	it('drops malformed discovered model caches', () => {
		for (const discoveredModels of ['invalid', 42, {}, null]) {
			expect(normalizeSettings({ providers: { kimi: { discoveredModels } } })
				.providers.kimi.discoveredModels).toEqual([]);
		}
	});

	it('retains valid user-entered settings for every provider', () => {
		const data = {
			activeProvider: 'custom',
			providers: {
				deepseek: {
					name: 'DeepSeek',
					baseUrl: 'https://deepseek.example.test/v1',
					apiKey: 'deepseek-user-key',
					model: 'deepseek-user-model',
					reasoningEffort: 'low',
					requestUsage: false,
					discoveredModels: [],
				},
				kimi: {
					name: 'Kimi',
					baseUrl: 'https://kimi.example.test/v1',
					apiKey: 'kimi-user-key',
					model: 'kimi-user-model',
					reasoningEffort: 'medium',
					requestUsage: true,
					discoveredModels: [],
				},
				custom: {
					name: 'Custom',
					baseUrl: 'https://custom.example.test/v1',
					apiKey: 'custom-user-key',
					model: 'custom-user-model',
					reasoningEffort: 'high',
					requestUsage: true,
					discoveredModels: [],
				},
			},
			defaultMode: 'discuss',
			includeNotePathInContext: true,
			smartSelectionContext: false,
			maxContextCharacters: 24000,
		};

		expect(normalizeSettings(data)).toEqual(data);
	});

	it('normalizes invalid provider fields without discarding valid sibling fields', () => {
		const settings = normalizeSettings({
			activeProvider: 'kimi',
			providers: {
				kimi: {
					baseUrl: 'https://kimi.example.test/v1',
					apiKey: 'user-key',
					model: 'user-model',
					reasoningEffort: 'maximum',
					requestUsage: 'yes',
				},
			},
		});

		expect(settings.activeProvider).toBe('kimi');
		expect(settings.providers.kimi).toEqual({
			...DEFAULT_SETTINGS.providers.kimi,
			baseUrl: 'https://kimi.example.test/v1',
			apiKey: 'user-key',
			model: 'user-model',
			reasoningEffort: 'high',
		});
	});

	it('enforces the context minimum and default for invalid numbers', () => {
		expect(normalizeSettings({ maxContextCharacters: 999 }).maxContextCharacters).toBe(1000);
		expect(normalizeSettings({ maxContextCharacters: 24000 }).maxContextCharacters).toBe(24000);
		expect(normalizeSettings({ maxContextCharacters: Number.NaN }).maxContextCharacters).toBe(12000);
		expect(normalizeSettings({ maxContextCharacters: Number.POSITIVE_INFINITY }).maxContextCharacters).toBe(12000);
	});

	it('does not retain legacy providers or instruction-file settings', () => {
		const settings = normalizeSettings({
			activeProvider: 'openai',
			providers: {
				openai: { apiKey: 'legacy-key' },
				gemini: { apiKey: 'legacy-key' },
				claude: { apiKey: 'legacy-key' },
			},
			apiKeys: { openai: 'legacy-key' },
			models: { openai: 'legacy-model' },
			agentInstructionsFilePath: 'legacy-instructions.md',
		});

		expect(settings.activeProvider).toBe('deepseek');
		expect(Object.keys(settings.providers)).toEqual([
			'deepseek',
			'kimi',
			'custom',
		]);
		expect(settings).not.toHaveProperty('openai');
		expect(settings).not.toHaveProperty('gemini');
		expect(settings).not.toHaveProperty('claude');
		expect(settings).not.toHaveProperty('agentInstructionsFilePath');
		expect(settings).not.toHaveProperty('apiKeys');
		expect(settings).not.toHaveProperty('models');
	});
});

describe('EmendSettingTab API keys', () => {
	it('keeps the input masked and delegates reads and writes to the plugin helpers', async () => {
		const instances = (
			Setting as unknown as {
				instances: Array<{
					name: string;
					texts: Array<{
						inputEl: { type: string };
						value: string;
						onChangeHandler(value: string): Promise<void>;
					}>;
				}>;
			}
		).instances;
		instances.length = 0;
		const plugin = {
			settings: structuredClone(DEFAULT_SETTINGS),
			getApiKey: vi.fn(() => 'dummy-stored-key'),
			setApiKey: vi.fn(async () => undefined),
		};
		const tab = new EmendSettingTab(
			{} as ConstructorParameters<typeof EmendSettingTab>[0],
			plugin as unknown as EmendPlugin,
		);
		Object.assign(tab, { containerEl: { empty: vi.fn() } });

		(tab as unknown as { display(): void }).display();

		const setting = instances.find(
			(candidate) => candidate.name === 'DeepSeek API key',
		);
		const text = setting?.texts[0];
		expect(text?.inputEl.type).toBe('password');
		expect(text?.value).toBe('dummy-stored-key');
		expect(plugin.getApiKey).toHaveBeenCalledWith('deepseek');
		await text?.onChangeHandler(' dummy-updated-key ');
		expect(plugin.setApiKey).toHaveBeenCalledWith(
			'deepseek',
			'dummy-updated-key',
		);
		expect(plugin.settings.providers.deepseek.apiKey).toBe('');
	});
});

describe('EmendSettingTab discovered model cache invalidation', () => {
	it('clears only the provider cache when its base URL changes', async () => {
		const instances = (
			Setting as unknown as {
				instances: Array<{
					name: string;
					texts: Array<{
						onChangeHandler(value: string): Promise<void>;
					}>;
				}>;
			}
		).instances;
		instances.length = 0;
		const plugin = {
			settings: structuredClone(DEFAULT_SETTINGS),
			getApiKey: vi.fn(() => ''),
			saveSettings: vi.fn(async () => undefined),
		};
		plugin.settings.providers.deepseek.discoveredModels = [
			{ id: 'deepseek-model', displayName: 'DeepSeek model' },
		];
		plugin.settings.providers.kimi.discoveredModels = [
			{ id: 'kimi-model', displayName: 'Kimi model' },
		];
		const tab = new EmendSettingTab(
			{} as ConstructorParameters<typeof EmendSettingTab>[0],
			plugin as unknown as EmendPlugin,
		);
		Object.assign(tab, { containerEl: { empty: vi.fn() } });
		(tab as unknown as { display(): void }).display();
		const text = instances.find(
			(candidate) => candidate.name === 'DeepSeek base URL',
		)?.texts[0];

		await text?.onChangeHandler(' https://deepseek.example.test/v1 ');

		expect(plugin.settings.providers.deepseek.baseUrl).toBe(
			'https://deepseek.example.test/v1',
		);
		expect(plugin.settings.providers.deepseek.discoveredModels).toEqual([]);
		expect(plugin.settings.providers.kimi.discoveredModels).toEqual([
			{ id: 'kimi-model', displayName: 'Kimi model' },
		]);
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
	});
});

function latestSetting(name: string) {
	const matches = settingInstances.filter((setting) => setting.name === name);
	const setting = matches[matches.length - 1];
	if (!setting) throw new Error(`Missing setting: ${name}`);
	return setting;
}

function latestModelSetting() {
	return latestSetting('DeepSeek model');
}

function latestDropdown(name: string) {
	const dropdown = latestSetting(name).dropdowns[0];
	if (!dropdown) throw new Error(`Missing dropdown: ${name}`);
	return dropdown;
}

function latestModelButton() {
	const button = latestModelSetting().buttons[0];
	if (!button) throw new Error('Missing model refresh button');
	return button;
}

function latestModelText() {
	const text = latestModelSetting().texts[0];
	if (!text) throw new Error('Missing custom model text input');
	return text;
}

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function createModelSettingsTab() {
	const apiKeys = {
		deepseek: 'dummy-key',
		kimi: 'dummy-key',
		custom: 'dummy-key',
	};
	const plugin = {
		settings: structuredClone(DEFAULT_SETTINGS),
		getApiKey: vi.fn((providerId: keyof typeof apiKeys) => apiKeys[providerId]),
		setApiKey: vi.fn(async (providerId: keyof typeof apiKeys, value: string) => {
			apiKeys[providerId] = value;
			plugin.settings.providers[providerId].discoveredModels = [];
		}),
		saveSettings: vi.fn(async () => undefined),
	};
	const tab = new EmendSettingTab(
		{} as ConstructorParameters<typeof EmendSettingTab>[0],
		plugin as unknown as EmendPlugin,
	);
	Object.assign(tab, { containerEl: { empty: vi.fn() } });
	return { plugin, tab };
}

function displaySettings(tab: EmendSettingTab) {
	(tab as unknown as { display(): void }).display();
}

describe('EmendSettingTab model discovery', () => {
	beforeEach(() => {
		settingInstances.length = 0;
		noticeMessages.length = 0;
		vi.mocked(discoverProviderModels).mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('renders a compact accessible refresh icon without visible text', () => {
		const { tab } = createModelSettingsTab();
		displaySettings(tab);
		const button = latestModelButton();
		expect(button.icon).toBe('refresh-cw');
		expect(button.tooltip).toBe('Refresh models');
		expect(button.buttonEl.attributes['aria-label']).toBe('Refresh models');
		expect(button.buttonEl.classList.contains('clickable-icon')).toBe(true);
		expect(button.text).toBe('');
	});

	it('does not expose raw HTTP response bodies in refresh notices', async () => {
		const actualDiscovery = await vi.importActual<typeof import('../src/model-discovery')>(
			'../src/model-discovery',
		);
		vi.mocked(discoverProviderModels).mockImplementation(
			actualDiscovery.discoverProviderModels,
		);
		const sensitiveBody = 'sensitive-provider-response-body';
		const fetchMock = vi.fn().mockResolvedValue(new Response(sensitiveBody, {
			status: 401,
		}));
		vi.stubGlobal('fetch', fetchMock);
		const { plugin, tab } = createModelSettingsTab();
		plugin.settings.providers.deepseek.discoveredModels = [
			{ id: 'cached-model', displayName: 'Cached model' },
		];
		displaySettings(tab);

		await latestModelButton().clickHandler();

		expect(noticeMessages).toHaveLength(1);
		expect(noticeMessages[0]).toContain('HTTP 401');
		expect(noticeMessages[0]).not.toContain(sensitiveBody);
		expect(plugin.settings.providers.deepseek.discoveredModels).toEqual([
			{ id: 'cached-model', displayName: 'Cached model' },
		]);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it('does not discover models on display or provider switching', async () => {
		const { tab } = createModelSettingsTab();

		displaySettings(tab);
		expect(discoverProviderModels).not.toHaveBeenCalled();
		await latestDropdown('Active provider').onChangeHandler('kimi');

		expect(discoverProviderModels).not.toHaveBeenCalled();
	});

	it('renders preset, cache, current model, and custom options without duplicates', () => {
		const { plugin, tab } = createModelSettingsTab();
		plugin.settings.providers.deepseek.model = 'local-custom';
		plugin.settings.providers.deepseek.discoveredModels = [
			{ id: 'deepseek-flash', displayName: 'Duplicate preset' },
			{ id: 'model-a', displayName: 'Model A' },
			{ id: 'local-custom', displayName: 'Duplicate current' },
		];

		displaySettings(tab);

		const dropdown = latestDropdown('DeepSeek model');
		expect(dropdown.options).toEqual({
			'deepseek-flash': 'Duplicate preset',
			'model-a': 'Model A',
			'local-custom': 'local-custom',
			__custom__: 'Custom model',
		});
		expect(Object.keys(dropdown.options)).toEqual([
			'deepseek-flash',
			'model-a',
			'local-custom',
			'__custom__',
		]);
		expect(dropdown.value).toBe('local-custom');
		expect(discoverProviderModels).not.toHaveBeenCalled();
	});

	it('refreshes once and preserves the current custom model', async () => {
		vi.mocked(discoverProviderModels).mockResolvedValue([
			{ id: 'model-a', displayName: 'Model A' },
		]);
		const { plugin, tab } = createModelSettingsTab();
		plugin.settings.providers.deepseek.model = 'local-custom';
		displaySettings(tab);

		await latestModelButton().clickHandler();

		const dropdown = latestDropdown('DeepSeek model');
		expect(dropdown.options).toMatchObject({
			'deepseek-flash': 'deepseek-flash',
			'model-a': 'Model A',
			'local-custom': 'local-custom',
			__custom__: 'Custom model',
		});
		expect(dropdown.value).toBe('local-custom');
		expect(latestModelText().value).toBe('local-custom');
		expect(plugin.settings.providers.deepseek.model).toBe('local-custom');
		expect(plugin.settings.providers.deepseek.discoveredModels).toEqual([
			{ id: 'model-a', displayName: 'Model A' },
		]);
		expect(discoverProviderModels).toHaveBeenCalledOnce();
		expect(discoverProviderModels).toHaveBeenCalledWith({
			name: 'DeepSeek',
			baseUrl: 'https://api.deepseek.com',
			apiKey: 'dummy-key',
		});
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		expect(noticeMessages).toHaveLength(1);
		expect(noticeMessages[0]).not.toContain('dummy-key');
		expect(latestModelButton().buttonEl.disabled).toBe(false);
	});

	it('allows only one in-flight refresh click', async () => {
		const pending = createDeferred<Awaited<ReturnType<typeof discoverProviderModels>>>();
		vi.mocked(discoverProviderModels).mockReturnValue(pending.promise);
		const { plugin, tab } = createModelSettingsTab();
		displaySettings(tab);
		const button = latestModelButton();

		const firstClick = button.clickHandler();
		expect(button.buttonEl.disabled).toBe(true);
		expect(button.buttonEl.classList.contains('mod-loading')).toBe(false);
		const secondClick = button.clickHandler();
		await secondClick;

		expect(discoverProviderModels).toHaveBeenCalledOnce();
		pending.resolve([{ id: 'model-a', displayName: 'Model A' }]);
		await firstClick;
		expect(discoverProviderModels).toHaveBeenCalledOnce();
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		expect(latestModelButton().buttonEl.disabled).toBe(false);
	});

	it.each([
		{
			scenario: 'a blank API key',
			apiKey: '',
			errorMessage: 'DeepSeek API key is missing.',
		},
		{
			scenario: 'an HTTP failure',
			apiKey: 'dummy-key',
			errorMessage: 'Model discovery failed with HTTP 401.',
		},
	])('preserves cache and model without saving after $scenario', async ({
		apiKey,
		errorMessage,
	}) => {
		vi.mocked(discoverProviderModels).mockRejectedValue(new Error(errorMessage));
		const { plugin, tab } = createModelSettingsTab();
		plugin.getApiKey.mockReturnValue(apiKey);
		plugin.settings.providers.deepseek.model = 'local-custom';
		plugin.settings.providers.deepseek.discoveredModels = [
			{ id: 'cached-model', displayName: 'Cached model' },
		];
		displaySettings(tab);

		await latestModelButton().clickHandler();

		expect(plugin.settings.providers.deepseek.model).toBe('local-custom');
		expect(plugin.settings.providers.deepseek.discoveredModels).toEqual([
			{ id: 'cached-model', displayName: 'Cached model' },
		]);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		expect(noticeMessages).toEqual([`Emend: ${errorMessage}`]);
		expect(latestModelButton().buttonEl.disabled).toBe(false);
	});

	it.each(['provider', 'base URL', 'API key'] as const)(
		'discards a stale result after %s changes',
		async (change) => {
			const pending = createDeferred<Awaited<ReturnType<typeof discoverProviderModels>>>();
			vi.mocked(discoverProviderModels).mockReturnValue(pending.promise);
			const { plugin, tab } = createModelSettingsTab();
			plugin.settings.providers.deepseek.model = 'local-custom';
			plugin.settings.providers.deepseek.discoveredModels = [
				{ id: 'cached-model', displayName: 'Cached model' },
			];
			displaySettings(tab);
			const click = latestModelButton().clickHandler();

			if (change === 'provider') {
				await latestDropdown('Active provider').onChangeHandler('kimi');
				const rerenderedButton = latestSetting('Kimi model').buttons[0];
				expect(rerenderedButton?.buttonEl.disabled).toBe(true);
				expect(rerenderedButton?.buttonEl.classList.contains('clickable-icon')).toBe(true);
				expect(rerenderedButton?.buttonEl.classList.contains('mod-loading')).toBe(false);
			} else if (change === 'base URL') {
				await latestSetting('DeepSeek base URL').texts[0]?.onChangeHandler(
					'https://deepseek.example.test/v1',
				);
			} else {
				await latestSetting('DeepSeek API key').texts[0]?.onChangeHandler(
					'updated-key',
				);
			}
			const saveCountAfterChange = plugin.saveSettings.mock.calls.length;

			pending.resolve([{ id: 'stale-model', displayName: 'Stale model' }]);
			await click;

			expect(plugin.settings.providers.deepseek.discoveredModels).toEqual(
				change === 'provider'
					? [{ id: 'cached-model', displayName: 'Cached model' }]
					: [],
			);
			expect(plugin.settings.providers.deepseek.model).toBe('local-custom');
			expect(plugin.saveSettings).toHaveBeenCalledTimes(saveCountAfterChange);
			expect(noticeMessages).toEqual([]);
			expect(discoverProviderModels).toHaveBeenCalledOnce();
			if (change === 'provider') {
				expect(
					latestSetting('Kimi model').buttons[0]?.buttonEl.disabled,
				).toBe(false);
			}
		},
	);
});
