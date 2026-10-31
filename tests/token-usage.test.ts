import { describe, expect, it } from 'vitest';
import type { AiProviderRequest, StreamResult } from '../src/provider-stream';
import { resolveTokenUsage } from '../src/token-usage';

const request: Pick<
	AiProviderRequest,
	'systemPrompt' | 'userPrompt' | 'history'
> = {
	systemPrompt: '1234',
	userPrompt: '123456',
	history: [
		{ role: 'user', content: '12345' },
		{ role: 'assistant', content: '' },
	],
};

function result(overrides: Partial<StreamResult> = {}): StreamResult {
	return {
		content: '12345678',
		reasoning: '12',
		...overrides,
	};
}

describe('resolveTokenUsage', () => {
	it('prefers valid provider usage and labels its source', () => {
		expect(
			resolveTokenUsage(
				request,
				result({
					usage: {
						promptTokens: 12,
						completionTokens: 5,
						totalTokens: 17,
					},
				}),
			),
		).toEqual({
			promptTokens: 12,
			completionTokens: 5,
			totalTokens: 17,
			source: 'provider',
		});
	});

	it('preserves legitimately reported zero token counts', () => {
		expect(
			resolveTokenUsage(
				request,
				result({
					usage: {
						promptTokens: 0,
						completionTokens: 0,
						totalTokens: 0,
					},
				}),
			),
		).toEqual({
			promptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
			source: 'provider',
		});
	});

	it('estimates request and response characters separately, including history and reasoning', () => {
		expect(resolveTokenUsage(request, result())).toEqual({
			promptTokens: 4,
			completionTokens: 3,
			totalTokens: 7,
			source: 'estimated',
		});
	});

	it('uses a minimum of one token for each empty estimated side', () => {
		expect(
			resolveTokenUsage(
				{ systemPrompt: '', userPrompt: '', history: [] },
				result({ content: '', reasoning: '' }),
			),
		).toEqual({
			promptTokens: 1,
			completionTokens: 1,
			totalTokens: 2,
			source: 'estimated',
		});
	});
});
