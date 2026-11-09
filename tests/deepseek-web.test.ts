import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	DeepSeekWebSearchCoordinator,
	fetchDeepSeekPage,
	parseDeepSeekFetchResponse,
	parseDeepSeekSearchResponse,
	searchDeepSeek,
} from '../src/deepseek-web';
import type {
	AiProviderRequest,
	StreamEvent,
	StreamResult,
} from '../src/provider-stream';
import type { ProviderConfig } from '../src/types';
import type { WebSearchRunOptions, WebToolCall } from '../src/web-search';

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

const parsedSearchResult = {
	title: 'Emend documentation',
	url: 'https://example.test/emend',
	snippet: 'Short evidence',
	summary: 'Longer model evidence',
	content: '',
	siteName: 'Example',
	date: undefined,
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

		expect(results).toEqual([{ ...parsedSearchResult, content: '' }]);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://api.deepseek.com/v1/tools/search');
		expect(JSON.parse(init.body as string)).toEqual({
			query: 'Emend plugin',
			count: 5,
			need_content: true,
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
			results: [searchResult, { ...searchResult, title: 'Unsafe', url: 'javascript:alert(1)' }],
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

	it('preserves the sanitized Fetch HTTP status for fatal-error classification', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
			error: { message: 'Unauthorized dummy-key' },
		}), { status: 401 })));

		await expect(fetchDeepSeekPage(
			{ id: 'call-2', name: 'web_fetch', url: 'https://example.test/private' },
			provider,
			new AbortController().signal,
		)).rejects.toMatchObject({
			status: 401,
			message: 'API request failed with HTTP 401.\nUnauthorized [redacted]',
		});
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

function aiRequest(): AiProviderRequest {
	return {
		provider,
		systemPrompt: 'Answer in chat.',
		userPrompt: 'Research Emend',
		history: [],
	};
}

function toolRound(calls: Array<{ id: string; name: string; arguments: string }>, content = ''): StreamResult {
	return { content, reasoning: '', finishReason: 'tool_calls', toolCalls: calls };
}

function finalRound(content = 'Final answer', reasoning = ''): StreamResult {
	return { content, reasoning, finishReason: 'stop' };
}

function options(overrides: Partial<WebSearchRunOptions> = {}): WebSearchRunOptions {
	return {
		mode: 'auto',
		maxToolCalls: 8,
		reviewCalls: vi.fn(async (calls: readonly WebToolCall[]) => calls),
		onActivity: vi.fn(),
		callbacks: { onEvent: vi.fn() },
		signal: new AbortController().signal,
		...overrides,
	};
}

function coordinatorWith(
	rounds: StreamResult[],
	search = vi.fn(async (_call: Extract<WebToolCall, { name: 'web_search' }>) => [parsedSearchResult]),
	fetchPage = vi.fn(async () => ({ title: 'Fetched page', content: 'Fetched content' })),
) {
	const request = vi.fn(async (
		_request: AiProviderRequest,
		callbacks: { onEvent(event: StreamEvent): void },
		_signal: AbortSignal,
	) => {
		const result = rounds[request.mock.calls.length - 1];
		if (!result) throw new Error('Unexpected model round');
		if (result.reasoning) callbacks.onEvent({ type: 'reasoning', text: result.reasoning });
		return result;
	});
	const coordinator = new DeepSeekWebSearchCoordinator({
		provider,
		request,
		search,
		fetchPage,
	});
	return { coordinator, request, search, fetchPage };
}

