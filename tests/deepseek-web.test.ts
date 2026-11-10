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
import { resolveRoundTokenUsage } from '../src/token-usage';
import type { ProviderConfig } from '../src/types';
import type { WebExtractionOutcome } from '../src/web-extraction';
import {
	WebExtractionReader,
	type WebExtractionReaderOptions,
	type WebExtractionReaderResult,
} from '../src/web-extraction-reader';
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
			{ id: 'call-1', name: 'web_search', query: 'Emend plugin', extractionGoal: 'Find streaming request fields.' },
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
			{ id: 'call-2', name: 'web_fetch', url: 'https://example.test/docs', extractionGoal: 'Extract the documentation facts.' },
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
			{ id: 'call-1', name: 'web_search', query: 'Emend', extractionGoal: 'Find relevant evidence.' },
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
			{ id: 'call-2', name: 'web_fetch', url: 'https://example.test/private', extractionGoal: 'Extract the private-page error evidence.' },
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
			{ id: 'call-2', name: 'web_fetch', url: 'https://example.test/docs', extractionGoal: 'Extract the documentation facts.' },
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

function toolRound(calls: Array<{ id: string; name: string; arguments: string }>, content = '', reasoning = ''): StreamResult {
	return { content, reasoning, finishReason: 'tool_calls', toolCalls: calls };
}

function finalRound(content = 'Final answer', reasoning = ''): StreamResult {
	return { content, reasoning, finishReason: 'stop' };
}

function options(overrides: Partial<WebSearchRunOptions> = {}): WebSearchRunOptions {
	return {
		mode: 'auto',
		maxToolCalls: 8,
		question: 'Research Emend',
		maxContentCharactersPerCall: 20000,
		reviewCalls: vi.fn(async (calls: readonly WebToolCall[]) => calls),
		onActivity: vi.fn(),
		callbacks: { onEvent: vi.fn() },
		signal: new AbortController().signal,
		...overrides,
	};
}

function readerResult(
	_readerOptions: WebExtractionReaderOptions,
	outcome: WebExtractionOutcome,
): WebExtractionReaderResult {
	const content = JSON.stringify(outcome);
	return {
		outcome,
		rounds: [{
			request: {
				provider,
				systemPrompt: 'Reader system',
				userPrompt: 'Reader question',
				history: [],
			},
			result: { content, reasoning: 'Private reader reasoning' },
		}],
	};
}

function successfulReader() {
	return {
		extract: vi.fn(async (readerOptions: WebExtractionReaderOptions) => {
			const document = readerOptions.documents[0];
			const outcome: WebExtractionOutcome = document
				? {
					outcome: 'evidence',
					results: [{
						sourceId: document.sourceId,
						claims: [],
						evidence: ['Title:'],
					}],
				}
				: { outcome: 'no_relevant_evidence', results: [] };
			return readerResult(readerOptions, outcome);
		}),
	};
}

function coordinatorWith(
	rounds: StreamResult[],
	search = vi.fn(async (_call: Extract<WebToolCall, { name: 'web_search' }>) => [parsedSearchResult]),
	fetchPage = vi.fn(async () => ({ title: 'Fetched page', content: 'Fetched content' })),
	reader: Pick<WebExtractionReader, 'extract'> = successfulReader(),
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
		reader,
	});
	return { coordinator, request, search, fetchPage, reader };
}

function searchCall(id: string, query: string, goal = 'Find relevant evidence.') {
	return { id, name: 'web_search', arguments: JSON.stringify({ query, extractionGoal: goal }) };
}

function fetchCall(id: string, url: string, goal = 'Find relevant evidence.') {
	return { id, name: 'web_fetch', arguments: JSON.stringify({ url, extractionGoal: goal }) };
}

