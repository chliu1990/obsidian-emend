import { readFileSync } from 'node:fs';
import { Setting } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import {
	AI_PROVIDERS,
	DEFAULT_SETTINGS,
	EmendSettingTab,
	normalizeSettings,
} from '../src/settings';
import type EmendPlugin from '../src/main';

const manifest = JSON.parse(
	readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const packageMetadata = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

describe('publication metadata', () => {
	it('uses the current author without the original author URL', () => {
		expect(manifest.author).toBe('Chang Liu and Kimi K3.1 Pro');
		expect(packageMetadata.author).toBe(manifest.author);
		expect(manifest).not.toHaveProperty('authorUrl');
		expect(packageMetadata).not.toHaveProperty('authorUrl');
	});

	it('retains version 2.0.0', () => {
		expect(manifest.version).toBe('2.0.0');
		expect(packageMetadata.version).toBe('2.0.0');
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
		});
		expect(DEFAULT_SETTINGS.providers.kimi).toEqual({
			name: 'Kimi',
			baseUrl: 'https://api.kimi.com/coding/v1',
			apiKey: '',
			model: 'k3.1-pro',
			reasoningEffort: 'high',
			requestUsage: true,
		});
		expect(DEFAULT_SETTINGS.providers.custom).toEqual({
			name: 'Custom',
			baseUrl: '',
			apiKey: '',
			model: '',
			reasoningEffort: 'high',
			requestUsage: false,
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
				},
				kimi: {
					name: 'Kimi',
					baseUrl: 'https://kimi.example.test/v1',
					apiKey: 'kimi-user-key',
					model: 'kimi-user-model',
					reasoningEffort: 'medium',
					requestUsage: true,
				},
				custom: {
					name: 'Custom',
					baseUrl: 'https://custom.example.test/v1',
					apiKey: 'custom-user-key',
					model: 'custom-user-model',
					reasoningEffort: 'high',
					requestUsage: true,
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
