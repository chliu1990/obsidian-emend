import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	fetchDeepSeekPage,
	parseDeepSeekFetchResponse,
	parseDeepSeekSearchResponse,
	searchDeepSeek,
} from '../src/deepseek-web';
import type { ProviderConfig } from '../src/types';

const provider: ProviderConfig = {
	name: 'DeepSeek',
	baseUrl: 'https://api.deepseek.com',
	apiKey: 'dummy-key',
	model: 'deepseek-flash',
	reasoningEffort: 'high',
	requestUsage: true,
	discoveredModels: [],
};

const searchResult = {
	rerank_score: 2,
	title: 'Emend documentation',
	url: 'https://example.test/emend',
	snippet: 'Short evidence',
	summary: 'Longer model evidence',
	content: '',
	site_name: 'Example',
	site_icon: null,
	date: null,
	authority: 3,
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('DeepSeek retrieval clients', () => {
	it('posts the exact bounded search request and parses structured results', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [searchResult] })));
		vi.stubGlobal('fetch', fetchMock);

		const results = await searchDeepSeek(
			{ id: 'call-1', name: 'web_search', query: 'Emend plugin' },
			provider,
			new AbortController().signal,
		);

		expect(results).toEqual([{
			title: 'Emend documentation',
			url: 'https://example.test/emend',
			snippet: 'Short evidence',
			summary: 'Longer model evidence',
			siteName: 'Example',
			date: undefined,
		}]);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://api.deepseek.com/v1/tools/search');
		expect(JSON.parse(init.body as string)).toEqual({
			query: 'Emend plugin',
			count: 5,
			need_content: false,
		});
	});

	it('does not duplicate /v1 for a configured API base', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ title: 'Page', content: '# Body' })));
		vi.stubGlobal('fetch', fetchMock);

		const page = await fetchDeepSeekPage(
			{ id: 'call-2', name: 'web_fetch', url: 'https://example.test/docs' },
			{ ...provider, baseUrl: 'https://proxy.example.test/v1/' },
			new AbortController().signal,
		);

		expect(page).toEqual({ title: 'Page', content: '# Body' });
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://proxy.example.test/v1/tools/fetch');
		expect(JSON.parse(init.body as string)).toEqual({ url: 'https://example.test/docs' });
	});

	it('accepts an empty search result array', () => {
		expect(parseDeepSeekSearchResponse({ results: [] })).toEqual([]);
	});

	it('drops malformed source URLs rather than presenting them as evidence', () => {
		expect(parseDeepSeekSearchResponse({
			results: [
				searchResult,
				{ ...searchResult, title: 'Unsafe', url: 'javascript:alert(1)' },
			],
		})).toHaveLength(1);
	});

	it('rejects malformed retrieval payloads without echoing them', () => {
		expect(() => parseDeepSeekSearchResponse({ results: [{ secret: 'do-not-echo' }] })).toThrow(
			'malformed search response',
		);
		expect(() => parseDeepSeekFetchResponse({ content: 42 })).toThrow(
			'malformed fetch response',
		);
	});

	it('redacts credentials from HTTP errors and does not retry', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
			error: { message: 'dummy-key was rejected', type: 'authentication_error' },
		}), { status: 401 }));
		vi.stubGlobal('fetch', fetchMock);

		await expect(searchDeepSeek(
			{ id: 'call-1', name: 'web_search', query: 'Emend' },
			provider,
			new AbortController().signal,
		)).rejects.toThrow('[redacted]');
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it('propagates aborts without wrapping them', async () => {
		const controller = new AbortController();
		const reason = new DOMException('Stopped', 'AbortError');
		controller.abort(reason);
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(reason));

		await expect(fetchDeepSeekPage(
			{ id: 'call-2', name: 'web_fetch', url: 'https://example.test/docs' },
			provider,
			controller.signal,
		)).rejects.toBe(reason);
	});
});