describe('DeepSeekWebSearchCoordinator', () => {
	it('allows a terminal answer without retrieval and emits only final content', async () => {
		const { coordinator, request, search, reader } = coordinatorWith([finalRound('No research needed')]);

		const result = await coordinator.submit(aiRequest(), options());

		expect(result.content).toBe('No research needed');
		expect(result.failedExtractions).toBe(0);
		expect(result.sources).toEqual([]);
		expect(result.rounds).toHaveLength(1);
		expect(request).toHaveBeenCalledOnce();
		expect(search).not.toHaveBeenCalled();
		expect(reader.extract).not.toHaveBeenCalled();
	});

	it.each([
		{ kind: 'search', size: 'small', content: 'Small body' },
		{ kind: 'search', size: 'large', content: 'Large body' },
		{ kind: 'fetch', size: 'small', content: 'Small body' },
		{ kind: 'fetch', size: 'large', content: 'Large body' },
	] as const)('uses one isolated reader for a $size $kind result and returns only mapped evidence', async ({ kind, size, content }) => {
		const rawMarker = `raw-${kind}-${size}-marker`;
		const rawContent = `${content} ${rawMarker}${size === 'large' ? 'x'.repeat(50000) : ''}`;
		const snippet = `Snippet ${rawMarker}`;
		const summary = `Summary ${rawMarker}`;
		const search = vi.fn(async () => [{ ...parsedSearchResult, snippet, summary, content: rawContent }]);
		const fetchPage = vi.fn(async () => ({ title: 'Fetched page', content: rawContent }));
		const reader = successfulReader();
		const call = kind === 'search'
			? searchCall('call-1', 'target query', 'Exact extraction goal')
			: fetchCall('call-1', 'https://example.test/emend', 'Exact extraction goal');
		const { coordinator, request } = coordinatorWith([
			toolRound([call]),
			finalRound('Answer [S1]'),
		], search, fetchPage, reader);

		const result = await coordinator.submit(aiRequest(), options({
			question: 'Only the typed current question',
			maxContentCharactersPerCall: 20000,
		}));

		expect(reader.extract).toHaveBeenCalledOnce();
		const input = reader.extract.mock.calls[0]?.[0];
		expect(input).toMatchObject({
			question: 'Only the typed current question',
			extractionGoal: 'Exact extraction goal',
			target: kind === 'search' ? 'target query' : 'https://example.test/emend',
		});
		const expectedTitle = kind === 'search' ? 'Emend documentation' : 'Fetched page';
		expect(input?.documents).toEqual([{
			sourceId: 'R1',
			title: expectedTitle,
			url: 'https://example.test/emend',
			...(kind === 'search' ? { snippet } : {}),
			canonicalText: kind === 'search'
				? `Title: ${expectedTitle}\nSnippet: ${snippet}\nSummary: ${summary}\nContent: ${rawContent}`
				: `Title: ${expectedTitle}\nSnippet: \nSummary: \nContent: ${rawContent}`,
		}]);
		const mainSystemPrompt = request.mock.calls[0]?.[0].systemPrompt ?? '';
		expect(mainSystemPrompt).toContain('Treat claims as compressions');
		expect(mainSystemPrompt).toContain('quoted evidence as ground truth');
		expect(mainSystemPrompt).toContain('must remain supported by the supplied evidence');
		const continuation = request.mock.calls[1]?.[0].continuation ?? [];
		const toolMessage = continuation.find((message) => message.role === 'tool');
		const payload = JSON.parse(toolMessage?.role === 'tool' ? toolMessage.content : '{}') as {
			results: Array<{
				sourceId: string;
				title?: string;
				url?: string;
				evidence?: string[];
			}>;
		};
		expect(payload).toEqual({
			extraction: 'ai-reader',
			outcome: 'evidence',
			results: [{
				sourceId: 'S1',
				title: expectedTitle,
				url: 'https://example.test/emend',
				evidence: ['Title:'],
			}],
		});
		expect(JSON.stringify(continuation)).not.toContain(rawMarker);
		expect(result.sources).toEqual([{
			id: 'S1',
			title: expectedTitle,
			url: 'https://example.test/emend',
			...(kind === 'search' ? { snippet } : {}),
		}]);
		expect(result.failedExtractions).toBe(0);
		expect(result.reasoning).not.toContain('Private reader reasoning');
	});

	it('runs two heavy searches independently without shared truncation or a total cap', async () => {
		const search = vi.fn(async (call: Extract<WebToolCall, { name: 'web_search' }>) => {
			const round = call.query === 'first-heavy' ? 1 : 2;
			return Array.from({ length: 5 }, (_, index) => ({
				...parsedSearchResult,
				title: `Round ${round} result ${index + 1}`,
				url: `https://example.test/round-${round}/result-${index + 1}`,
				snippet: '',
				summary: '',
				content: `${round}-${index}-${'x'.repeat(60000)}`,
			}));
		});
		const reader = successfulReader();
		reader.extract.mockImplementation(async (input) => readerResult(input, {
			outcome: 'evidence',
			results: [{
				sourceId: 'R1',
				claims: [],
				evidence: ['Title:', 'x'.repeat(300)],
			}],
		}));
		const { coordinator, request } = coordinatorWith([
			toolRound([searchCall('call-1', 'first-heavy')]),
			toolRound([searchCall('call-2', 'second-heavy')]),
			finalRound('Answer from independently extracted evidence'),
		], search, undefined, reader);

		const result = await coordinator.submit(aiRequest(), options({
			maxToolCalls: 20,
			maxContentCharactersPerCall: 5000,
		}));

		expect(result.content).toBe('Answer from independently extracted evidence');
		expect(result.failedExtractions).toBe(0);
		expect(search).toHaveBeenCalledTimes(2);
		expect(reader.extract).toHaveBeenCalledTimes(2);
		expect(result.activities).toEqual([
			{ type: 'search', target: 'first-heavy', status: 'completed' },
			{ type: 'search', target: 'second-heavy', status: 'completed' },
		]);
		expect(result.sources.map((source) => source.id)).toEqual(['S1', 'S2']);
		const toolMessages = request.mock.calls[2]?.[0].continuation?.filter(
			(message) => message.role === 'tool',
		) ?? [];
		expect(toolMessages).toHaveLength(2);
		const serialized = toolMessages.map((message) => message.role === 'tool' ? message.content : '');
		expect(serialized[0]?.length).toBeLessThanOrEqual(5000);
		expect(serialized[1]?.length).toBeLessThanOrEqual(5000);
		expect((serialized[0]?.length ?? 0) + (serialized[1]?.length ?? 0)).toBeLessThanOrEqual(10000);
		for (const payload of serialized) {
			expect(payload).not.toContain('[...]');
			expect(payload).not.toContain('truncated');
			expect(payload).not.toContain('budget exhausted');
			expect(payload).not.toContain('60000');
		}
	});

	it('keeps successful citations contiguous across no-relevant and failed extractions', async () => {
		const search = vi.fn(async (call: Extract<WebToolCall, { name: 'web_search' }>) => [{
			...parsedSearchResult,
			title: `Title ${call.query}`,
			url: `https://example.test/${call.query}`,
			snippet: `RAW-${call.query}`,
			content: `CONTENT-${call.query}`,
		}]);
		const reader = successfulReader();
		const failure = new Error('Reader provider unavailable');
		reader.extract.mockImplementation(async (input) => {
			if (input.target === 'failure') throw failure;
			if (input.target === 'no-relevant') {
				return readerResult(input, { outcome: 'no_relevant_evidence', results: [] });
			}
			return readerResult(input, {
				outcome: 'evidence',
				results: [{ sourceId: 'R1', claims: [], evidence: ['Title:'] }],
			});
		});
		const { coordinator, request } = coordinatorWith([
			toolRound([
				searchCall('call-success', 'success'),
				searchCall('call-failure', 'failure'),
				searchCall('call-none', 'no-relevant'),
			]),
			finalRound('Partial answer [S1]', 'Main reasoning'),
		], search, undefined, reader);

		const result = await coordinator.submit(aiRequest(), options());

		expect(result.content).toBe('Partial answer [S1]');
		expect(result.failedExtractions).toBe(1);
		expect(reader.extract).toHaveBeenCalledTimes(3);
		expect(result.sources).toEqual([{
			id: 'S1',
			title: 'Title success',
			url: 'https://example.test/success',
			snippet: 'RAW-success',
		}]);
		expect(result.activities).toEqual([
			{ type: 'search', target: 'success', status: 'completed' },
			{ type: 'search', target: 'failure', status: 'failed' },
			{ type: 'search', target: 'no-relevant', status: 'completed' },
		]);
		const toolMessages = request.mock.calls[1]?.[0].continuation?.filter(
			(message) => message.role === 'tool',
		) ?? [];
		const byId = new Map(toolMessages.map((message) => [
			message.role === 'tool' ? message.toolCallId : '',
			message.role === 'tool' ? message.content : '',
		]));
		expect(JSON.parse(byId.get('call-success') ?? '{}')).toMatchObject({
			outcome: 'evidence',
			results: [{ sourceId: 'S1', evidence: ['Title:'] }],
		});
		expect(byId.get('call-failure')).toBe('{"error":"extraction_failed"}');
		expect(JSON.parse(byId.get('call-none') ?? '{}')).toEqual({
			extraction: 'ai-reader',
			outcome: 'no_relevant_evidence',
			results: [],
		});
		expect(JSON.stringify(toolMessages)).not.toContain('CONTENT-');
		expect(JSON.stringify(toolMessages)).not.toContain('Reader provider unavailable');
		expect(result.reasoning).toBe('Main reasoning');
	});

	it('assigns citation IDs in retrieval order even when reader results are reversed', async () => {
		const search = vi.fn(async () => [
			{ ...parsedSearchResult, title: 'First', url: 'https://example.test/first' },
			{ ...parsedSearchResult, title: 'Second', url: 'https://example.test/second' },
		]);
		const reader = successfulReader();
		reader.extract.mockImplementation(async (input) => readerResult(input, {
			outcome: 'evidence',
			results: [
				{ sourceId: 'R2', claims: [], evidence: ['Title:'] },
				{ sourceId: 'R1', claims: [], evidence: ['Title:'] },
			],
		}));
		const { coordinator, request } = coordinatorWith([
			toolRound([searchCall('call-1', 'ordered')]),
			finalRound(),
		], search, undefined, reader);

		const result = await coordinator.submit(aiRequest(), options());

		expect(result.sources.map((source) => [source.id, source.title])).toEqual([
			['S1', 'First'],
			['S2', 'Second'],
		]);
		const toolMessage = request.mock.calls[1]?.[0].continuation?.find((message) => message.role === 'tool');
		const payload = JSON.parse(toolMessage?.role === 'tool' ? toolMessage.content : '{}') as {
			results: Array<{
				sourceId: string;
				title?: string;
				url?: string;
				evidence?: string[];
			}>;
		};
		expect(payload.results.map((result: { sourceId: string }) => result.sourceId)).toEqual(['S2', 'S1']);
	});

	it('fits a final staged payload within the per-call cap instead of failing the extraction', async () => {
		const reader = successfulReader();
		reader.extract.mockImplementation(async (input) => readerResult(input, {
			outcome: 'evidence',
			results: [{ sourceId: 'R1', claims: [], evidence: ['x'.repeat(2000)] }],
		}));
		const { coordinator, request } = coordinatorWith([
			toolRound([searchCall('call-1', 'oversized')]),
			finalRound('Answer from fitted evidence'),
		], undefined, undefined, reader);

		const result = await coordinator.submit(aiRequest(), options({ maxContentCharactersPerCall: 1000 }));

		expect(result.content).toBe('Answer from fitted evidence');
		expect(result.failedExtractions).toBe(0);
		expect(result.activities).toEqual([{ type: 'search', target: 'oversized', status: 'completed' }]);
		expect(result.sources.map((source) => source.id)).toEqual(['S1']);
		const toolMessage = request.mock.calls[1]?.[0].continuation?.find((message) => message.role === 'tool');
		const content = toolMessage?.role === 'tool' ? toolMessage.content : '';
		expect(content.length).toBeLessThanOrEqual(1000);
		const payload = JSON.parse(content) as {
			results: Array<{ sourceId: string; evidence: string[]; truncated?: boolean }>;
		};
		expect(payload.results).toHaveLength(1);
		expect(payload.results[0]?.sourceId).toBe('S1');
		expect(payload.results[0]?.evidence).toHaveLength(1);
		expect(payload.results[0]?.evidence[0]!.length).toBeLessThan(2000);
		expect('x'.repeat(2000).startsWith(payload.results[0]?.evidence[0] ?? '')).toBe(true);
		expect(payload.results[0]?.truncated).toBe(true);
	});

	it('keeps verifier-approved claims and their quotes out of raw retrieval', async () => {
		const rawMarker = 'RAW_RETRIEVAL_MUST_NOT_LEAK';
		const search = vi.fn(async () => [{
			...parsedSearchResult,
			snippet: 'Snippet text',
			summary: 'Summary text',
			content: `${rawMarker} body`,
		}]);
		const reader = successfulReader();
		reader.extract.mockImplementation(async (input) => readerResult(input, {
			outcome: 'evidence',
			results: [{
				sourceId: 'R1',
				claims: [{ text: 'Verified claim', evidence: ['Snippet text'] }],
				evidence: [],
			}],
		}));
		const { coordinator, request } = coordinatorWith([
			toolRound([searchCall('call-1', 'claims')]),
			finalRound('Answer [S1]'),
		], search, undefined, reader);

		await coordinator.submit(aiRequest(), options());

		const continuation = request.mock.calls[1]?.[0].continuation ?? [];
		const toolMessage = continuation.find((message) => message.role === 'tool');
		expect(JSON.parse(toolMessage?.role === 'tool' ? toolMessage.content : '{}')).toEqual({
			extraction: 'ai-reader',
			outcome: 'evidence',
			results: [{
				sourceId: 'S1',
				title: 'Emend documentation',
				url: 'https://example.test/emend',
				claims: [{ text: 'Verified claim', evidence: ['Snippet text'] }],
			}],
		});
		expect(JSON.stringify(continuation)).not.toContain(rawMarker);
		expect(JSON.stringify(continuation)).not.toContain('Summary text');
	});

	it('falls back to extractor quotes when a verifier rejects every claim', async () => {
		const search = vi.fn(async () => [{
			...parsedSearchResult,
			snippet: 'Snippet text',
			summary: 'Summary text',
			content: 'CANONICAL_RAW_BODY',
		}]);
		let mainRound = 0;
		const request = vi.fn(async (roundRequest: AiProviderRequest): Promise<StreamResult> => {
			if (roundRequest.tools?.some((tool) => tool.function.name === 'web_search')) {
				mainRound += 1;
				return mainRound === 1
					? toolRound([searchCall('call-1', 'verify-fallback')])
					: finalRound('Answer [S1]');
			}
			if (roundRequest.tools?.some((tool) => tool.function.name === 'retrieval_grep')) {
				return finalRound(JSON.stringify({
					outcome: 'evidence',
					results: [{
						sourceId: 'R1',
						claims: [{ text: 'Rejected claim', evidence: ['Snippet text'] }],
					}],
				}));
			}
			if (roundRequest.systemPrompt.includes('claim verifier')) {
				return finalRound(JSON.stringify({
					outcome: 'verify',
					results: [{ sourceId: 'R1', verdicts: [{ claimIndex: 0, supported: false }] }],
				}));
			}
			if (roundRequest.systemPrompt.includes('revise')) {
				return finalRound(JSON.stringify({
					outcome: 'evidence',
					results: [{
						sourceId: 'R1',
						claims: [{ text: 'Rejected claim', evidence: ['Snippet text'] }],
					}],
				}));
			}
			throw new Error('Unexpected reader request');
		});
		const coordinator = new DeepSeekWebSearchCoordinator({
			provider,
			request,
			search,
			reader: new WebExtractionReader({ provider, request }),
		});

		const result = await coordinator.submit(aiRequest(), options());

		expect(result.content).toBe('Answer [S1]');
		expect(result.failedExtractions).toBe(0);
		expect(result.sources.map((source) => source.id)).toEqual(['S1']);
		expect(result.activities).toEqual([{
			type: 'search',
			target: 'verify-fallback',
			status: 'completed',
		}]);
		const mainRequests = request.mock.calls
			.map((call) => call[0])
			.filter((roundRequest) => roundRequest.tools?.some((tool) => tool.function.name === 'web_search'));
		const continuation = mainRequests.at(-1)?.continuation ?? [];
		const toolMessage = continuation.find((message) => message.role === 'tool');
		expect(JSON.parse(toolMessage?.role === 'tool' ? toolMessage.content : '{}')).toEqual({
			extraction: 'ai-reader',
			outcome: 'evidence',
			results: [{
				sourceId: 'S1',
				title: 'Emend documentation',
				url: 'https://example.test/emend',
				evidence: ['Snippet text'],
			}],
		});
		expect(JSON.stringify(continuation)).not.toContain('Rejected claim');
		expect(JSON.stringify(continuation)).not.toContain('CANONICAL_RAW_BODY');
		expect(JSON.stringify(continuation)).not.toContain('Summary text');
	});

	it('fails extraction only when the extractor stays unparseable through correction', async () => {
		let mainRound = 0;
		const request = vi.fn(async (roundRequest: AiProviderRequest): Promise<StreamResult> => {
			if (roundRequest.tools?.some((tool) => tool.function.name === 'web_search')) {
				mainRound += 1;
				return mainRound === 1
					? toolRound([searchCall('call-1', 'format-failure')])
					: finalRound('Answer without extracted evidence');
			}
			if (roundRequest.tools?.some((tool) => tool.function.name === 'retrieval_grep')) {
				return finalRound('{');
			}
			return finalRound('still not json');
		});
		const coordinator = new DeepSeekWebSearchCoordinator({
			provider,
			request,
			search: vi.fn(async () => [parsedSearchResult]),
			reader: new WebExtractionReader({ provider, request }),
		});

		const result = await coordinator.submit(aiRequest(), options());

		expect(result.content).toBe('Answer without extracted evidence');
		expect(result.failedExtractions).toBe(1);
		expect(result.sources).toEqual([]);
		expect(result.activities).toEqual([{
			type: 'search',
			target: 'format-failure',
			status: 'failed',
		}]);
		const mainRequests = request.mock.calls
			.map((call) => call[0])
			.filter((roundRequest) => roundRequest.tools?.some((tool) => tool.function.name === 'web_search'));
		const toolMessage = mainRequests.at(-1)?.continuation?.find((message) => message.role === 'tool');
		expect(toolMessage?.role === 'tool' && toolMessage.content).toBe('{"error":"extraction_failed"}');
	});

	it('interleaves reader rounds chronologically without exposing reader reasoning', async () => {
		const mainTool = toolRound([searchCall('call-1', 'rounds')], '', 'Main one');
		const mainFinal = finalRound('Final answer', 'Main two');
		const readerOne: StreamResult = { content: '', reasoning: 'Reader private one', finishReason: 'tool_calls' };
		const readerTwo: StreamResult = { content: '{}', reasoning: 'Reader private two', finishReason: 'stop' };
		const reader = successfulReader();
		reader.extract.mockImplementation(async (input) => {
			const extracted = readerResult(input, {
				outcome: 'evidence',
				results: [{ sourceId: 'R1', claims: [], evidence: ['Title:'] }],
			});
			return {
				...extracted,
				rounds: [
					{ request: { ...aiRequest(), systemPrompt: 'Reader one' }, result: readerOne },
					{ request: { ...aiRequest(), systemPrompt: 'Reader two' }, result: readerTwo },
				],
			};
		});
		const onEvent = vi.fn();
		const { coordinator } = coordinatorWith([mainTool, mainFinal], undefined, undefined, reader);

		const result = await coordinator.submit(aiRequest(), options({ callbacks: { onEvent } }));

		expect(result.rounds.map((round) => round.result)).toEqual([
			mainTool,
			readerOne,
			readerTwo,
			mainFinal,
		]);
		expect(result.reasoning).toBe('Main oneMain two');
		expect(onEvent).not.toHaveBeenCalledWith({ type: 'reasoning', text: 'Reader private one' });
		expect(onEvent).not.toHaveBeenCalledWith({ type: 'reasoning', text: 'Reader private two' });
	});

	it.each(['complete', 'missing'] as const)('records a completed and a failed reader attempt for %s usage', async (usageCase) => {
		const mainRounds = [
			{
				...toolRound([searchCall('call-1', 'reader failure')]),
				usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
			},
			{
				...finalRound('Degraded answer'),
				usage: { promptTokens: 30, completionTokens: 7, totalTokens: 37 },
			},
		];
		const failure = new Error('Reader provider failed after one round');
		let mainIndex = 0;
		let readerCalls = 0;
		const request = vi.fn(async (roundRequest: AiProviderRequest): Promise<StreamResult> => {
			if (roundRequest.tools?.some((tool) => tool.function.name === 'retrieval_grep')) {
				readerCalls += 1;
				if (readerCalls === 2) throw failure;
				return {
					content: '',
					reasoning: 'Private reader reasoning',
					finishReason: 'tool_calls',
					toolCalls: [{ id: 'grep-1', name: 'retrieval_grep', arguments: '{"query":"evidence"}' }],
					...(usageCase === 'complete'
						? { usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 } }
						: {}),
				};
			}
			const result = mainRounds[mainIndex];
			mainIndex += 1;
			if (!result) throw new Error('Unexpected main model round');
			return result;
		});
		const coordinator = new DeepSeekWebSearchCoordinator({
			provider,
			request,
			search: vi.fn(async () => [parsedSearchResult]),
		});

		const result = await coordinator.submit(aiRequest(), options());

		expect(result.content).toBe('Degraded answer');
		expect(result.failedExtractions).toBe(1);
		expect(result.sources).toEqual([]);
		expect(result.rounds).toHaveLength(4);
		expect(result.rounds[1]?.request.tools?.map((tool) => tool.function.name)).toEqual([
			'retrieval_grep',
			'retrieval_read',
		]);
		expect(result.rounds[2]?.result).toEqual({ content: '', reasoning: '' });
		expect(result.reasoning).not.toContain('Private reader reasoning');
		const usage = resolveRoundTokenUsage(result.rounds);
		expect(usage.source).toBe('estimated');
		expect(usage.totalTokens).toBeGreaterThan(0);
	});

	it.each(['reject', 'resolve'] as const)('rejects the entire submission when a reader %s aborts', async (behavior) => {
		const controller = new AbortController();
		const reason = new DOMException('Stopped', 'AbortError');
		const reader = successfulReader();
		reader.extract.mockImplementation(async (input) => {
			if (behavior === 'reject') throw reason;
			controller.abort(reason);
			return readerResult(input, {
				outcome: 'evidence',
				results: [{ sourceId: 'R1', claims: [], evidence: ['Title:'] }],
			});
		});
		const { coordinator, request } = coordinatorWith([
			toolRound([searchCall('call-1', 'abort')]),
			finalRound('Must not be returned'),
		], undefined, undefined, reader);

		await expect(coordinator.submit(aiRequest(), options({ signal: controller.signal }))).rejects.toBe(reason);
		expect(request).toHaveBeenCalledOnce();
		expect(reader.extract).toHaveBeenCalledOnce();
	});

	it('rejects an abort returned with terminal main-model output', async () => {
		const controller = new AbortController();
		const reason = new DOMException('Stopped', 'AbortError');
		const request = vi.fn(async () => {
			controller.abort(reason);
			return finalRound('Must not be returned');
		});
		const coordinator = new DeepSeekWebSearchCoordinator({ provider, request });

		await expect(coordinator.submit(aiRequest(), options({ signal: controller.signal }))).rejects.toBe(reason);
	});

	it('uses validated Review edits for retrieval and reader goal/target', async () => {
		const edited: WebToolCall[] = [{
			id: 'call-1',
			name: 'web_search',
			query: 'edited query',
			extractionGoal: 'Extract edited evidence.',
		}];
		const reviewCalls = vi.fn(async () => edited);
		const reader = successfulReader();
		const { coordinator, request, search } = coordinatorWith([
			toolRound([searchCall('call-1', 'original')]),
			finalRound(),
		], undefined, undefined, reader);

		await coordinator.submit(aiRequest(), options({ mode: 'review', reviewCalls }));

		expect(reviewCalls).toHaveBeenCalledWith([{
			id: 'call-1',
			name: 'web_search',
			query: 'original',
			extractionGoal: 'Find relevant evidence.',
		}]);
		expect(search.mock.calls[0]?.[0]).toMatchObject({
			query: 'edited query',
			extractionGoal: 'Extract edited evidence.',
		});
		expect(reader.extract.mock.calls[0]?.[0]).toMatchObject({
			target: 'edited query',
			extractionGoal: 'Extract edited evidence.',
		});
		const continuation = request.mock.calls[1]?.[0].continuation?.find(
			(message) => message.role === 'assistant',
		);
		expect(continuation && 'toolCalls' in continuation ? continuation.toolCalls : undefined).toEqual([{
			id: 'call-1',
			name: 'web_search',
			arguments: '{"query":"edited query","extractionGoal":"Extract edited evidence."}',
		}]);
	});

	it('supports sequential multi-call batches and stable deduplicated sources', async () => {
		const search = vi.fn(async (_call: Extract<WebToolCall, { name: 'web_search' }>) => [parsedSearchResult]);
		const fetchPage = vi.fn(async () => ({ title: 'Fetched page', content: 'Fetched content' }));
		const reader = successfulReader();
		const { coordinator, request } = coordinatorWith([
			toolRound([searchCall('call-1', 'first'), searchCall('call-2', 'second')]),
			toolRound([fetchCall('call-3', 'https://example.test/emend')]),
			finalRound(),
		], search, fetchPage, reader);
		const activity: Array<{ status: string; label: string }> = [];

		const result = await coordinator.submit(aiRequest(), options({
			onActivity: (event) => activity.push(event),
		}));

		expect(search.mock.calls.map((call) => call[0].query)).toEqual(['first', 'second']);
		expect(fetchPage).toHaveBeenCalledOnce();
		expect(reader.extract).toHaveBeenCalledTimes(3);
		expect(result.sources).toEqual([{
			id: 'S1',
			title: 'Emend documentation',
			url: 'https://example.test/emend',
			snippet: 'Short evidence',
		}]);
		expect(request.mock.calls[1]?.[0].continuation?.filter((message) => message.role === 'tool')).toHaveLength(2);
		expect(request.mock.calls[2]?.[0].continuation?.filter((message) => message.role === 'tool')).toHaveLength(3);
		expect(activity.map((event) => event.status)).toEqual([
			'pending', 'complete', 'pending', 'complete', 'pending', 'complete',
		]);
	});

	it('executes only remaining Review slots and preserves every call in the forced continuation', async () => {
		const calls = Array.from({ length: 10 }, (_, index) => searchCall(
			`call-${index + 1}`,
			`query ${index + 1}`,
			`goal ${index + 1}`,
		));
		const reader = successfulReader();
		reader.extract.mockImplementation(async (input) => {
			if (input.target === 'edited query 2') {
				throw new Error('Selected reader failure');
			}
			const document = input.documents[0];
			return readerResult(input, document
				? {
					outcome: 'evidence',
					results: [{ sourceId: document.sourceId, claims: [], evidence: ['Title:'] }],
				}
				: { outcome: 'no_relevant_evidence', results: [] });
		});
		const reviewCalls = vi.fn(async (proposed: readonly WebToolCall[]) => proposed.map((call, index) => ({
			...call,
			query: `edited query ${index + 1}`,
			extractionGoal: `edited goal ${index + 1}`,
		})));
		const { coordinator, request, search } = coordinatorWith([
			toolRound(calls),
			finalRound('Answer from remaining evidence [S1]'),
		], undefined, undefined, reader);

		const result = await coordinator.submit(aiRequest(), options({
			mode: 'review',
			maxToolCalls: 8,
			reviewCalls,
		}));

		expect(search.mock.calls.map((call) => call[0].query)).toEqual(
			Array.from({ length: 8 }, (_, index) => `edited query ${index + 1}`),
		);
		expect(reader.extract).toHaveBeenCalledTimes(8);
		expect(reviewCalls).toHaveBeenCalledOnce();
		expect(reviewCalls.mock.calls[0]?.[0].map((call) => call.id)).toEqual(
			Array.from({ length: 8 }, (_, index) => `call-${index + 1}`),
		);
		expect(result.content).toBe('Answer from remaining evidence [S1]');
		expect(result.skippedWebCalls).toBe(2);
		expect(result.failedExtractions).toBe(1);
		expect(result.sources).toEqual([{
			id: 'S1',
			title: 'Emend documentation',
			url: 'https://example.test/emend',
			snippet: 'Short evidence',
		}]);
		expect(result.activities).toHaveLength(10);
		expect(result.activities.slice(-2)).toEqual([
			{ type: 'search', target: 'query 9', status: 'skipped' },
			{ type: 'search', target: 'query 10', status: 'skipped' },
		]);
		expect(result.rounds).toHaveLength(9);
		const forcedRequest = request.mock.calls[1]?.[0];
		expect(forcedRequest?.tools).toBeUndefined();
		expect(forcedRequest?.systemPrompt).toContain('Answer now from the current note, chat, and successfully extracted evidence');
		const assistant = forcedRequest?.continuation?.find((message) => message.role === 'assistant');
		const wireCalls = assistant?.role === 'assistant' && 'toolCalls' in assistant
			? assistant.toolCalls
			: [];
		expect(wireCalls).toHaveLength(10);
		expect(wireCalls.slice(0, 8).map((call) => call.arguments)).toEqual(
			Array.from({ length: 8 }, (_, index) => JSON.stringify({
				query: `edited query ${index + 1}`,
				extractionGoal: `edited goal ${index + 1}`,
			})),
		);
		expect(wireCalls.slice(8)).toEqual(calls.slice(8));
		const outcomes = forcedRequest?.continuation?.filter((message) => message.role === 'tool') ?? [];
		expect(outcomes).toHaveLength(10);
		expect(outcomes.slice(-2).map((message) => message.role === 'tool' ? message.content : '')).toEqual([
			'{"error":{"kind":"call_limit_reached"}}',
			'{"error":{"kind":"call_limit_reached"}}',
		]);
	});

	it('allows exactly 20 proposed calls without a forced round or skipped calls', async () => {
		const calls = Array.from({ length: 20 }, (_, index) => searchCall(
			`call-${index + 1}`,
			`query ${index + 1}`,
			`goal ${index + 1}`,
		));
		const { coordinator, request, search, reader } = coordinatorWith([
			toolRound(calls),
			finalRound('Twenty calls completed'),
		]);

		const result = await coordinator.submit(aiRequest(), options({ maxToolCalls: 20 }));

		expect(result.content).toBe('Twenty calls completed');
		expect(result.skippedWebCalls).toBe(0);
		expect(search).toHaveBeenCalledTimes(20);
		expect(reader.extract).toHaveBeenCalledTimes(20);
		expect(result.activities).toHaveLength(20);
		expect(request).toHaveBeenCalledTimes(2);
	});

	it('skips the 21st call and forces one no-tools answer while preserving all rounds and sources', async () => {
		const firstBatch = Array.from({ length: 20 }, (_, index) => searchCall(
			`call-${index + 1}`,
			`query ${index + 1}`,
			`goal ${index + 1}`,
		));
		const reviewCalls = vi.fn(async (proposed: readonly WebToolCall[]) => proposed);
		const { coordinator, request, search, reader } = coordinatorWith([
			toolRound(firstBatch),
			toolRound([searchCall('call-21', 'over limit')]),
			finalRound('Answer after twenty calls [S1]'),
		]);

		const result = await coordinator.submit(aiRequest(), options({
			mode: 'review',
			maxToolCalls: 20,
			reviewCalls,
		}));

		expect(result.content).toBe('Answer after twenty calls [S1]');
		expect(result.skippedWebCalls).toBe(1);
		expect(result.sources).toHaveLength(1);
		expect(result.rounds).toHaveLength(23);
		expect(search).toHaveBeenCalledTimes(20);
		expect(reader.extract).toHaveBeenCalledTimes(20);
		expect(search.mock.calls.map((call) => call[0].query)).not.toContain('over limit');
		expect(reviewCalls).toHaveBeenCalledOnce();
		expect(request).toHaveBeenCalledTimes(3);
		expect(result.activities.at(-1)).toEqual({
			type: 'search', target: 'over limit', status: 'skipped',
		});
		const forcedRequest = request.mock.calls[2]?.[0];
		expect(forcedRequest?.tools).toBeUndefined();
		const skippedOutcome = forcedRequest?.continuation?.find(
			(message) => message.role === 'tool' && message.toolCallId === 'call-21',
		);
		expect(skippedOutcome?.role === 'tool' && skippedOutcome.content).toBe(
			'{"error":{"kind":"call_limit_reached"}}',
		);
	});

	it('allows a forced answer without evidence or invented citations', async () => {
		const search = vi.fn(async () => []);
		const { coordinator, request, reader } = coordinatorWith([
			toolRound([searchCall('call-1', 'no evidence'), searchCall('call-2', 'skipped')]),
			finalRound('Answer from the current note only.'),
		], search);

		const result = await coordinator.submit(aiRequest(), options({ maxToolCalls: 1 }));

		expect(result.content).toBe('Answer from the current note only.');
		expect(result.skippedWebCalls).toBe(1);
		expect(result.sources).toEqual([]);
		expect(result.content).not.toContain('[S');
		expect(search).toHaveBeenCalledOnce();
		expect(reader.extract).toHaveBeenCalledOnce();
		expect(request).toHaveBeenCalledTimes(2);
	});

	it('rejects further malformed tool calls in the forced round without retrieval or retry', async () => {
		const { coordinator, request, search, reader } = coordinatorWith([
			toolRound([searchCall('call-1', 'first'), searchCall('call-2', 'skipped')]),
			toolRound([{ id: 'bad', name: 'web_search', arguments: 'not-json' }], 'Ignored content'),
		]);

		await expect(coordinator.submit(aiRequest(), options({ maxToolCalls: 1 }))).rejects.toThrow(
			'after the web call limit',
		);
		expect(search).toHaveBeenCalledOnce();
		expect(reader.extract).toHaveBeenCalledOnce();
		expect(request).toHaveBeenCalledTimes(2);
	});

	it('validates skipped proposals before Review or retrieval', async () => {
		const reviewCalls = vi.fn(async (proposed: readonly WebToolCall[]) => proposed);
		const { coordinator, request, search, reader } = coordinatorWith([
			toolRound([
				searchCall('call-1', 'valid'),
				{ id: 'call-2', name: 'web_search', arguments: 'not-json' },
			]),
		]);

		await expect(coordinator.submit(aiRequest(), options({
			mode: 'review', maxToolCalls: 1, reviewCalls,
		}))).rejects.toThrow('The web tool arguments were not valid JSON.');
		expect(search).not.toHaveBeenCalled();
		expect(reader.extract).not.toHaveBeenCalled();
		expect(reviewCalls).not.toHaveBeenCalled();
		expect(request).toHaveBeenCalledOnce();
	});

	it('propagates retrieval failure without extraction, another model round, or retry', async () => {
		const failure = new Error('Search unavailable');
		const search = vi.fn(async () => { throw failure; });
		const reader = successfulReader();
		const { coordinator, request } = coordinatorWith([
			toolRound([searchCall('call-1', 'failure')]),
			finalRound(),
		], search, undefined, reader);

		await expect(coordinator.submit(aiRequest(), options())).rejects.toBe(failure);
		expect(search).toHaveBeenCalledOnce();
		expect(reader.extract).not.toHaveBeenCalled();
		expect(request).toHaveBeenCalledOnce();
	});

	it('honors cancellation during review before retrieval', async () => {
		const controller = new AbortController();
		const reviewCalls = vi.fn(async () => {
			controller.abort();
			return [] as WebToolCall[];
		});
		const { coordinator, search, reader } = coordinatorWith([
			toolRound([searchCall('call-1', 'cancel')]),
			finalRound(),
		]);

		await expect(coordinator.submit(aiRequest(), options({
			mode: 'review',
			reviewCalls,
			signal: controller.signal,
		}))).rejects.toThrow();
		expect(search).not.toHaveBeenCalled();
		expect(reader.extract).not.toHaveBeenCalled();
	});

	it('declares only closed Search/Fetch tools and preserves search-first guidance', async () => {
		const { coordinator, request } = coordinatorWith([finalRound('No fetch needed')]);

		await coordinator.submit(aiRequest(), options());

		const firstRequest = request.mock.calls[0]?.[0];
		const tools = firstRequest?.tools;
		expect(tools?.map((tool) => tool.function.name)).toEqual(['web_search', 'web_fetch']);
		const parameters = tools?.map((tool) => tool.function.parameters) ?? [];
		expect(parameters.map((value) => Object.keys(value.properties as Record<string, unknown>))).toEqual([
			['query', 'extractionGoal'],
			['url', 'extractionGoal'],
		]);
		expect(parameters.map((value) => value.required)).toEqual([
			['query', 'extractionGoal'],
			['url', 'extractionGoal'],
		]);
		expect(parameters.map((value) => value.additionalProperties)).toEqual([false, false]);
		const fetchTool = tools?.find((tool) => tool.function.name === 'web_fetch');
		expect(fetchTool?.function.description).toContain('Do not fetch merely because a search result exists');
		expect(firstRequest?.systemPrompt).toContain('If a fetch fails, do not claim the page was read');
		expect(firstRequest?.systemPrompt).toContain('truncated: true');
	});

	it('keeps main Web rounds out of JSON mode', async () => {
		const { coordinator, request } = coordinatorWith([
			toolRound([searchCall('call-1', 'json-mode')]),
			finalRound('Answer [S1]'),
		]);

		await coordinator.submit(aiRequest(), options());

		const mainRequests = request.mock.calls
			.map((call) => call[0])
			.filter((roundRequest) => roundRequest.tools?.some((tool) => tool.function.name === 'web_search'));
		expect(mainRequests.length).toBeGreaterThanOrEqual(2);
		for (const mainRequest of mainRequests) {
			expect(mainRequest.responseFormat).toBeUndefined();
		}
	});

	it('keeps a near-cap staged payload within the cap when IDs grow to S100+', async () => {
		const search = vi.fn(async (call: Extract<WebToolCall, { name: 'web_search' }>) => [
			{
				...parsedSearchResult,
				title: `Seed ${call.query} a`,
				url: `https://example.test/${call.query}/a`,
				snippet: '',
				summary: '',
				content: 'body',
			},
			{
				...parsedSearchResult,
				title: `Seed ${call.query} b`,
				url: `https://example.test/${call.query}/b`,
				snippet: '',
				summary: '',
				content: 'body',
			},
		]);
		const reader = {
			extract: vi.fn(async (input: WebExtractionReaderOptions) => readerResult(input, {
				outcome: 'evidence',
				results: input.documents.map((document) => ({
					sourceId: document.sourceId,
					claims: [],
					evidence: [input.target === 'target' ? 'x'.repeat(2000) : 'Title:'],
				})),
			})),
		};
		const seedCalls = Array.from({ length: 50 }, (_value, index) => searchCall(
			`seed-${index}`,
			`seed-${index}`,
		));
		const { coordinator, request } = coordinatorWith([
			toolRound(seedCalls),
			toolRound([searchCall('target', 'target')]),
			finalRound('Answer [S101]'),
		], search, undefined, reader);
		const cap = 1000;

		const result = await coordinator.submit(aiRequest(), options({
			maxToolCalls: 51,
			maxContentCharactersPerCall: cap,
		}));

		expect(result.failedExtractions).toBe(0);
		expect(result.sources.some((source) => source.id === 'S101')).toBe(true);
		const mainRequests = request.mock.calls
			.map((call) => call[0])
			.filter((roundRequest) => roundRequest.tools?.some((tool) => tool.function.name === 'web_search'));
		const targetMessage = mainRequests.at(-1)?.continuation?.find(
			(message) => message.role === 'tool' && message.toolCallId === 'target',
		);
		const payload = targetMessage?.role === 'tool' ? targetMessage.content : '';
		expect(payload.length).toBeLessThanOrEqual(cap);
		expect(payload.length).toBeGreaterThan(cap - 128);
		const parsed = JSON.parse(payload) as {
			results: Array<{ sourceId: string; truncated?: boolean }>;
		};
		expect(parsed.results[0]?.sourceId).toBe('S101');
		expect(parsed.results[0]?.truncated).toBe(true);
	});
});