describe('DeepSeekWebSearchCoordinator', () => {
	it('allows a terminal answer without retrieval and emits only final content', async () => {
		const { coordinator, request, search } = coordinatorWith([
			toolRound([{ id: 'call-1', name: 'web_search', arguments: '{"query":"intermediate"}' }], 'Do not show this'),
			finalRound('Terminal answer', 'Reasoning'),
		]);
		const onEvent = vi.fn();
		const runOptions = options({ callbacks: { onEvent } });

		const result = await coordinator.submit(aiRequest(), runOptions);

		expect(result.content).toBe('Terminal answer');
		expect(result.reasoning).toBe('Reasoning');
		expect(result.sources).toHaveLength(1);
		expect(result.rounds).toHaveLength(2);
		expect(onEvent).toHaveBeenCalledWith({ type: 'content', text: 'Terminal answer' });
		expect(onEvent).not.toHaveBeenCalledWith({ type: 'content', text: 'Do not show this' });
		expect(request.mock.calls[0]?.[0].tools?.map((tool) => tool.function.name)).toEqual([
			'web_search',
			'web_fetch',
		]);
		expect(search).toHaveBeenCalledOnce();
	});

	it('lets the model choose zero tools and returns no sources', async () => {
		const { coordinator, request, search, fetchPage } = coordinatorWith([finalRound('No research needed')]);

		const result = await coordinator.submit(aiRequest(), options());

		expect(result.content).toBe('No research needed');
		expect(result.sources).toEqual([]);
		expect(request).toHaveBeenCalledOnce();
		expect(search).not.toHaveBeenCalled();
		expect(fetchPage).not.toHaveBeenCalled();
	});

	it('supports sequential multi-call batches and later fetch rounds with stable deduplicated sources', async () => {
		const search = vi.fn(async (_call: Extract<WebToolCall, { name: 'web_search' }>) => [parsedSearchResult]);
		const fetchPage = vi.fn(async () => ({ title: 'Fetched page', content: 'Fetched content' }));
		const { coordinator, request } = coordinatorWith([
			toolRound([
				{ id: 'call-1', name: 'web_search', arguments: '{"query":"first"}' },
				{ id: 'call-2', name: 'web_search', arguments: '{"query":"second"}' },
			]),
			toolRound([{ id: 'call-3', name: 'web_fetch', arguments: '{"url":"https://example.test/emend"}' }]),
			finalRound(),
		], search, fetchPage);
		const activity: Array<{ status: string; label: string }> = [];

		const result = await coordinator.submit(aiRequest(), options({
			onActivity: (event) => activity.push(event),
		}));

		expect(search.mock.calls.map((call) => call[0].query)).toEqual(['first', 'second']);
		expect(fetchPage).toHaveBeenCalledOnce();
		expect(result.sources).toEqual([{
			id: 'S1',
			title: 'Emend documentation',
			url: 'https://example.test/emend',
			snippet: 'Short evidence',
		}]);
		expect(result.sources[0]?.id).toBe('S1');
		const secondRound = request.mock.calls[1]?.[0];
		const thirdRound = request.mock.calls[2]?.[0];
		expect(secondRound?.continuation?.filter((message) => message.role === 'tool')).toHaveLength(2);
		expect(thirdRound?.continuation?.filter((message) => message.role === 'tool')).toHaveLength(3);
		expect(activity.map((event) => event.status)).toEqual([
			'pending', 'complete', 'pending', 'complete', 'pending', 'complete',
		]);
	});

	it('uses validated Review edits and skips review only in Auto', async () => {
		const edited: WebToolCall[] = [{ id: 'call-1', name: 'web_search', query: 'edited query' }];
		const reviewCalls = vi.fn(async () => edited);
		const { coordinator, search } = coordinatorWith([
			toolRound([{ id: 'call-1', name: 'web_search', arguments: '{"query":"original"}' }]),
			finalRound(),
		]);

		await coordinator.submit(aiRequest(), options({ mode: 'review', reviewCalls }));

		expect(reviewCalls).toHaveBeenCalledWith([{ id: 'call-1', name: 'web_search', query: 'original' }]);
		expect(search.mock.calls[0]?.[0].query).toBe('edited query');
	});

	it('rejects an over-cap batch before executing any call in it', async () => {
		const { coordinator, request, search } = coordinatorWith([
			toolRound([
				{ id: 'call-1', name: 'web_search', arguments: '{"query":"first"}' },
				{ id: 'call-2', name: 'web_search', arguments: '{"query":"second"}' },
			]),
		]);

		await expect(coordinator.submit(aiRequest(), options({ maxToolCalls: 1 }))).rejects.toThrow(
			'web tool call limit',
		);
		expect(search).not.toHaveBeenCalled();
		expect(request).toHaveBeenCalledOnce();
	});

	it('allows two content-heavy searches at the 20-call limit and truncates the second shared-budget round', async () => {
		const search = vi.fn(async (call: Extract<WebToolCall, { name: 'web_search' }>) => {
			const round = call.query === 'first-heavy' ? 1 : 2;
			return Array.from({ length: 5 }, (_, index) => ({
				...parsedSearchResult,
				title: `Round ${round} result ${index + 1}`,
				url: `https://example.test/round-${round}/result-${index + 1}`,
				snippet: '',
				summary: '',
				content: `${round}-${index}-${'x'.repeat(5996)}`,
			}));
		});
		const { coordinator, request } = coordinatorWith([
			toolRound([{ id: 'call-1', name: 'web_search', arguments: '{"query":"first-heavy"}' }]),
			toolRound([{ id: 'call-2', name: 'web_search', arguments: '{"query":"second-heavy"}' }]),
			finalRound('Answer from truncated evidence'),
		], search);

		const result = await coordinator.submit(aiRequest(), options({ maxToolCalls: 20 }));

		expect(result.content).toBe('Answer from truncated evidence');
		expect(search).toHaveBeenCalledTimes(2);
		expect(search.mock.calls.map((call) => call[0].query)).toEqual(['first-heavy', 'second-heavy']);
		expect(request).toHaveBeenCalledTimes(3);
		expect(result.sources).toHaveLength(10);
		const toolMessages = request.mock.calls[2]?.[0].continuation?.filter(
			(message) => message.role === 'tool',
		) ?? [];
		expect(toolMessages).toHaveLength(2);
		const payloads = toolMessages.map((message) => JSON.parse(
			message.role === 'tool' ? message.content : '{}',
		) as {
			results: Array<{ content: string; contentTruncated: boolean }>;
			truncated: boolean;
		});
		expect(payloads[0]?.truncated).toBe(false);
		expect(payloads[0]?.results.map((entry) => entry.content)).toHaveLength(5);
		expect(payloads[0]?.results.every((entry) => entry.content.length === 6000)).toBe(true);
		expect(payloads[1]?.truncated).toBe(true);
		expect(payloads[1]?.results.map((entry) => entry.content.length)).toEqual([6000, 4005, 5, 5, 5]);
		expect(payloads[1]?.results.map((entry) => entry.contentTruncated)).toEqual([
			false, true, true, true, true,
		]);
		expect(payloads[1]?.results.slice(1).every((entry) => entry.content.endsWith('[...]'))).toBe(true);
	});

	it('allows exactly 20 proposed calls', async () => {
		const calls = Array.from({ length: 20 }, (_, index) => ({
			id: `call-${index + 1}`,
			name: 'web_search',
			arguments: JSON.stringify({ query: `query ${index + 1}` }),
		}));
		const { coordinator, request, search } = coordinatorWith([
			toolRound(calls),
			finalRound('Twenty calls completed'),
		]);

		const result = await coordinator.submit(aiRequest(), options({ maxToolCalls: 20 }));

		expect(result.content).toBe('Twenty calls completed');
		expect(search).toHaveBeenCalledTimes(20);
		expect(result.activities).toHaveLength(20);
		expect(request).toHaveBeenCalledTimes(2);
	});

	it('rejects the 21st proposed call without executing its final batch', async () => {
		const firstBatch = Array.from({ length: 20 }, (_, index) => ({
			id: `call-${index + 1}`,
			name: 'web_search',
			arguments: JSON.stringify({ query: `query ${index + 1}` }),
		}));
		const { coordinator, request, search } = coordinatorWith([
			toolRound(firstBatch),
			toolRound([{ id: 'call-21', name: 'web_search', arguments: '{"query":"over limit"}' }]),
			finalRound('Must not be returned'),
		]);

		await expect(coordinator.submit(aiRequest(), options({ maxToolCalls: 20 }))).rejects.toThrow(
			'The model exceeded the 20-call web tool call limit. No calls in the final batch were executed.',
		);
		expect(search).toHaveBeenCalledTimes(20);
		expect(search.mock.calls.map((call) => call[0].query)).not.toContain('over limit');
		expect(request).toHaveBeenCalledTimes(2);
	});

	it('caps fetch content, marks truncation, and skips retrieval after the shared budget is exhausted', async () => {
		const huge = 'x'.repeat(40001);
		const search = vi.fn(async () => [{ ...parsedSearchResult, snippet: huge, summary: '' }]);
		const fetchPage = vi.fn(async () => ({ title: 'Huge', content: 'y'.repeat(13000) }));
		const { coordinator, request } = coordinatorWith([
			toolRound([
				{ id: 'call-1', name: 'web_search', arguments: '{"query":"huge"}' },
				{ id: 'call-2', name: 'web_fetch', arguments: '{"url":"https://example.test/large"}' },
			]),
			finalRound(),
		], search, fetchPage);

		const result = await coordinator.submit(aiRequest(), options());

		expect(search).toHaveBeenCalledOnce();
		expect(fetchPage).not.toHaveBeenCalled();
		const continuation = request.mock.calls[1]?.[0].continuation ?? [];
		const searchTool = continuation.find((message) => message.role === 'tool' && message.toolCallId === 'call-1');
		const skippedTool = continuation.find((message) => message.role === 'tool' && message.toolCallId === 'call-2');
		expect(searchTool?.role === 'tool' && searchTool.content).toContain('[...]');
		expect(searchTool?.role === 'tool' && searchTool.content).toContain('"truncated":true');
		expect(skippedTool?.role === 'tool' && skippedTool.content).toContain('budget exhausted');
		expect(result.sources).toHaveLength(1);
	});

	it('applies the 12,000-character per-fetch limit while budget remains', async () => {
		const search = vi.fn(async () => []);
		const fetchPage = vi.fn(async () => ({ title: 'Huge', content: 'y'.repeat(13000) }));
		const { coordinator, request } = coordinatorWith([
			toolRound([{ id: 'call-1', name: 'web_fetch', arguments: '{"url":"https://example.test/large"}' }]),
			finalRound(),
		], search, fetchPage);

		await coordinator.submit(aiRequest(), options());

		const toolMessage = request.mock.calls[1]?.[0].continuation?.find((message) => message.role === 'tool');
		const payload = JSON.parse(toolMessage?.role === 'tool' ? toolMessage.content : '{}') as {
			content: string;
			truncated: boolean;
		};
		expect(payload.content).toHaveLength(12005);
		expect(payload.content.endsWith('[...]')).toBe(true);
		expect(payload.truncated).toBe(true);
	});

	it('propagates retrieval failure without another model round or retry', async () => {
		const failure = new Error('Search unavailable');
		const search = vi.fn(async () => { throw failure; });
		const { coordinator, request } = coordinatorWith([
			toolRound([{ id: 'call-1', name: 'web_search', arguments: '{"query":"failure"}' }]),
			finalRound(),
		], search);

		await expect(coordinator.submit(aiRequest(), options())).rejects.toBe(failure);
		expect(search).toHaveBeenCalledOnce();
		expect(request).toHaveBeenCalledOnce();
	});

	it('honors cancellation during review before retrieval', async () => {
		const controller = new AbortController();
		const reviewCalls = vi.fn(async () => {
			controller.abort();
			return [] as WebToolCall[];
		});
		const { coordinator, search } = coordinatorWith([
			toolRound([{ id: 'call-1', name: 'web_search', arguments: '{"query":"cancel"}' }]),
			finalRound(),
		]);

		await expect(coordinator.submit(aiRequest(), options({
			mode: 'review',
			reviewCalls,
			signal: controller.signal,
		}))).rejects.toThrow();
		expect(search).not.toHaveBeenCalled();
	});
});


