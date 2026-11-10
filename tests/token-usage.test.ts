import { describe, expect, it } from 'vitest';
import type { AiProviderRequest, StreamResult } from '../src/provider-stream';
import { resolveRoundTokenUsage, resolveTokenUsage } from '../src/token-usage';

const request: Pick<
	AiProviderRequest,
	'systemPrompt' | 'userPrompt' | 'history'
> = {
	systemPrompt: '1234',
	userPrompt: '123456',
	history: [
		{ role: 'user', content: '12345', mode: 'ask', origin: 'user' },
		{ role: 'assistant', content: '', mode: 'ask', origin: 'model' },
	],
};

function result(overrides: Partial<StreamResult> = {}): StreamResult {
	return { content: '12345678', reasoning: '12', ...overrides };
}

describe('resolveTokenUsage', () => {
	it('prefers valid provider usage and labels its source', () => {
		expect(resolveTokenUsage(request, result({
			usage: { promptTokens: 12, completionTokens: 5, totalTokens: 17 },
		}))).toEqual({
			promptTokens: 12,
			completionTokens: 5,
			totalTokens: 17,
			source: 'provider',
		});
	});

	it('preserves legitimately reported zero token counts', () => {
		expect(resolveTokenUsage(request, result({
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
		}))).toEqual({
			promptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
			source: 'provider',
		});
	});

	it('estimates annotated history and response characters separately', () => {
		expect(resolveTokenUsage(request, result())).toEqual({
			promptTokens: 47,
			completionTokens: 3,
			totalTokens: 50,
			source: 'estimated',
		});
	});

	it('estimates ordinary continuation content in the prompt', () => {
		expect(resolveTokenUsage(
			{
				systemPrompt: '1234',
				userPrompt: '123456',
				history: [],
				continuation: [
					{ role: 'assistant', content: '12345678' },
					{ role: 'user', content: '1234' },
				],
			},
			result(),
		)).toEqual({
			promptTokens: 6,
			completionTokens: 3,
			totalTokens: 9,
			source: 'estimated',
		});
	});

	it('uses a minimum of one token for each empty estimated side', () => {
		expect(resolveTokenUsage(
			{ systemPrompt: '', userPrompt: '', history: [] },
			result({ content: '', reasoning: '' }),
		)).toEqual({
			promptTokens: 1,
			completionTokens: 1,
			totalTokens: 2,
			source: 'estimated',
		});
	});
});

describe('resolveRoundTokenUsage', () => {
	it('sums provider usage across every main and reader model round', () => {
		expect(resolveRoundTokenUsage([
			{ request, result: result({ usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } }) },
			{ request, result: result({ usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 } }) },
			{ request, result: result({ usage: { promptTokens: 30, completionTokens: 7, totalTokens: 37 } }) },
		])).toEqual({
			promptTokens: 60,
			completionTokens: 14,
			totalTokens: 74,
			source: 'provider',
		});
	});

	it('estimates all main and reader rounds independently when reader usage is missing', () => {
		expect(resolveRoundTokenUsage([
			{ request, result: result({ usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } }) },
			{
				request: {
					...request,
					continuation: [
						{
							role: 'assistant',
							content: '1234',
							toolCalls: [{ id: 'call-1', name: 'web_search', arguments: '{"query":"x"}' }],
						},
						{ role: 'tool', toolCallId: 'call-1', content: '12345678' },
					],
				},
				result: result(),
			},
			{ request, result: result({ usage: { promptTokens: 30, completionTokens: 7, totalTokens: 37 } }) },
		])).toEqual({
			promptTokens: 149,
			completionTokens: 9,
			totalTokens: 158,
			source: 'estimated',
		});
	});
});
