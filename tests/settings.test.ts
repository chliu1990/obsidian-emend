import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';

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
		expect(Object.keys(DEFAULT_SETTINGS.providers)).toEqual([
			'deepseek',
			'kimi',
			'custom',
		]);
		expect(DEFAULT_SETTINGS.providers.deepseek).toEqual({
			name: 'DeepSeek',
			baseUrl: 'https://api.deepseek.com',
			apiKey: '',
			model: 'deepseek-v4-flash',
			reasoningEffort: 'high',
		});
		expect(DEFAULT_SETTINGS.providers.kimi).toEqual({
			name: 'Kimi',
			baseUrl: 'https://api.moonshot.cn/v1',
			apiKey: '',
			model: 'kimi-k2-turbo-preview',
			reasoningEffort: 'high',
		});
		expect(DEFAULT_SETTINGS.providers.custom).toEqual({
			name: 'Custom',
			baseUrl: '',
			apiKey: '',
			model: '',
			reasoningEffort: 'high',
		});
	});

	it('defaults to DeepSeek, ask mode, and disabled note-path sharing', () => {
		expect(DEFAULT_SETTINGS.activeProvider).toBe('deepseek');
		expect(DEFAULT_SETTINGS.defaultMode).toBe('ask');
		expect(DEFAULT_SETTINGS.includeNotePathInContext).toBe(false);
		expect(DEFAULT_SETTINGS.maxContextCharacters).toBe(12000);
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
				},
				kimi: {
					name: 'Kimi',
					baseUrl: 'https://kimi.example.test/v1',
					apiKey: 'kimi-user-key',
					model: 'kimi-user-model',
					reasoningEffort: 'medium',
				},
				custom: {
					name: 'Custom',
					baseUrl: 'https://custom.example.test/v1',
					apiKey: 'custom-user-key',
					model: 'custom-user-model',
					reasoningEffort: 'high',
				},
			},
			defaultMode: 'discuss',
			includeNotePathInContext: true,
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
