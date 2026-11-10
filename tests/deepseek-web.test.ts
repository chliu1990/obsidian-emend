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
import type {
	WebExtractionReader,
	WebExtractionReaderOptions,
	WebExtractionReaderResult,
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
	readerOptions: WebExtractionReaderOptions,
	outcome: WebExtractionOutcome,
): WebExtractionReaderResult {
	const results = outcome.results.map((result) => {
		const document = readerOptions.documents.find((candidate) => candidate.sourceId === result.sourceId);
		return {
			sourceId: result.sourceId,
			title: document?.title ?? '',
			url: document?.url ?? '',
			extractedFacts: result.extractedFacts,
			evidence: result.evidence,
		};
	});
	const content = JSON.stringify(outcome);
	return {
		outcome,
		payload: JSON.stringify({
			extraction: 'ai-reader',
			outcome: outcome.outcome,
			results,
		}),
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
						extractedFacts: ['Extracted fact'],
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
			maxOutputCharacters: 20000,
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
		const continuation = request.mock.calls[1]?.[0].continuation ?? [];
		const toolMessage = continuation.find((message) => message.role === 'tool');
		const payload = JSON.parse(toolMessage?.role === 'tool' ? toolMessage.content : '{}') as {
			results: Array<{
				sourceId: string;
				title?: string;
				url?: string;
				extractedFacts?: string[];
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
				extractedFacts: ['Extracted fact'],
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
				extractedFacts: ['x'.repeat(300)],
				evidence: ['Title:'],
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
				results: [{ sourceId: 'R1', extractedFacts: ['Usable fact'], evidence: ['Title:'] }],
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
			results: [{ sourceId: 'S1', extractedFacts: ['Usable fact'] }],
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
				{ sourceId: 'R2', extractedFacts: ['Second fact'], evidence: ['Title:'] },
				{ sourceId: 'R1', extractedFacts: ['First fact'], evidence: ['Title:'] },
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
				extractedFacts?: string[];
				evidence?: string[];
			}>;
		};
		expect(payload.results.map((result: { sourceId: string }) => result.sourceId)).toEqual(['S2', 'S1']);
	});

	it('discards staged sources and returns generic output when final mapped evidence exceeds the cap', async () => {
		const reader = successfulReader();
		reader.extract.mockImplementation(async (input) => readerResult(input, {
			outcome: 'evidence',
			results: [{ sourceId: 'R1', extractedFacts: ['x'.repeat(200)], evidence: ['Title:'] }],
		}));
		const { coordinator, request } = coordinatorWith([
			toolRound([searchCall('call-1', 'over-cap')]),
			finalRound('Answer without that evidence'),
		], undefined, undefined, reader);

		const result = await coordinator.submit(aiRequest(), options({ maxContentCharactersPerCall: 100 }));

		expect(result.content).toBe('Answer without that evidence');
		expect(result.failedExtractions).toBe(1);
		expect(result.sources).toEqual([]);
		expect(result.activities).toEqual([{ type: 'search', target: 'over-cap', status: 'failed' }]);
		const toolMessage = request.mock.calls[1]?.[0].continuation?.find((message) => message.role === 'tool');
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
				results: [{ sourceId: 'R1', extractedFacts: ['Fact'], evidence: ['Title:'] }],
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

	it.each(['complete', 'missing'] as const)('retains a completed reader round for %s usage after a later reader provider failure', async (usageCase) => {
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
		expect(result.rounds).toHaveLength(3);
		expect(result.rounds[1]?.request.tools?.map((tool) => tool.function.name)).toEqual([
			'retrieval_grep',
			'retrieval_read',
		]);
		expect(result.reasoning).not.toContain('Private reader reasoning');
		const usage = resolveRoundTokenUsage(result.rounds);
		if (usageCase === 'complete') {
			expect(usage).toEqual({
				promptTokens: 60,
				completionTokens: 14,
				totalTokens: 74,
				source: 'provider',
			});
		} else {
			expect(usage.source).toBe('estimated');
		}
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
				results: [{ sourceId: 'R1', extractedFacts: ['Fact'], evidence: ['Title:'] }],
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

	it('rejects an over-cap batch before executing any call in it', async () => {
		const { coordinator, request, search, reader } = coordinatorWith([
			toolRound([searchCall('call-1', 'first'), searchCall('call-2', 'second')]),
		]);

		await expect(coordinator.submit(aiRequest(), options({ maxToolCalls: 1 }))).rejects.toThrow(
			'web tool call limit',
		);
		expect(search).not.toHaveBeenCalled();
		expect(reader.extract).not.toHaveBeenCalled();
		expect(request).toHaveBeenCalledOnce();
	});

	it('allows exactly 20 proposed calls', async () => {
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
		expect(search).toHaveBeenCalledTimes(20);
		expect(reader.extract).toHaveBeenCalledTimes(20);
		expect(result.activities).toHaveLength(20);
		expect(request).toHaveBeenCalledTimes(2);
	});

	it('rejects the 21st proposed call without executing its final batch', async () => {
		const firstBatch = Array.from({ length: 20 }, (_, index) => searchCall(
			`call-${index + 1}`,
			`query ${index + 1}`,
			`goal ${index + 1}`,
		));
		const { coordinator, request, search, reader } = coordinatorWith([
			toolRound(firstBatch),
			toolRound([searchCall('call-21', 'over limit')]),
			finalRound('Must not be returned'),
		]);

		await expect(coordinator.submit(aiRequest(), options({ maxToolCalls: 20 }))).rejects.toThrow(
			'The model exceeded the 20-call web tool call limit. No calls in the final batch were executed.',
		);
		expect(search).toHaveBeenCalledTimes(20);
		expect(reader.extract).toHaveBeenCalledTimes(20);
		expect(search.mock.calls.map((call) => call[0].query)).not.toContain('over limit');
		expect(request).toHaveBeenCalledTimes(2);
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
