import { describe, expect, it, vi } from 'vitest';
import type { EditPreparation, EditStrategy } from '../src/edit-strategy';
import {
	EditResponseValidationError,
	EditSourceValidationError,
} from '../src/edit-validation';
import { prepareEditResponse } from '../src/edit-response';
import {
	requestAiResponse,
	type AiProviderRequest,
	type StreamResult,
} from '../src/provider-stream';
import type { ProviderConfig } from '../src/types';

const provider: ProviderConfig = {
	name: 'Test provider',
	baseUrl: 'https://provider.example.test/v1',
	apiKey: 'test-api-key',
	model: 'test-model',
	reasoningEffort: 'medium',
	requestUsage: true,
	discoveredModels: [],
};

const prepared: EditPreparation = {
	annotatedMarkdown: 'Original {++replacement++}',
	changeCount: 1,
};

function makeRequest(overrides: Partial<AiProviderRequest> = {}): AiProviderRequest {
	return {
		provider,
		systemPrompt: 'System prompt',
		userPrompt: 'Edit the original snapshot',
		history: [],
		...overrides,
	};
}

function result(content: string, overrides: Partial<StreamResult> = {}): StreamResult {
	return { content, reasoning: '', ...overrides };
}

function prepareOptions(
	requestRound: typeof requestAiResponse,
	prepareEdit: EditStrategy['prepareEdit'],
	overrides: Partial<Parameters<typeof prepareEditResponse>[0]> = {},
): Parameters<typeof prepareEditResponse>[0] {
	return {
		original: 'Original snapshot',
		request: makeRequest(),
		editStrategy: { prepareEdit },
		requestRound,
		signal: new AbortController().signal,
		...overrides,
	};
}