describe('DeepSeek web follow-up behavior', () => {
	it('returns fetch failures as tool outcomes so the model can finish with other evidence', async () => {
		const failure = new Error('HTTP 403 from GitHub');
		const fetchPage = vi.fn(async () => { throw failure; });
		const { coordinator, request } = coordinatorWith([
			toolRound([{ id: 'call-fetch', name: 'web_fetch', arguments: '{"url":"https://github.com/example/repo"}' }]),
			finalRound('Search summaries answered part of the question; the GitHub page could not be read.'),
		], vi.fn(async () => [parsedSearchResult]), fetchPage);

		const result = await coordinator.submit(aiRequest(), options());

		expect(result.content).toContain('could not be read');
		expect(result.sources).toEqual([]);
		expect(result.activities).toEqual([{
			type: 'fetch',
			target: 'https://github.com/example/repo',
			status: 'failed',
		}]);
		expect(request).toHaveBeenCalledTimes(2);
		const toolMessage = request.mock.calls[1]?.[0].continuation?.find(
			(message) => message.role === 'tool',
		);
		expect(toolMessage?.role === 'tool' && toolMessage.content).toContain('fetch_failed');
		expect(toolMessage?.role === 'tool' && toolMessage.content).not.toContain('dummy-key');
	});

	it('uses search summaries first and tells the model to disclose unread fetched pages', async () => {
		const { coordinator, request } = coordinatorWith([finalRound('No fetch needed')]);

		await coordinator.submit(aiRequest(), options());

		const firstRequest = request.mock.calls[0]?.[0];
		const fetchTool = firstRequest?.tools?.find((tool) => tool.function.name === 'web_fetch');
		expect(fetchTool?.function.description).toContain('Do not fetch merely because a search result exists');
		expect(firstRequest?.systemPrompt).toContain('If a fetch fails, do not claim the page was read');
	});

	it('records completed search and fetch activity for folded review', async () => {
		const { coordinator } = coordinatorWith([
			toolRound([{ id: 'call-search', name: 'web_search', arguments: '{"query":"activity query"}' }]),
			toolRound([{ id: 'call-fetch', name: 'web_fetch', arguments: '{"url":"https://example.test/page"}' }]),
			finalRound(),
		]);

		const result = await coordinator.submit(aiRequest(), options());

		expect(result.activities).toEqual([
			{ type: 'search', target: 'activity query', status: 'completed' },
			{ type: 'fetch', target: 'https://example.test/page', status: 'completed' },
		]);
	});
});


