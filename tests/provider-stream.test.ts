import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createSseParser,
	requestAiResponse,
	type AiProviderRequest,
	type StreamEvent,
} from '../src/provider-stream';
import type { ProviderConfig } from '../src/types';

const encoder = new TextEncoder();

function bytes(value: string) {
	return encoder.encode(value);
}

describe('createSseParser', () => {
	it('parses LF and CRLF events and ignores comments', () => {
		const parser = createSseParser();
		const input = [
			': keepalive\n\n',
			'data: {"choices":[{"delta":{"content":"first"}}]}\n\n',
			': keepalive\r\n\r\n',
			'data: {"choices":[{"delta":{"content":"second"}}]}\r\n\r\n',
		].join('');

		expect(parser.push(bytes(input))).toEqual([
			{ type: 'content', text: 'first' },
			{ type: 'content', text: 'second' },
		]);
	});

	it('joins multi-line data fields with newlines', () => {
		const parser = createSseParser();
		const events = parser.push(
			bytes(
				'data: {"choices":[{"delta":\n' +
					'data: {"content":"line one\\nline two"}}]}\n\n',
			),
		);

		expect(events).toEqual([
			{ type: 'content', text: 'line one\nline two' },
		]);
	});

	it('buffers JSON split across chunks', () => {
		const parser = createSseParser();

		expect(
			parser.push(bytes('data: {"choices":[{"delta":{"con')),
		).toEqual([]);
		expect(parser.push(bytes('tent":"complete"}}]}\n\n'))).toEqual([
			{ type: 'content', text: 'complete' },
		]);
	});

	it('decodes UTF-8 characters split across chunks', () => {
		const parser = createSseParser();
		const input = bytes(
			'data: {"choices":[{"delta":{"content":"你好 👋"}}]}\n\n',
		);
		const split = input.findIndex((byte) => byte === 0xbd) + 1;

		expect(parser.push(input.slice(0, split))).toEqual([]);
		expect(parser.push(input.slice(split))).toEqual([
			{ type: 'content', text: '你好 👋' },
		]);
	});

	it('emits content and reasoning deltas separately', () => {
		const parser = createSseParser();
		const events = parser.push(
			bytes(
				'data: {"choices":[{"delta":{"content":"answer","reasoning_content":"thinking"}}]}\n\n',
			),
		);

		expect(events).toEqual([
			{ type: 'content', text: 'answer' },
			{ type: 'reasoning', text: 'thinking' },
		]);
	});

	it('emits final token usage', () => {
		const parser = createSseParser();
		const events = parser.push(
			bytes(
				'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17}}\n\n',
			),
		);

		expect(events).toEqual([
			{
				type: 'usage',
				usage: {
					promptTokens: 12,
					completionTokens: 5,
					totalTokens: 17,
				},
			},
		]);
	});

	it.each([
		['absent', undefined],
		['partial', { prompt_tokens: 12, completion_tokens: 5 }],
		['non-numeric', { prompt_tokens: '12', completion_tokens: 5, total_tokens: 17 }],
		['negative', { prompt_tokens: -1, completion_tokens: 5, total_tokens: 4 }],
		['fractional', { prompt_tokens: 12.5, completion_tokens: 5, total_tokens: 17.5 }],
	])('ignores %s usage', (_label, usage) => {
		const parser = createSseParser();
		const payload = JSON.stringify({ choices: [], usage });

		expect(parser.push(bytes(`data: ${payload}\n\n`))).toEqual([]);
	});

	it('preserves zero token counts reported by the provider', () => {
		const parser = createSseParser();
		const events = parser.push(
			bytes(
				'data: {"choices":[],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}\n\n',
			),
		);

		expect(events).toEqual([
			{
				type: 'usage',
				usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
			},
		]);
	});

	it('emits done once for the done sentinel', () => {
		const parser = createSseParser();

		expect(parser.push(bytes('data: [DONE]\n\n'))).toEqual([{ type: 'done' }]);
		expect(parser.push(bytes('data: [DONE]\n\n'))).toEqual([]);
		expect(parser.finish()).toEqual([]);
	});

	it('flushes a final event without a trailing blank line', () => {
		const parser = createSseParser();
		parser.push(bytes('data: {"choices":[{"delta":{"content":"last"}}]}'));

		expect(parser.finish()).toEqual([{ type: 'content', text: 'last' }]);
	});

	it('ignores chunks without content, reasoning, usage, or a done sentinel', () => {
		const parser = createSseParser();

		expect(
			parser.push(bytes('data: {"choices":[{"delta":{}}]}\n\n')),
		).toEqual([]);
	});

	it('rejects malformed JSON without echoing the payload', () => {
		const parser = createSseParser();

		expect(() => parser.push(bytes('data: {not-json}\n\n'))).toThrow(
			'malformed streaming data',
		);
	});

	it('surfaces provider error events', () => {
		const parser = createSseParser();

		expect(() =>
			parser.push(
				bytes(
					'data: {"error":{"message":"Rate limited","type":"rate_limit","code":"slow_down"}}\n\n',
				),
			),
		).toThrow('Rate limited');
	});
});