describe('prepareEditResponse', () => {
	it('corrects one invalid response with exact feedback and an unchanged base request', async () => {
		const validationError = new EditResponseValidationError(
			'missing-anchor',
			'The raw diagnostic must not be copied into feedback.',
			{
				operation: 2,
				operationType: 'replace',
				field: 'target',
				matchCount: 0,
				matchLines: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
			},
		);
		const prepareEdit = vi.fn<EditStrategy['prepareEdit']>()
			.mockImplementationOnce(() => { throw validationError; })
			.mockReturnValueOnce(prepared);
		const requestRound = vi.fn<typeof requestAiResponse>()
			.mockResolvedValueOnce(result('not-json'))
			.mockResolvedValueOnce(result('[]'));
		const request = makeRequest({
			history: [
				{ role: 'user', content: 'Earlier request', mode: 'edit', origin: 'user' },
			],
			continuation: [{ role: 'user', content: 'Existing continuation' }],
			tools: [{
				type: 'function',
				function: { name: 'existing_tool', description: 'Existing tool', parameters: {} },
			}],
		});
		const baseRequest = structuredClone(request);
		const onRetry = vi.fn();

		const response = await prepareEditResponse(prepareOptions(
			requestRound,
			prepareEdit,
			{ request, onRetry },
		));

		expect(response.prepared).toBe(prepared);
		expect(requestRound).toHaveBeenCalledTimes(2);
		expect(requestRound.mock.calls[0]?.[0]).toBe(request);
		expect(requestRound.mock.calls[1]?.[0]).toEqual({
			...baseRequest,
			continuation: [
				{ role: 'user', content: 'Existing continuation' },
				{ role: 'assistant', content: 'not-json' },
				{
					role: 'user',
					content: 'Return only a new complete bare JSON array of operations against the unchanged original snapshot.\n{"code":"missing-anchor","operation":2,"operationType":"replace","field":"target","matchCount":0,"matchLines":[1,2,3,4,5,6,7,8]}',
				},
			],
		});
		expect(request).toEqual(baseRequest);
		expect(prepareEdit.mock.calls).toEqual([
			['Original snapshot', 'not-json'],
			['Original snapshot', '[]'],
		]);
		expect(onRetry).toHaveBeenCalledOnce();
		expect(onRetry.mock.invocationCallOrder[0]).toBeGreaterThan(
			prepareEdit.mock.invocationCallOrder[0] ?? -1,
		);
		expect(onRetry.mock.invocationCallOrder[0]).toBeLessThan(
			requestRound.mock.invocationCallOrder[1] ?? 0,
		);
	});

	it('forwards absolute source context to both preparation attempts', async () => {
		const sourceContext = {
			fullText: 'Before `Original snapshot` after',
			from: 8,
			to: 25,
		};
		const validationError = new EditResponseValidationError('inline-code-range', 'Invalid.', {
			operation: 1,
			operationType: 'replace',
			field: 'target',
			line: 1,
		});
		const prepareEdit = vi.fn<EditStrategy['prepareEdit']>()
			.mockImplementationOnce(() => { throw validationError; })
			.mockReturnValueOnce(prepared);
		const requestRound = vi.fn<typeof requestAiResponse>()
			.mockResolvedValueOnce(result('first-invalid'))
			.mockResolvedValueOnce(result('second-valid'));

		await prepareEditResponse(prepareOptions(requestRound, prepareEdit, { sourceContext }));

		expect(prepareEdit.mock.calls).toEqual([
			['Original snapshot', 'first-invalid', sourceContext],
			['Original snapshot', 'second-valid', sourceContext],
		]);
	});

	it('returns a valid no-op preparation after one provider call', async () => {
		const noOp: EditPreparation = {
			annotatedMarkdown: 'Original snapshot',
			changeCount: 0,
		};
		const prepareEdit = vi.fn<EditStrategy['prepareEdit']>().mockReturnValue(noOp);
		const requestRound = vi.fn<typeof requestAiResponse>()
			.mockResolvedValue(result('[]'));
		const onRetry = vi.fn();

		const response = await prepareEditResponse(prepareOptions(
			requestRound,
			prepareEdit,
			{ onRetry },
		));

		expect(response.prepared).toBe(noOp);
		expect(requestRound).toHaveBeenCalledTimes(1);
		expect(prepareEdit).toHaveBeenCalledOnce();
		expect(onRetry).not.toHaveBeenCalled();
	});

	it('surfaces the second validation error without a third provider call', async () => {
		const firstError = new EditResponseValidationError('invalid-json', 'First invalid response.');
		const secondError = new EditResponseValidationError('invalid-json', 'Second invalid response.');
		const prepareEdit = vi.fn<EditStrategy['prepareEdit']>()
			.mockImplementationOnce(() => { throw firstError; })
			.mockImplementationOnce(() => { throw secondError; });
		const requestRound = vi.fn<typeof requestAiResponse>()
			.mockResolvedValueOnce(result('first-invalid'))
			.mockResolvedValueOnce(result('second-invalid'));

		await expect(
			prepareEditResponse(prepareOptions(requestRound, prepareEdit)),
		).rejects.toBe(secondError);
		expect(requestRound).toHaveBeenCalledTimes(2);
		expect(prepareEdit).toHaveBeenCalledTimes(2);
	});

	it('keeps content private and forwards only reasoning from both rounds', async () => {
		const validationError = new EditResponseValidationError('invalid-json', 'Invalid.');
		const prepareEdit = vi.fn<EditStrategy['prepareEdit']>()
			.mockImplementationOnce(() => { throw validationError; })
			.mockReturnValueOnce(prepared);
		const requestRound = vi.fn<typeof requestAiResponse>()
			.mockImplementationOnce(async (_request, callbacks) => {
				callbacks.onEvent({ type: 'content', text: 'private invalid response' });
				callbacks.onEvent({ type: 'reasoning', text: 'First thought. ' });
				return result('private invalid response', { reasoning: 'First thought. ' });
			})
			.mockImplementationOnce(async (_request, callbacks) => {
				callbacks.onEvent({ type: 'content', text: '[]' });
				callbacks.onEvent({ type: 'reasoning', text: 'Second thought.' });
				return result('[]', { reasoning: 'Second thought.' });
			});
		const reasoning: string[] = [];

		await prepareEditResponse(prepareOptions(requestRound, prepareEdit, {
			onReasoning: (text) => reasoning.push(text),
		}));

		expect(reasoning).toEqual(['First thought. ', 'Second thought.']);
	});

	it('sums provider-reported usage from both completed rounds', async () => {
		const validationError = new EditResponseValidationError('invalid-json', 'Invalid.');
		const prepareEdit = vi.fn<EditStrategy['prepareEdit']>()
			.mockImplementationOnce(() => { throw validationError; })
			.mockReturnValueOnce(prepared);
		const requestRound = vi.fn<typeof requestAiResponse>()
			.mockResolvedValueOnce(result('bad', {
				usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
			}))
			.mockResolvedValueOnce(result('[]', {
				usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
			}));

		const response = await prepareEditResponse(prepareOptions(requestRound, prepareEdit));

		expect(response.usage).toEqual({
			promptTokens: 30,
			completionTokens: 7,
			totalTokens: 37,
			source: 'provider',
		});
	});

	it('estimates every round independently when provider usage is mixed', async () => {
		const validationError = new EditResponseValidationError('invalid-json', 'Invalid.');
		const prepareEdit = vi.fn<EditStrategy['prepareEdit']>()
			.mockImplementationOnce(() => { throw validationError; })
			.mockReturnValueOnce(prepared);
		const requestRound = vi.fn<typeof requestAiResponse>()
			.mockResolvedValueOnce(result('bad', {
				usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
			}))
			.mockResolvedValueOnce(result('[]', { reasoning: '1234' }));

		const response = await prepareEditResponse(prepareOptions(
			requestRound,
			prepareEdit,
			{ request: makeRequest({ systemPrompt: '1234', userPrompt: '123456' }) },
		));

		expect(response.usage).toEqual({
			promptTokens: 37,
			completionTokens: 3,
			totalTokens: 40,
			source: 'estimated',
		});
	});

	it.each([
		['source validation', new EditSourceValidationError()],
		['unexpected validation', new Error('Unexpected parser failure')],
	])('does not retry %s errors', async (_label, error) => {
		const prepareEdit = vi.fn<EditStrategy['prepareEdit']>()
			.mockImplementation(() => { throw error; });
		const requestRound = vi.fn<typeof requestAiResponse>()
			.mockResolvedValue(result('[]'));

		await expect(
			prepareEditResponse(prepareOptions(requestRound, prepareEdit)),
		).rejects.toBe(error);
		expect(requestRound).toHaveBeenCalledTimes(1);
		expect(prepareEdit).toHaveBeenCalledOnce();
	});

	it.each([
		['provider', new Error('Provider HTTP 500')],
		['abort', new DOMException('Aborted', 'AbortError')],
	])('does not retry %s request errors', async (_label, error) => {
		const prepareEdit = vi.fn<EditStrategy['prepareEdit']>();
		const requestRound = vi.fn<typeof requestAiResponse>().mockRejectedValue(error);

		await expect(
			prepareEditResponse(prepareOptions(requestRound, prepareEdit)),
		).rejects.toBe(error);
		expect(requestRound).toHaveBeenCalledTimes(1);
		expect(prepareEdit).not.toHaveBeenCalled();
	});

	it('does not classify an EditResponseValidationError rejected by the provider', async () => {
		const error = new EditResponseValidationError('invalid-json', 'Provider boundary failure.');
		const prepareEdit = vi.fn<EditStrategy['prepareEdit']>();
		const requestRound = vi.fn<typeof requestAiResponse>().mockRejectedValue(error);

		await expect(
			prepareEditResponse(prepareOptions(requestRound, prepareEdit)),
		).rejects.toBe(error);
		expect(requestRound).toHaveBeenCalledTimes(1);
		expect(prepareEdit).not.toHaveBeenCalled();
	});

	it('does not classify an EditResponseValidationError thrown by a stream callback', async () => {
		const error = new EditResponseValidationError('invalid-json', 'Callback boundary failure.');
		const prepareEdit = vi.fn<EditStrategy['prepareEdit']>();
		const requestRound = vi.fn<typeof requestAiResponse>()
			.mockImplementation(async (_request, callbacks) => {
				callbacks.onEvent({ type: 'reasoning', text: 'Stop here' });
				return result('[]');
			});

		await expect(prepareEditResponse(prepareOptions(requestRound, prepareEdit, {
			onReasoning: () => { throw error; },
		}))).rejects.toBe(error);
		expect(requestRound).toHaveBeenCalledTimes(1);
		expect(prepareEdit).not.toHaveBeenCalled();
	});

	it('checks abort before the first provider call', async () => {
		const controller = new AbortController();
		controller.abort();
		const prepareEdit = vi.fn<EditStrategy['prepareEdit']>();
		const requestRound = vi.fn<typeof requestAiResponse>();

		await expect(prepareEditResponse(prepareOptions(requestRound, prepareEdit, {
			signal: controller.signal,
		}))).rejects.toMatchObject({ name: 'AbortError' });
		expect(requestRound).not.toHaveBeenCalled();
		expect(prepareEdit).not.toHaveBeenCalled();
	});

	it('checks abort immediately after a stream before validation', async () => {
		const controller = new AbortController();
		const prepareEdit = vi.fn<EditStrategy['prepareEdit']>();
		const requestRound = vi.fn<typeof requestAiResponse>()
			.mockImplementation(async () => {
				controller.abort();
				return result('[]');
			});

		await expect(prepareEditResponse(prepareOptions(requestRound, prepareEdit, {
			signal: controller.signal,
		}))).rejects.toMatchObject({ name: 'AbortError' });
		expect(requestRound).toHaveBeenCalledTimes(1);
		expect(prepareEdit).not.toHaveBeenCalled();
	});

	it('checks abort between rounds and prevents the correction call', async () => {
		const controller = new AbortController();
		const validationError = new EditResponseValidationError('invalid-json', 'Invalid.');
		const prepareEdit = vi.fn<EditStrategy['prepareEdit']>()
			.mockImplementation(() => {
				controller.abort();
				throw validationError;
			});
		const requestRound = vi.fn<typeof requestAiResponse>()
			.mockResolvedValue(result('not-json'));

		await expect(prepareEditResponse(prepareOptions(requestRound, prepareEdit, {
			signal: controller.signal,
		}))).rejects.toMatchObject({ name: 'AbortError' });
		expect(requestRound).toHaveBeenCalledTimes(1);
		expect(prepareEdit).toHaveBeenCalledOnce();
	});
});