describe('DeepSeek search-first retrieval', () => {
	it('bounds returned search page content separately with explicit truncation metadata', async () => {
		const search = vi.fn(async () => [{
			...parsedSearchResult,
			content: 'z'.repeat(7000),
		}]);
		const { coordinator, request } = coordinatorWith([
			toolRound([{ id: 'call-search', name: 'web_search', arguments: '{"query":"full content"}' }]),
			finalRound('Search content was sufficient; no fetch is needed.'),
		], search);

		await coordinator.submit(aiRequest(), options());

		const toolMessage = request.mock.calls[1]?.[0].continuation?.find(
			(message) => message.role === 'tool',
		);
		const payload = JSON.parse(toolMessage?.role === 'tool' ? toolMessage.content : '{}') as {
			results: Array<{ content: string; contentTruncated: boolean }>;
		};
		expect(payload.results[0]?.content).toHaveLength(6005);
		expect(payload.results[0]?.content.endsWith('[...]')).toBe(true);
		expect(payload.results[0]?.contentTruncated).toBe(true);
	});

	it.each([400, 401, 402, 413])('keeps fetch account/request HTTP %s fatal', async (status) => {
		const failure = Object.assign(new Error(`HTTP ${status}`), { status });
		const fetchPage = vi.fn(async () => { throw failure; });
		const { coordinator, request } = coordinatorWith([
			toolRound([{ id: 'call-fetch', name: 'web_fetch', arguments: '{"url":"https://example.test/private"}' }]),
			finalRound('Must not be returned'),
		], vi.fn(async () => []), fetchPage);

		await expect(coordinator.submit(aiRequest(), options())).rejects.toBe(failure);
		expect(request).toHaveBeenCalledOnce();
	});

	it('treats an empty fetched page as unread rather than evidence', async () => {
		const fetchPage = vi.fn(async () => ({ title: 'Empty', content: '  ' }));
		const { coordinator } = coordinatorWith([
			toolRound([{ id: 'call-fetch', name: 'web_fetch', arguments: '{"url":"https://example.test/empty"}' }]),
			finalRound('The requested page was unavailable.'),
		], vi.fn(async () => []), fetchPage);

		const result = await coordinator.submit(aiRequest(), options());

		expect(result.activities).toEqual([{
			type: 'fetch',
			target: 'https://example.test/empty',
			status: 'failed',
		}]);
		expect(result.sources).toEqual([]);
	});
});
