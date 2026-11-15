import type { ProviderConfig, ProviderId } from './types';

export interface ProviderModelOption {
	id: string;
	label: string;
}

const BUILT_IN_MODEL_OPTIONS: Record<ProviderId, readonly ProviderModelOption[]> = {
	deepseek: [
		{ id: 'deepseek-flash', label: 'deepseek-flash' },
		{ id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
	],
	kimi: [{ id: 'k3.1-pro', label: 'k3.1-pro' }],
	custom: [],
};

export function getProviderModelOptions(
	providerId: ProviderId,
	config: ProviderConfig,
): readonly ProviderModelOption[] {
	const options = new Map<string, ProviderModelOption>();
	const addOption = (id: string, label: string) => {
		const trimmedId = id.trim();
		if (!trimmedId || options.has(trimmedId)) {
			return;
		}
		const trimmedLabel = label.trim();
		options.set(trimmedId, {
			id: trimmedId,
			label: trimmedLabel || trimmedId,
		});
	};

	for (const option of BUILT_IN_MODEL_OPTIONS[providerId]) {
		addOption(option.id, option.label);
	}
	for (const model of config.discoveredModels) {
		addOption(model.id, model.displayName);
	}
	addOption(config.model, config.model);
	return [...options.values()];
}