describe('DeepSeek web follow-up behavior', () => {
	it('marks a lone Fetch extraction failure separately from an unread retrieval failure', async () => {
		const reader = successfulReader();
		reader.extract.mockRejectedValue(new Error('Reader provider unavailable'));
		const { coordinator } = coordinatorWith([
			toolRound([fetchCall('call-fetch', 'https://example.test/extracted')]),
			finalRound('Answer without extracted evidence'),
		], undefined, undefined, reader);

		const result = await coordinator.submit(aiRequest(), options());

		expect(result.failedExtractions).toBe(1);
		expect(result.activities).toEqual([{
			type: 'fetch',
			target: 'https://example.test/extracted',
			status: 'failed',
			failureKind: 'extraction',
		}]);
	});

	it('returns fetch failures as unread outcomes without invoking the reader', async () => {
		const failure = new Error('HTTP 403 from GitHub');
		const fetchPage = vi.fn(async () => { throw failure; });
		const reader = successfulReader();
		const { coordinator, request } = coordinatorWith([
			toolRound([fetchCall('call-fetch', 'https://github.com/example/repo')]),
			finalRound('The GitHub page could not be read.'),
		], vi.fn(async () => [parsedSearchResult]), fetchPage, reader);

		const result = await coordinator.submit(aiRequest(), options());

		expect(result.content).toContain('could not be read');
		expect(result.failedExtractions).toBe(0);
		expect(result.sources).toEqual([]);
		expect(result.activities).toEqual([{
			type: 'fetch',
			target: 'https://github.com/example/repo',
			status: 'failed',
		}]);
		expect(reader.extract).not.toHaveBeenCalled();
		const toolMessage = request.mock.calls[1]?.[0].continuation?.find((message) => message.role === 'tool');
		expect(toolMessage?.role === 'tool' && toolMessage.content).toContain('fetch_failed');
		expect(toolMessage?.role === 'tool' && toolMessage.content).not.toContain('dummy-key');
	});

	it('caps a nonfatal Fetch failure with a long provider error and URL at the 1000-character setting', async () => {
		const longUrl = `https://example.test/${'u'.repeat(1100)}`;
		const failure = new Error(`PRIVATE_PROVIDER_ERROR_${'e'.repeat(2000)}`);
		const fetchPage = vi.fn(async () => { throw failure; });
		const reader = successfulReader();
		const { coordinator, request } = coordinatorWith([
			toolRound([fetchCall('call-fetch', longUrl)]),
			finalRound('The requested page was unread.'),
		], vi.fn(async () => []), fetchPage, reader);

		const result = await coordinator.submit(aiRequest(), options({ maxContentCharactersPerCall: 1000 }));

		expect(result.failedExtractions).toBe(0);
		expect(result.activities).toEqual([{ type: 'fetch', target: longUrl, status: 'failed' }]);
		expect(reader.extract).not.toHaveBeenCalled();
		const toolMessage = request.mock.calls[1]?.[0].continuation?.find((message) => message.role === 'tool');
		const content = toolMessage?.role === 'tool' ? toolMessage.content : '';
		expect(content).toBe('{"error":{"kind":"fetch_failed"}}');
		expect(content.length).toBeLessThanOrEqual(1000);
		expect(content).not.toContain('PRIVATE_PROVIDER_ERROR');
		expect(content).not.toContain(longUrl);
	});

	it.each([400, 401, 402, 413])('keeps fetch account/request HTTP %s fatal', async (status) => {
		const failure = Object.assign(new Error(`HTTP ${status}`), { status });
		const fetchPage = vi.fn(async () => { throw failure; });
		const reader = successfulReader();
		const { coordinator, request } = coordinatorWith([
			toolRound([fetchCall('call-fetch', 'https://example.test/private')]),
			finalRound('Must not be returned'),
		], vi.fn(async () => []), fetchPage, reader);

		await expect(coordinator.submit(aiRequest(), options())).rejects.toBe(failure);
		expect(reader.extract).not.toHaveBeenCalled();
		expect(request).toHaveBeenCalledOnce();
	});

	it('treats an empty fetched page as unread rather than extraction evidence', async () => {
		const fetchPage = vi.fn(async () => ({ title: 'Empty', content: '  ' }));
		const reader = successfulReader();
		const { coordinator } = coordinatorWith([
			toolRound([fetchCall('call-fetch', 'https://example.test/empty')]),
			finalRound('The requested page was unavailable.'),
		], vi.fn(async () => []), fetchPage, reader);

		const result = await coordinator.submit(aiRequest(), options());

		expect(result.failedExtractions).toBe(0);
		expect(result.activities).toEqual([{
			type: 'fetch',
			target: 'https://example.test/empty',
			status: 'failed',
		}]);
		expect(result.sources).toEqual([]);
		expect(reader.extract).not.toHaveBeenCalled();
	});

	it('caps an empty-page Fetch outcome with a long URL at the 1000-character setting', async () => {
		const longUrl = `https://example.test/empty/${'u'.repeat(1100)}`;
		const fetchPage = vi.fn(async () => ({ title: 'Empty', content: '  ' }));
		const reader = successfulReader();
		const { coordinator, request } = coordinatorWith([
			toolRound([fetchCall('call-fetch', longUrl)]),
			finalRound('The empty page was unread.'),
		], vi.fn(async () => []), fetchPage, reader);

		const result = await coordinator.submit(aiRequest(), options({ maxContentCharactersPerCall: 1000 }));

		expect(result.failedExtractions).toBe(0);
		expect(result.activities).toEqual([{ type: 'fetch', target: longUrl, status: 'failed' }]);
		expect(result.sources).toEqual([]);
		expect(reader.extract).not.toHaveBeenCalled();
		const toolMessage = request.mock.calls[1]?.[0].continuation?.find((message) => message.role === 'tool');
		const content = toolMessage?.role === 'tool' ? toolMessage.content : '';
		expect(content).toBe('{"error":{"kind":"fetch_failed"}}');
		expect(content.length).toBeLessThanOrEqual(1000);
		expect(content).not.toContain(longUrl);
	});
});
