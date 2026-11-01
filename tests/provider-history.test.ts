import { describe, expect, it } from 'vitest';
import { formatProviderHistory } from '../src/provider-history';
import type { ProviderHistoryMessage } from '../src/types';

describe('formatProviderHistory', () => {
	it('returns an empty wire history for empty input', () => {
		expect(formatProviderHistory([])).toEqual([]);
	});

	it('annotates an Ask user message without changing its role or content', () => {
		expect(formatProviderHistory([{
			role: 'user', content: 'hello?', mode: 'ask', origin: 'user',
		}])).toEqual([{
			role: 'user',
			content: '[Historical Ask message. That earlier request was read-only. Origin: user message.]\nhello?',
		}]);
	});

	it('annotates local Edit status as distinct from a model response', () => {
		expect(formatProviderHistory([{
			role: 'assistant', content: 'Edit applied — 1 changes tracked. Review in Track Changes.',
			mode: 'edit', origin: 'local-edit-status',
		}])).toEqual([{
			role: 'assistant',
			content: '[Historical Edit message. Note writing was permitted for that earlier request only. Origin: local Emend Edit status, not a model response.]\nEdit applied — 1 changes tracked. Review in Track Changes.',
		}]);
	});

	it.each([
		{
			mode: 'discuss',
			role: 'assistant',
			origin: 'model',
			content: 'A discussion response.',
			expected: '[Historical Discuss message. That earlier request was read-only. Origin: model response.]\nA discussion response.',
		},
		{
			mode: 'brainstorm',
			role: 'user',
			origin: 'user',
			content: 'First idea\nSecond idea',
			expected: '[Historical Brainstorm message. That earlier request was read-only. Origin: user message.]\nFirst idea\nSecond idea',
		},
	] as const)('annotates a $mode $origin message', ({ mode, role, origin, content, expected }) => {
		expect(formatProviderHistory([{ role, content, mode, origin }])).toEqual([{
			role,
			content: expected,
		}]);
	});

	it('emits only wire role and content fields', () => {
		const messages: ProviderHistoryMessage[] = [
			{ role: 'user', content: 'Question', mode: 'ask', origin: 'user' },
			{ role: 'assistant', content: 'Answer', mode: 'discuss', origin: 'model' },
			{
				role: 'assistant',
				content: 'Edit applied — 1 changes tracked. Review in Track Changes.',
				mode: 'edit',
				origin: 'local-edit-status',
			},
		];

		const wireMessages = formatProviderHistory(messages);

		expect(wireMessages).toHaveLength(3);
		for (const wireMessage of wireMessages) {
			expect(Object.keys(wireMessage).sort()).toEqual(['content', 'role']);
		}
	});

	it('does not mutate the input messages', () => {
		const message: ProviderHistoryMessage = {
			role: 'assistant', content: 'Response', mode: 'brainstorm', origin: 'model',
		};
		const original = { ...message };

		formatProviderHistory([message]);

		expect(message).toEqual(original);
	});
});
