import { describe, expect, it } from 'vitest';
import {
	ContextCapacityError,
	INVALID_CONTEXT_CAPACITY_MESSAGE,
	accountRequestCharacters,
	assertRequestWithinCapacity,
	countRequestCharacters,
	estimateTokensForCharacters,
	requireValidContextCapacity,
	resolveContextCapacity,
	type ContextCapacityState,
	type ContextRequestText,
	type ContextRequestKind,
} from '../src/context-accounting';
import { formatProviderHistory } from '../src/provider-history';
import type {
	ProviderConfig,
	ProviderHistoryMessage,
} from '../src/types';
import type {
	ProviderContinuationMessage,
	ProviderToolDefinition,
} from '../src/provider-stream';

type CapacityFields = Pick<
	ProviderConfig,
	'contextWindowTokens' | 'outputReserveTokens' | 'contextCapacityInvalid'
>;

function capacityFields(overrides: Partial<CapacityFields> = {}): CapacityFields {
	return {
		contextWindowTokens: null,
		outputReserveTokens: null,
		contextCapacityInvalid: false,
		...overrides,
	};
}

function providerWith(fields: CapacityFields): ProviderConfig {
	return {
		name: 'Local test provider',
		baseUrl: 'http://127.0.0.1:8787/v1',
		apiKey: 'dummy-test-key',
		model: 'dummy-model',
		reasoningEffort: 'low',
		requestUsage: false,
		discoveredModels: [],
		...fields,
	};
}

function makeRequest(
	overrides: Partial<ContextRequestText> = {},
): ContextRequestText {
	return {
		systemPrompt: '',
		userPrompt: '',
		history: [],
		...overrides,
	};
}

const tools: ProviderToolDefinition[] = [{
	type: 'function',
	function: {
		name: 'web_search',
		description: 'Search the web.',
		parameters: { type: 'object' },
	},
}];

const continuation: ProviderContinuationMessage[] = [
	{
		role: 'assistant',
		content: 'call:',
		toolCalls: [{
			id: 'call-1',
			name: 'web_search',
			arguments: '{"query":"alpha"}',
		}],
	},
	{ role: 'tool', toolCallId: 'call-1', content: 'result text' },
];

describe('resolveContextCapacity', () => {
	it('treats both cleared values without a marker as unconfigured', () => {
		expect(resolveContextCapacity(capacityFields())).toEqual({
			kind: 'unconfigured',
		});
	});

	it('accepts a valid pair with the exact effective input budget', () => {
		expect(resolveContextCapacity(capacityFields({
			contextWindowTokens: 128000,
			outputReserveTokens: 8000,
		}))).toEqual({
			kind: 'valid',
			contextWindowTokens: 128000,
			outputReserveTokens: 8000,
			effectiveInputTokens: 120000,
		});
	});

	it.each([
		['missing reserve', capacityFields({ contextWindowTokens: 128000 })],
		['missing window', capacityFields({ outputReserveTokens: 8000 })],
	])('rejects %s', (_label, fields) => {
		expect(resolveContextCapacity(fields)).toMatchObject({ kind: 'invalid' });
	});

	it.each([
		['decimal window', capacityFields({ contextWindowTokens: 128000.5, outputReserveTokens: 8000 })],
		['decimal reserve', capacityFields({ contextWindowTokens: 128000, outputReserveTokens: 8000.5 })],
		['zero window', capacityFields({ contextWindowTokens: 0, outputReserveTokens: 8000 })],
		['negative reserve', capacityFields({ contextWindowTokens: 128000, outputReserveTokens: -1 })],
	])('rejects non-positive integers: %s', (_label, fields) => {
		expect(resolveContextCapacity(fields)).toMatchObject({ kind: 'invalid' });
	});

	it.each([
		['equal', 8000, 8000],
		['reserve above window', 4000, 8000],
	] as const)('rejects a nonpositive effective budget when the reserve is %s', (
		_label,
		window,
		reserve,
	) => {
		expect(resolveContextCapacity(capacityFields({
			contextWindowTokens: window,
			outputReserveTokens: reserve,
		}))).toMatchObject({ kind: 'invalid' });
	});

	it('keeps a persisted marker with both cleared values invalid', () => {
		expect(resolveContextCapacity(capacityFields({
			contextCapacityInvalid: true,
		}))).toMatchObject({ kind: 'invalid' });
	});

	it('fixes a persisted marker once a valid pair is present', () => {
		expect(resolveContextCapacity(capacityFields({
			contextWindowTokens: 32000,
			outputReserveTokens: 4000,
			contextCapacityInvalid: true,
		}))).toEqual({
			kind: 'valid',
			contextWindowTokens: 32000,
			outputReserveTokens: 4000,
			effectiveInputTokens: 28000,
		});
	});

	it('explains the requirement without provider content', () => {
		const state = resolveContextCapacity(capacityFields({
			contextWindowTokens: 8000,
			outputReserveTokens: 8000,
		}));
		expect(state).toMatchObject({ kind: 'invalid' });
		if (state.kind !== 'invalid') {
			throw new Error('Expected an invalid state.');
		}
		expect(state.reason).toBe(INVALID_CONTEXT_CAPACITY_MESSAGE);
		expect(state.reason).toContain('both token values are positive');
		expect(state.reason).toContain('window exceeds the reserve');
	});
});

