import type { ProviderId } from './types';

export interface DocumentedCapacityDefaults {
	contextWindowTokens: number;
	outputReserveTokens: number;
	description: string;
}

const DEEPSEEK_DEFAULTS: DocumentedCapacityDefaults = {
	contextWindowTokens: 1048576,
	outputReserveTokens: 393216,
	description: 'DeepSeek documents 1M context and 384K maximum output. These are model documentation values, not a response from your account.',
};

const DOCUMENTED_CAPACITY_DEFAULTS: Record<
	ProviderId,
	Readonly<Record<string, DocumentedCapacityDefaults>>
> = {
	deepseek: {
		'deepseek-flash': DEEPSEEK_DEFAULTS,
		'deepseek-v4-pro': DEEPSEEK_DEFAULTS,
	},
	kimi: {
		'k3.1-pro': {
			contextWindowTokens: 1048576,
			outputReserveTokens: 131072,
			description: 'Kimi documents up to 1M context on eligible plans and 131,072 default output. Lower-tier plans may need a smaller context window. These are documentation values, not a response from your account.',
		},
	},
	custom: {},
};

export function getDocumentedCapacityDefaults(
	providerId: ProviderId,
	modelId: string,
): DocumentedCapacityDefaults | undefined {
	return DOCUMENTED_CAPACITY_DEFAULTS[providerId][modelId.trim()];
}
