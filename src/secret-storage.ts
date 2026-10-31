import type { App } from 'obsidian';
import type { ProviderId } from './types';

export const API_KEY_SECRET_IDS: Record<ProviderId, string> = {
	deepseek: 'emend-api-key-deepseek',
	kimi: 'emend-api-key-kimi',
	custom: 'emend-api-key-custom',
};

type SecretStorage = Pick<App['secretStorage'], 'getSecret' | 'setSecret'>;

export class ApiKeyStorage {
	private readonly fallback: Partial<Record<ProviderId, string>> = {};

	constructor(private readonly storage: SecretStorage | undefined) {}

	getApiKey(providerId: ProviderId) {
		return (
			this.storage?.getSecret(API_KEY_SECRET_IDS[providerId]) ??
			this.fallback[providerId] ??
			''
		);
	}

	setApiKey(providerId: ProviderId, value: string) {
		this.storage?.setSecret(API_KEY_SECRET_IDS[providerId], value);
		this.fallback[providerId] = value;
	}
}
