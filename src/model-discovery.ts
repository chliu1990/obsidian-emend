import type { DiscoveredModel } from './types';

const MAX_DISCOVERY_ERROR_CHARACTERS = 2000;

export interface ProviderDiscoveryConnection {
	name: string;
	baseUrl: string;
	apiKey: string;
}

export async function discoverProviderModels(
	provider: ProviderDiscoveryConnection,
	signal?: AbortSignal,
): Promise<DiscoveredModel[]> {
	const apiKey = provider.apiKey.trim();
	const baseUrl = provider.baseUrl.trim().replace(/\/+$/, '');
	if (!apiKey) {
		throw new Error(`${provider.name} API key is missing.`);
	}
	if (!baseUrl) {
		throw new Error(`${provider.name} base URL is missing.`);
	}

	let parsedBaseUrl: URL;
	try {
		parsedBaseUrl = new URL(baseUrl);
	} catch {
		throw new Error(`${provider.name} base URL must be a valid HTTP(S) URL.`);
	}
	if (parsedBaseUrl.protocol !== 'http:' && parsedBaseUrl.protocol !== 'https:') {
		throw new Error(`${provider.name} base URL must use HTTP or HTTPS.`);
	}

	try {
		// eslint-disable-next-line no-restricted-globals -- Obsidian provides browser fetch.
		const response = await fetch(`${baseUrl}/models`, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: 'application/json',
			},
			signal,
		});
		if (!response.ok) {
			throw new Error(`Model discovery failed with HTTP ${response.status}.`);
		}

		let payload: unknown;
		try {
			payload = await response.json();
		} catch (error) {
			if (isRecord(error) && error.name === 'AbortError') {
				throw error;
			}
			throw new Error('The provider returned malformed JSON.');
		}
		if (!isRecord(payload) || !Array.isArray(payload.data)) {
			throw new Error('The provider returned an invalid model list.');
		}

		const models: DiscoveredModel[] = [];
		const seen = new Set<string>();
		for (const entry of payload.data) {
			if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim()) continue;
			const id = entry.id.trim();
			if (seen.has(id)) continue;
			seen.add(id);
			const displayName = [entry.display_name, entry.name]
				.find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
				?.trim() ?? id;
			models.push({ id, displayName });
		}
		if (models.length === 0) throw new Error('The provider returned no usable models.');
		return models;
	} catch (error) {
		if (isRecord(error) && error.name === 'AbortError') {
			throw error;
		}
		throw new Error(sanitizeDiscoveryError(error, apiKey));
	}
}

function sanitizeDiscoveryError(error: unknown, apiKey: string) {
	let message = error instanceof Error ? error.message : String(error);
	message = message.split(apiKey).join('[redacted]');
	message = message.replace(
		/authorization\s*:\s*bearer\s+\S+/gi,
		'[credential redacted]',
	);
	message = message.replace(/bearer\s+\S+/gi, '[credential redacted]');
	if (message.length > MAX_DISCOVERY_ERROR_CHARACTERS) {
		message = `${message.slice(0, MAX_DISCOVERY_ERROR_CHARACTERS - 12)}…[truncated]`;
	}
	return message || 'The provider model discovery request failed.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