describe('request character accounting', () => {
	it('reports zero for every category of an empty request', () => {
		expect(accountRequestCharacters(makeRequest())).toEqual({
			system: 0,
			user: 0,
			history: 0,
			continuation: 0,
			tools: 0,
			total: 0,
			estimatedInputTokens: 0,
		});
		expect(countRequestCharacters(makeRequest())).toBe(0);
	});

	it('counts and reconciles every category independently', () => {
		const history: ProviderHistoryMessage[] = [
			{ role: 'user', content: 'history text', mode: 'ask', origin: 'user' },
		];
		const request = makeRequest({
			systemPrompt: 'system text',
			userPrompt: 'user text',
			history,
			continuation,
			tools,
		});

		const categories = accountRequestCharacters(request);

		const expectedSystem = 'system text'.length;
		const expectedUser = 'user text'.length;
		const expectedHistory = formatProviderHistory(history).reduce(
			(sum, message) => sum + message.content.length,
			0,
		);
		const expectedContinuation = 'call:'.length +
			'web_search'.length +
			'{"query":"alpha"}'.length +
			'result text'.length;
		const expectedTools = JSON.stringify(tools).length;
		const expectedTotal = expectedSystem +
			expectedUser +
			expectedHistory +
			expectedContinuation +
			expectedTools;
		const expectedTokens = [
			expectedSystem,
			expectedUser,
			expectedHistory,
			expectedContinuation,
			expectedTools,
		].reduce(
			(sum, characters) => sum + Math.max(1, Math.ceil(characters / 4)),
			0,
		);
		expect(categories).toMatchObject({
			system: expectedSystem,
			user: expectedUser,
			history: expectedHistory,
			continuation: expectedContinuation,
			tools: expectedTools,
		});
		expect(categories.total).toBe(expectedTotal);
		expect(categories.estimatedInputTokens).toBe(expectedTokens);
		expect(countRequestCharacters(request)).toBe(expectedTotal);
	});

	it('counts annotated history exactly as the provider history formatter emits it', () => {
		const history: ProviderHistoryMessage[] = [
			{ role: 'user', content: 'hi', mode: 'ask', origin: 'user' },
			{ role: 'assistant', content: '', mode: 'edit', origin: 'local-edit-status' },
		];

		const categories = accountRequestCharacters(makeRequest({ history }));

		const formatted = formatProviderHistory(history);
		expect(categories.history).toBe(
			formatted.reduce((sum, message) => sum + message.content.length, 0),
		);
		expect(categories.history).toBeGreaterThan('hi'.length);
		expect(formatted[0]?.content).toContain('Origin: user message.');
		expect(formatted[1]?.content).toContain('local Emend Edit result');
	});

	it('counts continuation tool-call names and arguments', () => {
		const withToolCalls = accountRequestCharacters(makeRequest({ continuation }));

		expect(withToolCalls.continuation).toBe(
			'call:'.length +
				'web_search'.length +
				'{"query":"alpha"}'.length +
				'result text'.length,
		);
		expect(withToolCalls.continuation).toBeGreaterThan(
			'call:'.length + 'result text'.length,
		);
	});

	it('counts text that appears in several categories at each occurrence', () => {
		const duplicated = 'Repeated text';
		const request = makeRequest({
			systemPrompt: duplicated,
			userPrompt: duplicated,
			history: [{
				role: 'user',
				content: duplicated,
				mode: 'ask',
				origin: 'user',
			}],
		});

		const categories = accountRequestCharacters(request);

		expect(categories.system).toBe(duplicated.length);
		expect(categories.user).toBe(duplicated.length);
		expect(categories.history).toBeGreaterThan(duplicated.length);
		expect(categories.total).toBe(
			categories.system + categories.user + categories.history,
		);
		expect(categories.total).toBeGreaterThan(duplicated.length * 3 - 1);
	});

	it('uses UTF-16 string length for Unicode text', () => {
		const text = 'αβ😀';
		expect(text.length).toBe(4);

		const categories = accountRequestCharacters(makeRequest({
			systemPrompt: text,
		}));

		expect(categories.system).toBe(4);
		expect(categories.estimatedInputTokens).toBe(1);
	});

	it.each([
		[0, 0],
		[1, 1],
		[3, 1],
		[4, 1],
		[5, 2],
		[8, 2],
		[9, 3],
		[100, 25],
	])('estimates %i characters as %i tokens', (characters, tokens) => {
		expect(estimateTokensForCharacters(characters)).toBe(tokens);
	});
});