const provider: ProviderConfig = {
	name: 'Test provider',
	baseUrl: 'https://provider.example.test/v1///',
	apiKey: 'test-api-key',
	model: 'test-model',
	reasoningEffort: 'medium',
	requestUsage: true,
};

function makeRequest(overrides: Partial<AiProviderRequest> = {}): AiProviderRequest {
	return {
		provider,
		systemPrompt: 'System prompt',
		userPrompt: 'Current prompt',
		history: [],
		...overrides,
	};
}

function mockStream(chunks: string[]) {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(bytes(chunk));
			}
			controller.close();
		},
	});
	const fetchMock = vi.fn().mockResolvedValue(new Response(stream));
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

async function getError(promise: Promise<unknown>) {
	try {
		await promise;
		throw new Error('Expected the request to reject.');
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error));
	}
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('requestAiResponse', () => {
	it('constructs the OpenAI-compatible request and trims history to eight messages', async () => {
		const fetchMock = mockStream([
			'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
			'data: [DONE]\n\n',
		]);
		const history = Array.from({ length: 10 }, (_, index) => ({
			role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
			content: `message ${index}`,
		}));
		const controller = new AbortController();

		await requestAiResponse(
			makeRequest({ history }),
			{ onEvent: vi.fn() },
			controller.signal,
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://provider.example.test/v1/chat/completions');
		expect(init.method).toBe('POST');
		expect(init.signal).toBe(controller.signal);
		expect(init.headers).toEqual({
			Authorization: 'Bearer test-api-key',
			'Content-Type': 'application/json',
		});
		const body = JSON.parse(init.body as string) as {
			model: string;
			messages: Array<{ role: string; content: string }>;
			temperature: number;
			reasoning_effort: string;
			stream: boolean;
		};
		expect(body).toEqual({
			model: 'test-model',
			messages: [
				{ role: 'system', content: 'System prompt' },
				...history.slice(-8),
				{ role: 'user', content: 'Current prompt' },
			],
			temperature: 0.3,
			reasoning_effort: 'medium',
			stream: true,
			stream_options: { include_usage: true },
		});
	});

	it('omits stream_options when provider usage requests are disabled', async () => {
		const fetchMock = mockStream([
			'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
			'data: [DONE]\n\n',
		]);

		await requestAiResponse(
			makeRequest({ provider: { ...provider, requestUsage: false } }),
			{ onEvent: vi.fn() },
			new AbortController().signal,
		);

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string) as Record<string, unknown>;
		expect(body.stream).toBe(true);
		expect(body).not.toHaveProperty('stream_options');
	});

	it('emits stream events and returns accumulated text, reasoning, and usage', async () => {
		mockStream([
			'data: {"choices":[{"delta":{"content":"Hello","reasoning_content":"Think"}}]}\n\n',
			'data: {"choices":[{"delta":{"content":" world","reasoning_content":"ing"}}]}\n\n',
			'data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\n\n',
			'data: [DONE]\n\n',
		]);
		const events: StreamEvent[] = [];

		const result = await requestAiResponse(
			makeRequest(),
			{ onEvent: (event) => events.push(event) },
			new AbortController().signal,
		);

		expect(result).toEqual({
			content: 'Hello world',
			reasoning: 'Thinking',
			usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 },
		});
		expect(events).toEqual([
			{ type: 'content', text: 'Hello' },
			{ type: 'reasoning', text: 'Think' },
			{ type: 'content', text: ' world' },
			{ type: 'reasoning', text: 'ing' },
			{
				type: 'usage',
				usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 },
			},
			{ type: 'done' },
		]);
	});

	it('propagates abort errors without retrying', async () => {
		const abortError = new DOMException('Aborted', 'AbortError');
		const fetchMock = vi.fn().mockRejectedValue(abortError);
		vi.stubGlobal('fetch', fetchMock);
		const controller = new AbortController();
		controller.abort();

		await expect(
			requestAiResponse(
				makeRequest(),
				{ onEvent: vi.fn() },
				controller.signal,
			),
		).rejects.toBe(abortError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('reports HTTP provider details without exposing credentials', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					error: {
						message: 'Rate limited for test-api-key',
						type: 'rate_limit',
					},
				}),
				{ status: 429 },
			),
		);
		vi.stubGlobal('fetch', fetchMock);

		const error = await getError(
			requestAiResponse(
				makeRequest(),
				{ onEvent: vi.fn() },
				new AbortController().signal,
			),
		);
		expect(error.message).toContain('HTTP 429');
		expect(error.message).toContain('Rate limited for [redacted]');
		expect(error.message).toContain('type=rate_limit');
		expect(error.message).not.toContain(provider.apiKey);
		expect(error.message).not.toContain('Authorization');
		expect(error.message).not.toContain('Bearer');
	});

	it('surfaces usage-option rejection without an automatic retry', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					error: { message: 'stream_options.include_usage is unsupported' },
				}),
				{ status: 400 },
			),
		);
		vi.stubGlobal('fetch', fetchMock);

		const error = await getError(
			requestAiResponse(
				makeRequest(),
				{ onEvent: vi.fn() },
				new AbortController().signal,
			),
		);

		expect(error.message).toContain('HTTP 400');
		expect(error.message).toContain('stream_options.include_usage is unsupported');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('reports network errors without exposing credentials', async () => {
		const fetchMock = vi.fn().mockRejectedValue(
			new Error('network failed for Authorization: Bearer test-api-key'),
		);
		vi.stubGlobal('fetch', fetchMock);

		const error = await getError(
			requestAiResponse(
				makeRequest(),
				{ onEvent: vi.fn() },
				new AbortController().signal,
			),
		);
		expect(error.message).toContain('network failed');
		expect(error.message).not.toContain(provider.apiKey);
		expect(error.message).not.toContain('Authorization');
		expect(error.message).not.toContain('Bearer');
	});

	it('rejects an empty stream as missing content', async () => {
		mockStream([]);

		await expect(
			requestAiResponse(
				makeRequest(),
				{ onEvent: vi.fn() },
				new AbortController().signal,
			),
		).rejects.toThrow('No text was found in the provider response.');
	});

	it('rejects a stream with no content or reasoning', async () => {
		mockStream([
			'data: {"choices":[{"delta":{}}]}\n\n',
			'data: [DONE]\n\n',
		]);

		await expect(
			requestAiResponse(
				makeRequest(),
				{ onEvent: vi.fn() },
				new AbortController().signal,
			),
		).rejects.toThrow('No text was found in the provider response.');
	});

	it.each([
		['missing', ''],
		['invalid', 'not a URL'],
		['non-HTTP', 'ftp://provider.example.test/v1'],
	])('rejects a %s base URL before fetching', async (_label, baseUrl) => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			requestAiResponse(
				makeRequest({ provider: { ...provider, baseUrl } }),
				{ onEvent: vi.fn() },
				new AbortController().signal,
			),
		).rejects.toThrow(/base URL/i);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each([
		['API key', { apiKey: ' ' }],
		['model', { model: ' ' }],
	])('requires a provider %s', async (_label, override) => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			requestAiResponse(
				makeRequest({ provider: { ...provider, ...override } }),
				{ onEvent: vi.fn() },
				new AbortController().signal,
			),
		).rejects.toThrow(new RegExp(_label, 'i'));
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
