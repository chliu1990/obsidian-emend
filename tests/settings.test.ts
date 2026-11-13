import { readFileSync } from 'node:fs';
import { Notice, Setting } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INVALID_CONTEXT_CAPACITY_MESSAGE } from '../src/context-accounting';
import { discoverProviderModels } from '../src/model-discovery';
import {
	AI_PROVIDERS,
	DEFAULT_SETTINGS,
	EmendSettingTab,
	normalizeSettings,
	sanitizeSettings,
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

	it('retains version 2.9.0', () => {
		expect(manifest.version).toBe('2.9.0');
		expect(packageMetadata.version).toBe('2.9.0');
	});
});

describe('normalizeSettings', () => {
	it('returns clean Emend defaults for missing persisted data', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
	});

	it.each([
		['ask', 'ask'],
		['edit', 'edit'],
		['discuss', 'ask'],
		['brainstorm', 'ask'],
		['invalid', 'ask'],
		[null, 'ask'],
		[42, 'ask'],
	] as const)('normalizes new-request default mode %s to %s', (defaultMode, expected) => {
		expect(normalizeSettings({ defaultMode }).defaultMode).toBe(expected);
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
			contextWindowTokens: null,
			outputReserveTokens: null,
			contextCapacityInvalid: false,
		});
		expect(DEFAULT_SETTINGS.providers.kimi).toEqual({
			name: 'Kimi',
			baseUrl: 'https://api.kimi.com/coding/v1',
			apiKey: '',
			model: 'k3.1-pro',
			reasoningEffort: 'high',
			requestUsage: true,
			discoveredModels: [],
			contextWindowTokens: null,
			outputReserveTokens: null,
			contextCapacityInvalid: false,
		});
		expect(DEFAULT_SETTINGS.providers.custom).toEqual({
			name: 'Custom',
			baseUrl: '',
			apiKey: '',
			model: '',
			reasoningEffort: 'high',
			requestUsage: false,
			discoveredModels: [],
			contextWindowTokens: null,
			outputReserveTokens: null,
			contextCapacityInvalid: false,
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
					contextWindowTokens: 128000,
					outputReserveTokens: 8000,
					contextCapacityInvalid: false,
				},
				kimi: {
					name: 'Kimi',
					baseUrl: 'https://kimi.example.test/v1',
					apiKey: 'kimi-user-key',
					model: 'kimi-user-model',
					reasoningEffort: 'medium',
					requestUsage: true,
					discoveredModels: [],
					contextWindowTokens: null,
					outputReserveTokens: null,
					contextCapacityInvalid: false,
				},
				custom: {
					name: 'Custom',
					baseUrl: 'https://custom.example.test/v1',
					apiKey: 'custom-user-key',
					model: 'custom-user-model',
					reasoningEffort: 'high',
					requestUsage: true,
					discoveredModels: [],
					contextWindowTokens: 32000,
					outputReserveTokens: 4000,
					contextCapacityInvalid: false,
				},
			},
			defaultMode: 'edit',
			includeNotePathInContext: true,
			smartSelectionContext: false,
			maxContextCharacters: 24000,
			maxWebToolCalls: 12,
			maxWebContentCharactersPerCall: 24000,
			historyMessageLimit: 12,
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

	it('defaults and bounds the web tool call limit', () => {
		expect(DEFAULT_SETTINGS.maxWebToolCalls).toBe(8);
		expect(normalizeSettings({ maxWebToolCalls: 0 }).maxWebToolCalls).toBe(1);
		expect(normalizeSettings({ maxWebToolCalls: 12.9 }).maxWebToolCalls).toBe(12);
		expect(normalizeSettings({ maxWebToolCalls: 99 }).maxWebToolCalls).toBe(20);
		expect(normalizeSettings({ maxWebToolCalls: '8' }).maxWebToolCalls).toBe(8);
		expect(normalizeSettings({ maxWebToolCalls: Number.NaN }).maxWebToolCalls).toBe(8);
	});

	it('defaults, bounds, and floors the chat history message limit', () => {
		expect(DEFAULT_SETTINGS.historyMessageLimit).toBe(8);
		expect(normalizeSettings({}).historyMessageLimit).toBe(8);
		expect(normalizeSettings({ historyMessageLimit: 0 }).historyMessageLimit).toBe(0);
		expect(normalizeSettings({ historyMessageLimit: 50 }).historyMessageLimit).toBe(50);
		expect(normalizeSettings({ historyMessageLimit: 51 }).historyMessageLimit).toBe(50);
		expect(normalizeSettings({ historyMessageLimit: -3 }).historyMessageLimit).toBe(0);
		expect(normalizeSettings({ historyMessageLimit: 7.9 }).historyMessageLimit).toBe(7);
		expect(normalizeSettings({ historyMessageLimit: Number.NaN }).historyMessageLimit).toBe(8);
		expect(normalizeSettings({ historyMessageLimit: Number.POSITIVE_INFINITY }).historyMessageLimit).toBe(8);
		expect(normalizeSettings({ historyMessageLimit: '12' }).historyMessageLimit).toBe(8);
		expect(normalizeSettings({ historyMessageLimit: null }).historyMessageLimit).toBe(8);
	});

	it('persists a valid chat history limit through sanitized settings', () => {
		const normalized = normalizeSettings({ historyMessageLimit: 12 });

		const sanitized = sanitizeSettings(normalized);

		expect(sanitized.historyMessageLimit).toBe(12);
		expect(sanitized.providers.deepseek.apiKey).toBe('');
		expect(sanitized.providers.kimi.apiKey).toBe('');
		expect(sanitized.providers.custom.apiKey).toBe('');
	});

	it('defaults, floors, and clamps the per-call web output character cap', () => {
		expect(DEFAULT_SETTINGS.maxWebContentCharactersPerCall).toBe(20000);
		expect(normalizeSettings({}).maxWebContentCharactersPerCall).toBe(20000);
		expect(normalizeSettings({
			maxWebContentCharactersPerCall: 19999.9,
		}).maxWebContentCharactersPerCall).toBe(19999);
		expect(normalizeSettings({
			maxWebContentCharactersPerCall: 999,
		}).maxWebContentCharactersPerCall).toBe(1000);
		expect(normalizeSettings({
			maxWebContentCharactersPerCall: 100001,
		}).maxWebContentCharactersPerCall).toBe(100000);
	});

	it.each([
		null,
		'20000',
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		[],
		{},
	])('restores the default per-call web output cap for malformed value %#', (
		maxWebContentCharactersPerCall,
	) => {
		expect(normalizeSettings({
			maxWebContentCharactersPerCall,
		}).maxWebContentCharactersPerCall).toBe(20000);
	});

	it('sanitizes API keys without changing provider configs or independent web limits', () => {
		const normalized = normalizeSettings({
			maxWebContentCharactersPerCall: 30000,
			providers: {
				deepseek: {
					baseUrl: 'https://deepseek.example.test/v1',
					apiKey: 'deepseek-secret',
				},
				kimi: { model: 'kimi-custom', apiKey: 'kimi-secret' },
				custom: { requestUsage: true, apiKey: 'custom-secret' },
			},
		});

		const sanitized = sanitizeSettings(normalized);

		expect(sanitized.maxWebContentCharactersPerCall).toBe(30000);
		expect(sanitized.maxWebToolCalls).toBe(8);
		expect(sanitized.providers.deepseek).toEqual({
			...DEFAULT_SETTINGS.providers.deepseek,
			baseUrl: 'https://deepseek.example.test/v1',
			apiKey: '',
		});
		expect(sanitized.providers.kimi).toEqual({
			...DEFAULT_SETTINGS.providers.kimi,
			model: 'kimi-custom',
			apiKey: '',
		});
		expect(sanitized.providers.custom).toEqual({
			...DEFAULT_SETTINGS.providers.custom,
			requestUsage: true,
			apiKey: '',
		});
		expect(normalized.providers.deepseek.apiKey).toBe('deepseek-secret');
		expect(normalized.providers.kimi.apiKey).toBe('kimi-secret');
		expect(normalized.providers.custom.apiKey).toBe('custom-secret');
	});

	it('defaults every provider to unconfigured context capacity', () => {
		for (const providerId of ['deepseek', 'kimi', 'custom'] as const) {
			expect(DEFAULT_SETTINGS.providers[providerId]).toMatchObject({
				contextWindowTokens: null,
				outputReserveTokens: null,
				contextCapacityInvalid: false,
			});
		}
	});

	it.each([undefined, null])(
		'treats absent or null capacity values as unconfigured %#',
		(capacityValue) => {
			const settings = normalizeSettings({
				providers: {
					deepseek: {
						contextWindowTokens: capacityValue,
						outputReserveTokens: capacityValue,
					},
				},
			});

			expect(settings.providers.deepseek).toMatchObject({
				contextWindowTokens: null,
				outputReserveTokens: null,
				contextCapacityInvalid: false,
			});
		},
	);

	it('keeps a valid capacity pair with a cleared marker', () => {
		const settings = normalizeSettings({
			providers: {
				deepseek: {
					contextWindowTokens: 128000,
					outputReserveTokens: 8000,
					contextCapacityInvalid: false,
				},
			},
		});

		expect(settings.providers.deepseek).toMatchObject({
			contextWindowTokens: 128000,
			outputReserveTokens: 8000,
			contextCapacityInvalid: false,
		});
	});

	it('marks one present value invalid while preserving it', () => {
		const settings = normalizeSettings({
			providers: {
				deepseek: { contextWindowTokens: 128000 },
				kimi: { outputReserveTokens: 8000 },
			},
		});

		expect(settings.providers.deepseek).toMatchObject({
			contextWindowTokens: 128000,
			outputReserveTokens: null,
			contextCapacityInvalid: true,
		});
		expect(settings.providers.kimi).toMatchObject({
			contextWindowTokens: null,
			outputReserveTokens: 8000,
			contextCapacityInvalid: true,
		});
	});

	it('drops a malformed value while preserving its valid sibling', () => {
		const settings = normalizeSettings({
			providers: {
				deepseek: {
					contextWindowTokens: '128000',
					outputReserveTokens: 8000,
				},
			},
		});

		expect(settings.providers.deepseek).toMatchObject({
			contextWindowTokens: null,
			outputReserveTokens: 8000,
			contextCapacityInvalid: true,
		});
	});

	it('clears both malformed values but keeps the invalid marker', () => {
		const settings = normalizeSettings({
			providers: {
				deepseek: {
					contextWindowTokens: '128000',
					outputReserveTokens: '8000',
				},
			},
		});

		expect(settings.providers.deepseek).toMatchObject({
			contextWindowTokens: null,
			outputReserveTokens: null,
			contextCapacityInvalid: true,
		});
	});

	it('keeps a persisted invalid marker when both values are cleared', () => {
		const settings = normalizeSettings({
			providers: {
				kimi: {
					contextWindowTokens: null,
					outputReserveTokens: null,
					contextCapacityInvalid: true,
				},
			},
		});

		expect(settings.providers.kimi).toMatchObject({
			contextWindowTokens: null,
			outputReserveTokens: null,
			contextCapacityInvalid: true,
		});
	});

	it('fixes a persisted invalid marker once a valid pair is saved', () => {
		const settings = normalizeSettings({
			providers: {
				custom: {
					contextWindowTokens: 32000,
					outputReserveTokens: 4000,
					contextCapacityInvalid: true,
				},
			},
		});

		expect(settings.providers.custom).toMatchObject({
			contextWindowTokens: 32000,
			outputReserveTokens: 4000,
			contextCapacityInvalid: false,
		});
	});

	it.each([
		['zero', 0],
		['negative', -1],
		['decimal', 128000.5],
		['NaN', Number.NaN],
		['Infinity', Number.POSITIVE_INFINITY],
		['string', '128000'],
		['object', {}],
		['array', []],
	])('rejects malformed capacity input: %s', (_label, contextWindowTokens) => {
		const settings = normalizeSettings({
			providers: {
				deepseek: { contextWindowTokens, outputReserveTokens: 8000 },
			},
		});

		expect(settings.providers.deepseek).toMatchObject({
			contextWindowTokens: null,
			outputReserveTokens: 8000,
			contextCapacityInvalid: true,
		});
	});

	it.each([
		['equal to the window', 8000, 8000],
		['greater than the window', 4000, 8000],
	] as const)('marks a reserve %s invalid while preserving both values', (
		_label,
		contextWindowTokens,
		outputReserveTokens,
	) => {
		const settings = normalizeSettings({
			providers: {
				deepseek: { contextWindowTokens, outputReserveTokens },
			},
		});

		expect(settings.providers.deepseek).toMatchObject({
			contextWindowTokens,
			outputReserveTokens,
			contextCapacityInvalid: true,
		});
	});

	it('normalizes each provider capacity independently', () => {
		const settings = normalizeSettings({
			providers: {
				deepseek: {
					contextWindowTokens: 128000,
					outputReserveTokens: 8000,
				},
				kimi: { contextWindowTokens: 8000, outputReserveTokens: 8000 },
				custom: {},
			},
		});

		expect(settings.providers.deepseek.contextCapacityInvalid).toBe(false);
		expect(settings.providers.deepseek.contextWindowTokens).toBe(128000);
		expect(settings.providers.kimi.contextCapacityInvalid).toBe(true);
		expect(settings.providers.kimi.contextWindowTokens).toBe(8000);
		expect(settings.providers.custom).toMatchObject({
			contextWindowTokens: null,
			outputReserveTokens: null,
			contextCapacityInvalid: false,
		});
	});

	it('round-trips capacity values and the invalid marker through sanitized saves', () => {
		const normalized = normalizeSettings({
			providers: {
				deepseek: {
					contextWindowTokens: 128000,
					outputReserveTokens: 8000,
					contextCapacityInvalid: false,
					apiKey: 'deepseek-secret',
				},
				kimi: { contextCapacityInvalid: true, apiKey: 'kimi-secret' },
				custom: {
					contextWindowTokens: 1000,
					outputReserveTokens: 2000,
					apiKey: 'custom-secret',
				},
			},
		});

		const sanitized = sanitizeSettings(normalized);

		expect(sanitized.providers.deepseek).toMatchObject({
			contextWindowTokens: 128000,
			outputReserveTokens: 8000,
			contextCapacityInvalid: false,
			apiKey: '',
		});
		expect(sanitized.providers.kimi).toMatchObject({
			contextWindowTokens: null,
			outputReserveTokens: null,
			contextCapacityInvalid: true,
			apiKey: '',
		});
		expect(sanitized.providers.custom).toMatchObject({
			contextWindowTokens: 1000,
			outputReserveTokens: 2000,
			contextCapacityInvalid: true,
			apiKey: '',
		});
		const reloaded = normalizeSettings(sanitized);
		expect(reloaded.providers.deepseek.contextCapacityInvalid).toBe(false);
		expect(reloaded.providers.kimi.contextCapacityInvalid).toBe(true);
		expect(reloaded.providers.custom.contextCapacityInvalid).toBe(true);
		expect(
			reloaded.providers.deepseek.contextWindowTokens,
		).toBe(128000);
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

describe('EmendSettingTab default mode', () => {
	beforeEach(() => {
		settingInstances.length = 0;
	});

	it('offers exactly Chat and Edit and ignores non-selectable runtime values', async () => {
		const { plugin, tab } = createModelSettingsTab();
		displaySettings(tab);
		const dropdown = latestDropdown('Default mode');

		expect(dropdown.options).toEqual({ ask: 'Chat', edit: 'Edit' });
		await dropdown.onChangeHandler('discuss');
		expect(plugin.settings.defaultMode).toBe('ask');
		expect(plugin.saveSettings).not.toHaveBeenCalled();

		await dropdown.onChangeHandler('edit');
		expect(plugin.settings.defaultMode).toBe('edit');
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
	});
});

describe('EmendSettingTab chat history limit', () => {
	beforeEach(() => {
		settingInstances.length = 0;
	});

	it('describes the shared history window and its disabled state', () => {
		const { tab } = createModelSettingsTab();
		displaySettings(tab);

		expect(latestSetting('Chat history messages').description).toBe(
			'Recent ready messages sent with each request. Set 0 to disable chat history. Applies to Ask, Discuss, Brainstorm, and both full-note and Selection Edit.',
		);
	});

	it('normalizes and saves the numeric history limit without changing provider configs', async () => {
		const { plugin, tab } = createModelSettingsTab();
		displaySettings(tab);
		const text = latestSetting('Chat history messages').texts[0];
		if (!text) throw new Error('Missing history limit input');

		expect(text.inputEl.type).toBe('number');
		expect(text.inputEl.min).toBe('0');
		expect(text.inputEl.max).toBe('50');
		expect(text.inputEl.step).toBe('1');
		expect(text.value).toBe('8');
		await text.onChangeHandler('0');

		expect(plugin.settings.historyMessageLimit).toBe(0);
		expect(plugin.settings.providers).toEqual(DEFAULT_SETTINGS.providers);
		expect(plugin.saveSettings).toHaveBeenCalledOnce();

		plugin.saveSettings.mockClear();
		await text.onChangeHandler('51');

		expect(plugin.settings.historyMessageLimit).toBe(50);
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
	});
});

describe('EmendSettingTab web output cap', () => {
	beforeEach(() => {
		settingInstances.length = 0;
	});

	it('describes executed-call limits, graceful skipped calls, and independent output caps', () => {
		const { tab } = createModelSettingsTab();
		displaySettings(tab);

		const description = latestSetting('Web tool call limit').description;
		expect(description).toContain('Maximum executed Search/Fetch calls');
		expect(description).toContain('remaining calls in model order');
		expect(description).toContain('skips only the excess');
		expect(description).toContain('independent output cap');
		expect(description).toContain('cap × calls');
		expect(description).not.toContain('Maximum model-requested');
		expect(description).not.toContain('No calls in the final batch');
	});

	it('normalizes and saves the numeric per-call cap without changing provider configs', async () => {
		const { plugin, tab } = createModelSettingsTab();
		displaySettings(tab);
		const text = latestSetting('Web output cap per call (characters)').texts[0];
		if (!text) throw new Error('Missing web output cap input');

		expect(text.inputEl.type).toBe('number');
		expect(text.inputEl.min).toBe('1000');
		expect(text.inputEl.step).toBe('1');
		expect(text.value).toBe('20000');
		await text.onChangeHandler('19999.9');

		expect(plugin.settings.maxWebContentCharactersPerCall).toBe(19999);
		expect(plugin.settings.maxWebToolCalls).toBe(8);
		expect(plugin.settings.providers).toEqual(DEFAULT_SETTINGS.providers);
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
	});
});

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

describe('EmendSettingTab context capacity', () => {
	beforeEach(() => {
		settingInstances.length = 0;
	});

	function capacityText(name: string) {
		const text = latestSetting(name).texts[0];
		if (!text) {
			throw new Error(`Missing capacity input: ${name}`);
		}
		return text;
	}

	function fireInput(text: MockSetting['texts'][number], value: string) {
		text.inputEl.value = value;
		text.onChangeHandler(value);
	}

	function fireChange(text: MockSetting['texts'][number]) {
		text.inputEl.dispatchEvent({ type: 'change' });
	}

	it('renders bounded token inputs, hidden status, and both-values copy', () => {
		const { tab } = createModelSettingsTab();
		displaySettings(tab);

		const windowText = capacityText('Context window (tokens)');
		const reserveText = capacityText('Output reserve (tokens)');

		expect(windowText.inputEl.type).toBe('number');
		expect(windowText.inputEl.min).toBe('1');
		expect(windowText.inputEl.step).toBe('1');
		expect(windowText.placeholder).toBe('e.g. 128000');
		expect(windowText.value).toBe('');
		expect(reserveText.inputEl.type).toBe('number');
		expect(reserveText.inputEl.min).toBe('1');
		expect(reserveText.inputEl.step).toBe('1');
		expect(reserveText.placeholder).toBe('e.g. 8000');
		expect(reserveText.value).toBe('');
		expect(latestSetting('Context window (tokens)').description).toContain(
			'Both token values are required',
		);
		expect(latestSetting('Output reserve (tokens)').description).toContain(
			'Both token values are required',
		);
		const status = latestSetting('Context capacity');
		expect(status.description).toBe('');
		expect(status.settingEl.style.display).toBe('none');
	});

	it('shows configured numbers and the invalid warning at display time', () => {
		const { plugin, tab } = createModelSettingsTab();
		plugin.settings.providers.deepseek.contextWindowTokens = 8000;
		plugin.settings.providers.deepseek.outputReserveTokens = 8000;
		plugin.settings.providers.deepseek.contextCapacityInvalid = true;

		displaySettings(tab);

		expect(capacityText('Context window (tokens)').value).toBe('8000');
		expect(capacityText('Output reserve (tokens)').value).toBe('8000');
		const status = latestSetting('Context capacity');
		expect(status.description).toBe(INVALID_CONTEXT_CAPACITY_MESSAGE);
		expect(status.settingEl.style.display).toBe('');
	});

	it('retains typed text and commits only on the change event', async () => {
		const { plugin, tab } = createModelSettingsTab();
		displaySettings(tab);
		const renderedCount = settingInstances.length;
		const windowText = capacityText('Context window (tokens)');
		const status = latestSetting('Context capacity');

		for (const value of ['1', '12', '128', '1280', '12800', '128000']) {
			fireInput(windowText, value);
		}

		expect(windowText.inputEl.value).toBe('128000');
		expect(settingInstances).toHaveLength(renderedCount);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		expect(status.description).toBe(INVALID_CONTEXT_CAPACITY_MESSAGE);
		expect(status.settingEl.style.display).toBe('');

		fireChange(windowText);
		await Promise.resolve();

		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		expect(plugin.settings.providers.deepseek).toMatchObject({
			contextWindowTokens: 128000,
			outputReserveTokens: null,
			contextCapacityInvalid: true,
		});
		expect(settingInstances).toHaveLength(renderedCount);
		expect(windowText.inputEl.value).toBe('128000');
	});

	it('commits a valid pair on change and updates the warning in place', async () => {
		const { plugin, tab } = createModelSettingsTab();
		plugin.settings.providers.deepseek.contextWindowTokens = 8000;
		plugin.settings.providers.deepseek.outputReserveTokens = 8000;
		plugin.settings.providers.deepseek.contextCapacityInvalid = true;
		displaySettings(tab);
		const renderedCount = settingInstances.length;
		const windowText = capacityText('Context window (tokens)');
		const status = latestSetting('Context capacity');

		fireInput(windowText, '128000');
		expect(status.description).toBe('');
		expect(plugin.saveSettings).not.toHaveBeenCalled();

		fireChange(windowText);
		await Promise.resolve();

		expect(plugin.settings.providers.deepseek).toMatchObject({
			contextWindowTokens: 128000,
			outputReserveTokens: 8000,
			contextCapacityInvalid: false,
		});
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		expect(settingInstances).toHaveLength(renderedCount);
		expect(status.description).toBe('');
		expect(status.settingEl.style.display).toBe('');
	});

	it('marks an equal reserve invalid on change in place', async () => {
		const { plugin, tab } = createModelSettingsTab();
		plugin.settings.providers.deepseek.contextWindowTokens = 128000;
		plugin.settings.providers.deepseek.outputReserveTokens = 8000;
		displaySettings(tab);
		const renderedCount = settingInstances.length;
		const reserveText = capacityText('Output reserve (tokens)');
		const status = latestSetting('Context capacity');

		fireInput(reserveText, '128000');
		fireChange(reserveText);
		await Promise.resolve();

		expect(plugin.settings.providers.deepseek).toMatchObject({
			contextWindowTokens: 128000,
			outputReserveTokens: 128000,
			contextCapacityInvalid: true,
		});
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		expect(settingInstances).toHaveLength(renderedCount);
		expect(status.description).toBe(INVALID_CONTEXT_CAPACITY_MESSAGE);
		expect(status.settingEl.style.display).toBe('');
	});

	it('clears an unparsable input on commit without discarding the other value', async () => {
		const { plugin, tab } = createModelSettingsTab();
		plugin.settings.providers.deepseek.outputReserveTokens = 8000;
		displaySettings(tab);
		const windowText = capacityText('Context window (tokens)');
		const status = latestSetting('Context capacity');

		fireInput(windowText, 'abc');
		fireChange(windowText);
		await Promise.resolve();

		expect(plugin.settings.providers.deepseek).toMatchObject({
			contextWindowTokens: null,
			outputReserveTokens: 8000,
			contextCapacityInvalid: true,
		});
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		expect(windowText.inputEl.value).toBe('');
		expect(status.description).toBe(INVALID_CONTEXT_CAPACITY_MESSAGE);
	});

	it('treats clearing both inputs as an explicit return to unconfigured', async () => {
		const { plugin, tab } = createModelSettingsTab();
		plugin.settings.providers.deepseek.contextWindowTokens = 8000;
		plugin.settings.providers.deepseek.outputReserveTokens = 8000;
		plugin.settings.providers.deepseek.contextCapacityInvalid = true;
		displaySettings(tab);
		const status = latestSetting('Context capacity');
		const windowText = capacityText('Context window (tokens)');
		const reserveText = capacityText('Output reserve (tokens)');

		fireInput(windowText, '');
		fireChange(windowText);
		await Promise.resolve();
		expect(plugin.settings.providers.deepseek).toMatchObject({
			contextWindowTokens: null,
			outputReserveTokens: 8000,
			contextCapacityInvalid: true,
		});

		fireInput(reserveText, '');
		expect(status.description).toBe(INVALID_CONTEXT_CAPACITY_MESSAGE);
		fireChange(reserveText);
		await Promise.resolve();

		expect(plugin.settings.providers.deepseek).toMatchObject({
			contextWindowTokens: null,
			outputReserveTokens: null,
			contextCapacityInvalid: false,
		});
		expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
		expect(status.description).toBe('');
		expect(status.settingEl.style.display).toBe('none');
	});

	it('clears persisted malformed capacity through the reset button', async () => {
		const { plugin, tab } = createModelSettingsTab();
		plugin.settings.providers.deepseek.contextCapacityInvalid = true;
		displaySettings(tab);
		const status = latestSetting('Context capacity');
		const reset = status.buttons[0];
		if (!reset) {
			throw new Error('Missing clear capacity button');
		}

		expect(status.description).toBe(INVALID_CONTEXT_CAPACITY_MESSAGE);
		expect(reset.text).toBe('Clear capacity settings');

		await reset.clickHandler();

		expect(plugin.settings.providers.deepseek).toMatchObject({
			contextWindowTokens: null,
			outputReserveTokens: null,
			contextCapacityInvalid: false,
		});
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		expect(status.description).toBe('');
		expect(status.settingEl.style.display).toBe('none');
		expect(capacityText('Context window (tokens)').inputEl.value).toBe('');
		expect(capacityText('Output reserve (tokens)').inputEl.value).toBe('');
	});

	it('changes only the active provider capacity on commit', async () => {
		const { plugin, tab } = createModelSettingsTab();
		displaySettings(tab);
		const windowText = capacityText('Context window (tokens)');
		const reserveText = capacityText('Output reserve (tokens)');

		fireInput(windowText, '64000');
		fireChange(windowText);
		await Promise.resolve();
		fireInput(reserveText, '4000');
		fireChange(reserveText);
		await Promise.resolve();

		expect(plugin.settings.providers.deepseek).toMatchObject({
			contextWindowTokens: 64000,
			outputReserveTokens: 4000,
			contextCapacityInvalid: false,
		});
		expect(plugin.settings.providers.kimi).toMatchObject({
			contextWindowTokens: null,
			outputReserveTokens: null,
			contextCapacityInvalid: false,
		});
		expect(plugin.settings.providers.custom).toMatchObject({
			contextWindowTokens: null,
			outputReserveTokens: null,
			contextCapacityInvalid: false,
		});
		expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
	});
});

describe('EmendSettingTab documented capacity defaults', () => {
	beforeEach(() => {
		settingInstances.length = 0;
		vi.mocked(discoverProviderModels).mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each([
		{
			providerId: 'deepseek',
			modelId: 'deepseek-flash',
			window: 1048576,
			reserve: 393216,
			description: 'DeepSeek documents 1M context and 384K maximum output. These are model documentation values, not a response from your account.',
		},
		{
			providerId: 'deepseek',
			modelId: 'deepseek-v4-pro',
			window: 1048576,
			reserve: 393216,
			description: 'DeepSeek documents 1M context and 384K maximum output. These are model documentation values, not a response from your account.',
		},
		{
			providerId: 'kimi',
			modelId: 'k3.1-pro',
			window: 1048576,
			reserve: 131072,
			description: 'Kimi documents up to 1M context on eligible plans and 131,072 default output. Lower-tier plans may need a smaller context window. These are documentation values, not a response from your account.',
		},
	] as const)('shows an enabled action with exact copy for $providerId $modelId', ({
		providerId,
		modelId,
		description,
	}) => {
		const { plugin, tab } = createModelSettingsTab();
		plugin.settings.activeProvider = providerId;
		plugin.settings.providers[providerId].model = modelId;

		displaySettings(tab);

		const defaults = latestSetting('Capacity defaults');
		expect(defaults.description).toBe(description);
		expect(defaults.buttons).toHaveLength(1);
		expect(defaults.buttons[0]?.text).toBe('Use documented defaults');
		expect(defaults.buttons[0]?.buttonEl.disabled).toBe(false);
	});

	it.each([
		{ providerId: 'deepseek', modelId: 'unknown-model' },
		{ providerId: 'kimi', modelId: 'deepseek-flash' },
		{ providerId: 'custom', modelId: 'k3.1-pro' },
		{ providerId: 'custom', modelId: 'custom-model' },
	] as const)('offers no enabled action for unsupported $providerId model $modelId', ({
		providerId,
		modelId,
	}) => {
		const { plugin, tab } = createModelSettingsTab();
		plugin.settings.activeProvider = providerId;
		plugin.settings.providers[providerId].model = modelId;

		displaySettings(tab);

		const defaults = latestSetting('Capacity defaults');
		expect(defaults.description).toBe('No documented defaults for this model.');
		expect(defaults.buttons.filter((button) => !button.buttonEl.disabled)).toEqual([]);
	});

	it('applies exact values in place, clears invalid state, and saves sanitized settings once', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const { plugin, tab } = createModelSettingsTab();
		plugin.settings.providers.deepseek.apiKey = 'deepseek-secret';
		plugin.settings.providers.kimi.apiKey = 'kimi-secret';
		plugin.settings.providers.custom.apiKey = 'custom-secret';
		plugin.settings.providers.deepseek.contextWindowTokens = 8000;
		plugin.settings.providers.deepseek.outputReserveTokens = 8000;
		plugin.settings.providers.deepseek.contextCapacityInvalid = true;
		let persisted: ReturnType<typeof sanitizeSettings> | undefined;
		plugin.saveSettings.mockImplementation(async () => {
			persisted = sanitizeSettings(plugin.settings);
		});
		displaySettings(tab);
		const renderedCount = settingInstances.length;
		const windowText = latestSetting('Context window (tokens)').texts[0];
		const reserveText = latestSetting('Output reserve (tokens)').texts[0];
		const status = latestSetting('Context capacity');
		const defaults = latestSetting('Capacity defaults');
		const renderSpy = vi.spyOn(
			tab as unknown as { renderSettings(): void },
			'renderSettings',
		);
		const button = defaults.buttons[0];
		if (!button) throw new Error('Missing documented defaults button');

		await button.clickHandler();

		expect(plugin.settings.providers.deepseek).toMatchObject({
			contextWindowTokens: 1048576,
			outputReserveTokens: 393216,
			contextCapacityInvalid: false,
		});
		expect(windowText?.value).toBe('1048576');
		expect(windowText?.inputEl.value).toBe('1048576');
		expect(reserveText?.value).toBe('393216');
		expect(reserveText?.inputEl.value).toBe('393216');
		expect(status.description).toBe('');
		expect(status.settingEl.style.display).toBe('');
		expect(settingInstances).toHaveLength(renderedCount);
		expect(renderSpy).not.toHaveBeenCalled();
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		expect(persisted?.providers.deepseek.apiKey).toBe('');
		expect(persisted?.providers.kimi.apiKey).toBe('');
		expect(persisted?.providers.custom.apiKey).toBe('');
		expect(persisted?.providers.deepseek).toMatchObject({
			contextWindowTokens: 1048576,
			outputReserveTokens: 393216,
			contextCapacityInvalid: false,
		});
		expect(discoverProviderModels).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('keeps manual values through normalization and explicit model selection', async () => {
		const normalized = normalizeSettings({
			providers: {
				deepseek: {
					model: 'deepseek-flash',
					contextWindowTokens: 64000,
					outputReserveTokens: 4000,
				},
			},
		});
		expect(normalized.providers.deepseek).toMatchObject({
			contextWindowTokens: 64000,
			outputReserveTokens: 4000,
			contextCapacityInvalid: false,
		});

		const { plugin, tab } = createModelSettingsTab();
		plugin.settings.providers.deepseek.contextWindowTokens = 64000;
		plugin.settings.providers.deepseek.outputReserveTokens = 4000;
		plugin.settings.providers.deepseek.discoveredModels = [
			{ id: 'deepseek-v4-pro', displayName: 'deepseek-v4-pro' },
		];
		displaySettings(tab);

		await latestDropdown('DeepSeek model').onChangeHandler('deepseek-v4-pro');

		expect(plugin.settings.providers.deepseek).toMatchObject({
			model: 'deepseek-v4-pro',
			contextWindowTokens: 64000,
			outputReserveTokens: 4000,
			contextCapacityInvalid: false,
		});
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		expect(discoverProviderModels).not.toHaveBeenCalled();
	});
});

describe('EmendSettingTab documented defaults model edits', () => {
	beforeEach(() => {
		settingInstances.length = 0;
	});

	it('disables the action for an unknown model and restores it for an exact supported ID without applying values', async () => {
		const { plugin, tab } = createModelSettingsTab();
		plugin.settings.providers.deepseek.contextWindowTokens = 64000;
		plugin.settings.providers.deepseek.outputReserveTokens = 4000;
		displaySettings(tab);
		const renderedCount = settingInstances.length;
		const modelText = latestModelText();

		await modelText.onChangeHandler('unknown-model');

		let defaults = latestSetting('Capacity defaults');
		expect(defaults.description).toBe('No documented defaults for this model.');
		expect(defaults.buttons.every((button) => button.buttonEl.disabled)).toBe(true);
		expect(plugin.settings.providers.deepseek).toMatchObject({
			model: 'unknown-model',
			contextWindowTokens: 64000,
			outputReserveTokens: 4000,
			contextCapacityInvalid: false,
		});
		expect(settingInstances).toHaveLength(renderedCount);

		await modelText.onChangeHandler(' deepseek-v4-pro ');

		defaults = latestSetting('Capacity defaults');
		expect(defaults.description).toBe('DeepSeek documents 1M context and 384K maximum output. These are model documentation values, not a response from your account.');
		expect(defaults.buttons.some((button) => !button.buttonEl.disabled)).toBe(true);
		expect(plugin.settings.providers.deepseek).toMatchObject({
			model: 'deepseek-v4-pro',
			contextWindowTokens: 64000,
			outputReserveTokens: 4000,
			contextCapacityInvalid: false,
		});
		expect(settingInstances).toHaveLength(renderedCount);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
	});
});
