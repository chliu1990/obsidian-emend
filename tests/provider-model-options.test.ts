import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProviderModelOptions } from '../src/provider-model-options';
import type { ProviderConfig } from '../src/types';

function createConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
	return {
		name: 'Provider',
		baseUrl: 'https://example.com/v1',
		apiKey: '',
		model: '',
		reasoningEffort: 'high',
		requestUsage: false,
		discoveredModels: [],
		contextWindowTokens: null,
		outputReserveTokens: null,
		contextCapacityInvalid: false,
		...overrides,
	};
}

describe('getProviderModelOptions', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each([
		{
			providerId: 'deepseek',
			expected: [
				{ id: 'deepseek-flash', label: 'deepseek-flash' },
				{ id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
			],
		},
		{
			providerId: 'kimi',
			expected: [{ id: 'k3.1-pro', label: 'k3.1-pro' }],
		},
	] as const)('returns the exact built-ins for $providerId', ({ providerId, expected }) => {
		expect(getProviderModelOptions(providerId, createConfig())).toEqual(expected);
	});

	it('returns an empty list for Custom without discoveries or a configured model', () => {
		expect(getProviderModelOptions('custom', createConfig({ model: '' }))).toEqual([]);
	});

	it('keeps first-occurrence labels and stable order for mixed DeepSeek models', () => {
		const config = createConfig({
			model: '  local-custom\t',
			discoveredModels: [
				{ id: ' deepseek-flash ', displayName: ' Duplicate built-in ' },
				{ id: ' model-a ', displayName: ' Model A ' },
				{ id: ' local-custom ', displayName: ' Discovered current ' },
				{ id: '   ', displayName: 'Blank ID' },
			],
		});

		expect(getProviderModelOptions('deepseek', config)).toEqual([
			{ id: 'deepseek-flash', label: 'deepseek-flash' },
			{ id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
			{ id: 'model-a', label: 'Model A' },
			{ id: 'local-custom', label: 'Discovered current' },
		]);
	});

	it('falls back to the trimmed ID for a blank discovered label', () => {
		const config = createConfig({
			discoveredModels: [{ id: ' plain-id ', displayName: ' \t ' }],
		});

		expect(getProviderModelOptions('deepseek', config)).toContainEqual({
			id: 'plain-id',
			label: 'plain-id',
		});
	});

	it('orders Custom discoveries before its trimmed configured model without replacing labels', () => {
		const config = createConfig({
			model: ' configured ',
			discoveredModels: [
				{ id: ' discovered ', displayName: ' Discovered ' },
				{ id: 'configured', displayName: 'Discovered configured' },
				{ id: 'discovered', displayName: 'Duplicate discovery' },
			],
		});

		expect(getProviderModelOptions('custom', config)).toEqual([
			{ id: 'discovered', label: 'Discovered' },
			{ id: 'configured', label: 'Discovered configured' },
		]);
	});

	it('does not mutate the configuration, discovery array, or discovery entries', () => {
		const discoveredModels = [
			{ id: ' model-a ', displayName: ' Model A ' },
			{ id: '   ', displayName: 'Blank ID' },
		];
		const config = createConfig({ model: ' current ', discoveredModels });
		const originalConfig = {
			...config,
			discoveredModels: config.discoveredModels.map((model) => ({ ...model })),
		};

		getProviderModelOptions('deepseek', config);

		expect(config).toEqual(originalConfig);
		expect(config.discoveredModels).toBe(discoveredModels);
	});

	it('does not call fetch while building options', () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const config = createConfig({
			model: 'current',
			discoveredModels: [{ id: 'model-a', displayName: 'Model A' }],
		});

		getProviderModelOptions('deepseek', config);
		getProviderModelOptions('kimi', config);
		getProviderModelOptions('custom', config);

		expect(fetchMock).not.toHaveBeenCalled();
	});
});