function captureError(action: () => void): unknown {
	try {
		action();
	} catch (error) {
		return error;
	}
	throw new Error('Expected the action to throw.');
}

describe('assertRequestWithinCapacity', () => {
	const validCapacity: ContextCapacityState = {
		kind: 'valid',
		contextWindowTokens: 1000,
		outputReserveTokens: 990,
		effectiveInputTokens: 10,
	};

	it('passes an unconfigured capacity', () => {
		expect(() => assertRequestWithinCapacity(
			makeRequest({ systemPrompt: 'x'.repeat(10000) }),
			{ kind: 'unconfigured' },
			'read-only',
		)).not.toThrow();
	});

	it('throws the typed invalid-configuration error', () => {
		const error = captureError(() => assertRequestWithinCapacity(
			makeRequest(),
			{ kind: 'invalid', reason: 'invalid settings' },
			'transport',
		));

		expect(error).toBeInstanceOf(ContextCapacityError);
		expect(error).toMatchObject({ code: 'invalid-context-capacity' });
	});

	it('passes one token below capacity', () => {
		// 36 characters estimate to 9 tokens, one below the 10-token budget.
		expect(() => assertRequestWithinCapacity(
			makeRequest({ systemPrompt: 'x'.repeat(36) }),
			validCapacity,
			'read-only',
		)).not.toThrow();
	});

	it.each([
		['equal', 40],
		['above', 400],
	] as const)('rejects an estimate %s to the effective budget with exact details', (
		_label,
		characters,
	) => {
		const error = captureError(() => assertRequestWithinCapacity(
			makeRequest({ systemPrompt: 'x'.repeat(characters) }),
			validCapacity,
			'full-note',
		));

		expect(error).toBeInstanceOf(ContextCapacityError);
		expect(error).toMatchObject({
			code: 'context-capacity-exceeded',
			details: {
				inputTokens: Math.ceil(characters / 4),
				effectiveInputTokens: 10,
				kind: 'full-note',
			},
		});
	});

	it.each<[ContextRequestKind, string]>([
		['read-only', 'Reduce context, chat history, additional notes, or Web output.'],
		['full-note', 'Use a smaller selection.'],
		['selection', 'Select a smaller target.'],
		['transport', 'Reduce context, chat history, or Web output.'],
	])('adds %s guidance without note content', (kind, guidance) => {
		const secret = 'PRIVATE NOTE BODY AND HISTORY';
		const error = captureError(() => assertRequestWithinCapacity(
			makeRequest({ systemPrompt: secret.repeat(20) }),
			validCapacity,
			kind,
		));

		expect(error).toBeInstanceOf(ContextCapacityError);
		const message = (error as Error).message;
		expect(message).toContain(guidance);
		expect(message).toContain('10-token input capacity');
		expect(message).not.toContain(secret);
		expect(message).not.toContain('PRIVATE');
	});
});

describe('requireValidContextCapacity', () => {
	it('returns the unconfigured state unchanged', () => {
		expect(requireValidContextCapacity(providerWith(capacityFields()))).toEqual({
			kind: 'unconfigured',
		});
	});

	it('returns the valid state unchanged', () => {
		expect(requireValidContextCapacity(providerWith(capacityFields({
			contextWindowTokens: 128000,
			outputReserveTokens: 8000,
		})))).toEqual({
			kind: 'valid',
			contextWindowTokens: 128000,
			outputReserveTokens: 8000,
			effectiveInputTokens: 120000,
		});
	});

	it('throws the typed invalid-configuration error before returning', () => {
		const error = captureError(() => requireValidContextCapacity(providerWith(
			capacityFields({
				contextWindowTokens: 8000,
				outputReserveTokens: 8000,
			}),
		)));

		expect(error).toBeInstanceOf(ContextCapacityError);
		expect(error).toMatchObject({ code: 'invalid-context-capacity' });
		expect((error as Error).message).not.toContain('dummy-test-key');
	});
});
