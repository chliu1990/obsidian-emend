import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	requestAiChatResponse,
	requestAiSuggestion,
	type AiSuggestionContext,
} from '../src/providers';
import { DEFAULT_SETTINGS } from '../src/settings';
import type { EmendSettings } from '../src/types';

const encoder = new TextEncoder();

function makeSettings(): EmendSettings {
	return {
		...DEFAULT_SETTINGS,
		activeProvider: 'custom',
		providers: {
			...DEFAULT_SETTINGS.providers,
			custom: {
				name: 'Custom',
				baseUrl: 'https://custom.example.test/v1',
				apiKey: 'adapter-test-key',
				model: 'adapter-test-model',
				reasoningEffort: 'low',
			},
		},
	};
}

function makeContext(): AiSuggestionContext {
	return {
		markdown: '# Note\nOriginal text',
		notePath: 'folder/note.md',
		userMessage: 'Improve this note',
	};
}

function contentEvent(content: string) {
	return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

function mockContentStream(content: string) {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode(contentEvent(content)));
			controller.enqueue(encoder.encode('data: [DONE]\n\n'));
			controller.close();
		},
	});
	const fetchMock = vi.fn().mockResolvedValue(new Response(stream));
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('legacy streaming adapters', () => {
	it('accumulates and parses a chat answer', async () => {
		const fetchMock = mockContentStream(
			JSON.stringify({ type: 'answer', message: '  Chat answer  ' }),
		);

		const response = await requestAiChatResponse(
			makeSettings(),
			makeContext(),
			[{ role: 'user', content: 'Earlier question' }],
		);

		expect(response).toEqual({ type: 'answer', message: 'Chat answer' });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(init.signal).toBeInstanceOf(AbortSignal);
		const body = JSON.parse(init.body as string) as {
			stream: boolean;
			messages: Array<{ role: string; content: string }>;
		};
		expect(body.stream).toBe(true);
		expect(body.messages[0]?.content).toContain('Classify the user message');
		expect(body.messages.at(-1)?.content).toContain('folder/note.md');
		expect(body.messages.at(-1)?.content).toContain('# Note\nOriginal text');
		expect(body.messages.at(-1)?.content).toContain('Improve this note');
	});

	it('retains the fenced JSON edit protocol', async () => {
		mockContentStream(
			`\`\`\`json\n${JSON.stringify({
				type: 'edit',
				updatedMarkdown: '# Note\nUpdated text',
				summary: '  Updated the text  ',
			})}\n\`\`\``,
		);

		const response = await requestAiChatResponse(makeSettings(), makeContext());

		expect(response).toEqual({
			type: 'edit',
			updatedMarkdown: '# Note\nUpdated text',
			summary: 'Updated the text',
		});
	});

	it('rejects invalid legacy chat responses', async () => {
		mockContentStream('not JSON');

		await expect(
			requestAiChatResponse(makeSettings(), makeContext()),
		).rejects.toThrow();
	});

	it('returns accumulated Markdown for inline suggestions', async () => {
		const fetchMock = mockContentStream('# Note\nSuggested text');

		const response = await requestAiSuggestion(makeSettings(), makeContext());

		expect(response).toBe('# Note\nSuggested text');
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string) as {
			messages: Array<{ role: string; content: string }>;
		};
		expect(body.messages[0]?.content).toContain(
			'Return only the Markdown text',
		);
	});

	it('does not retry a failed adapter request', async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error('Offline'));
		vi.stubGlobal('fetch', fetchMock);

		await expect(
			requestAiSuggestion(makeSettings(), makeContext()),
		).rejects.toThrow('Offline');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
