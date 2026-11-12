import { describe, expect, it } from 'vitest';
import { getDocumentedCapacityDefaults } from '../src/provider-capacity-defaults';

const DEEPSEEK_DESCRIPTION = 'DeepSeek documents 1M context and 384K maximum output. These are model documentation values, not a response from your account.';
const KIMI_DESCRIPTION = 'Kimi documents up to 1M context on eligible plans and 131,072 default output. Lower-tier plans may need a smaller context window. These are documentation values, not a response from your account.';

describe('getDocumentedCapacityDefaults', () => {
	it.each([
		['deepseek-flash'],
		['deepseek-v4-pro'],
	])('returns the documented DeepSeek pair and description for %s', (modelId) => {
		expect(getDocumentedCapacityDefaults('deepseek', modelId)).toEqual({
			contextWindowTokens: 1048576,
			outputReserveTokens: 393216,
			description: DEEPSEEK_DESCRIPTION,
		});
	});

	it('returns the documented Kimi pair, description, and plan caveat', () => {
		expect(getDocumentedCapacityDefaults('kimi', 'k3.1-pro')).toEqual({
			contextWindowTokens: 1048576,
			outputReserveTokens: 131072,
			description: KIMI_DESCRIPTION,
		});
	});

	it('trims the exact model ID before lookup', () => {
		expect(getDocumentedCapacityDefaults('deepseek', '  deepseek-flash\t')).toEqual({
			contextWindowTokens: 1048576,
			outputReserveTokens: 393216,
			description: DEEPSEEK_DESCRIPTION,
		});
	});

	it.each([
		['deepseek', 'unknown-model'],
		['deepseek', 'k3.1-pro'],
		['deepseek', 'deepseek-chat'],
		['kimi', 'deepseek-flash'],
		['kimi', 'unknown-model'],
		['custom', 'deepseek-flash'],
		['custom', 'k3.1-pro'],
		['custom', 'custom-model'],
	] as const)('returns no defaults for unsupported %s model %s', (providerId, modelId) => {
		expect(getDocumentedCapacityDefaults(providerId, modelId)).toBeUndefined();
	});
});
