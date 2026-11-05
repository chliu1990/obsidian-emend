import {
	formatHttpProviderError,
	sanitizeProviderError,
} from './provider-stream';
import type { ProviderConfig } from './types';
import { normalizeWebUrl, type WebToolCall } from './web-search';

export interface DeepSeekSearchResult {
	title: string;
	url: string;
	snippet: string;
	summary: string;
	siteName?: string;
	date?: string;
}

export interface DeepSeekFetchPage {
	title: string;
	content: string;
}

export async function searchDeepSeek(
	call: Extract<WebToolCall, { name: 'web_search' }>,
	provider: ProviderConfig,
	signal: AbortSignal,
): Promise<DeepSeekSearchResult[]> {
	const payload = await requestDeepSeekTool('search', provider, {
		query: call.query,
		count: 5,
		need_content: false,
	}, signal);
	return parseDeepSeekSearchResponse(payload);
}

export async function fetchDeepSeekPage(
	call: Extract<WebToolCall, { name: 'web_fetch' }>,
	provider: ProviderConfig,
	signal: AbortSignal,
): Promise<DeepSeekFetchPage> {
	const payload = await requestDeepSeekTool('fetch', provider, { url: call.url }, signal);
	return parseDeepSeekFetchResponse(payload);
}

export function parseDeepSeekSearchResponse(value: unknown): DeepSeekSearchResult[] {
	if (!isRecord(value) || !Array.isArray(value.results)) {
		throw new Error('DeepSeek returned a malformed search response.');
	}
	const results: DeepSeekSearchResult[] = [];
	for (const entry of value.results) {
		if (
			!isRecord(entry) ||
			typeof entry.title !== 'string' ||
			typeof entry.url !== 'string' ||
			typeof entry.snippet !== 'string' ||
			typeof entry.summary !== 'string' ||
			(typeof entry.site_name !== 'string' && entry.site_name !== null) ||
			(typeof entry.date !== 'string' && entry.date !== null)
		) {
			throw new Error('DeepSeek returned a malformed search response.');
		}
		const url = normalizeWebUrl(entry.url);
		if (!url) {
			continue;
		}
		results.push({
			title: entry.title,
			url,
			snippet: entry.snippet,
			summary: entry.summary,
			siteName: entry.site_name ?? undefined,
			date: entry.date ?? undefined,
		});
	}
	return results;
}

export function parseDeepSeekFetchResponse(value: unknown): DeepSeekFetchPage {
	if (!isRecord(value) || typeof value.title !== 'string' || typeof value.content !== 'string') {
		throw new Error('DeepSeek returned a malformed fetch response.');
	}
	return { title: value.title, content: value.content };
}

async function requestDeepSeekTool(
	tool: 'search' | 'fetch',
	provider: ProviderConfig,
	body: Record<string, unknown>,
	signal: AbortSignal,
): Promise<unknown> {
	const apiKey = provider.apiKey.trim();
	if (!apiKey) {
		throw new Error(`${provider.name} API key is missing.`);
	}
	let endpoint: string;
	try {
		const baseUrl = new URL(provider.baseUrl.trim().replace(/\/+$/, ''));
		if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
			throw new Error();
		}
		const base = provider.baseUrl.trim().replace(/\/+$/, '');
		endpoint = `${base}${base.endsWith('/v1') ? '' : '/v1'}/tools/${tool}`;
	} catch {
		throw new Error(`${provider.name} base URL must be a valid HTTP(S) URL.`);
	}

	try {
		// eslint-disable-next-line no-restricted-globals -- DeepSeek tool APIs use ordinary JSON fetch responses.
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
			signal,
		});
		if (!response.ok) {
			throw new Error(formatHttpProviderError(response.status, await response.text()));
		}
		try {
			return await response.json();
		} catch {
			throw new Error(`DeepSeek returned malformed ${tool} JSON.`);
		}
	} catch (error) {
		if (signal.aborted || (isRecord(error) && error.name === 'AbortError')) {
			throw error;
		}
		throw new Error(sanitizeProviderError(error, apiKey));
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
