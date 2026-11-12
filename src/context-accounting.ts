import { formatProviderHistory } from './provider-history';
import type {
	ProviderContinuationMessage,
	ProviderToolDefinition,
} from './provider-stream';
import type {
	ProviderConfig,
	ProviderHistoryMessage,
} from './types';

export interface ContextRequestText {
	systemPrompt: string;
	userPrompt: string;
	history: ProviderHistoryMessage[];
	tools?: ProviderToolDefinition[];
	continuation?: ProviderContinuationMessage[];
}

export type ContextCapacityState =
	| { kind: 'unconfigured' }
	| {
		kind: 'valid';
		contextWindowTokens: number;
		outputReserveTokens: number;
		effectiveInputTokens: number;
	}
	| { kind: 'invalid'; reason: string };

export interface RequestCharacterCategories {
	system: number;
	user: number;
	history: number;
	continuation: number;
	tools: number;
	total: number;
	estimatedInputTokens: number;
}

export type ContextCapacityErrorCode =
	| 'invalid-context-capacity'
	| 'context-capacity-exceeded';

export type ContextRequestKind =
	| 'read-only'
	| 'full-note'
	| 'selection'
	| 'transport';

export const INVALID_CONTEXT_CAPACITY_MESSAGE =
	'Context capacity settings are invalid. Requests are blocked until both token values are positive and the window exceeds the reserve.';

const CAPACITY_GUIDANCE: Record<ContextRequestKind, string> = {
	'read-only': 'Reduce context, chat history, additional notes, or Web output.',
	'full-note': 'Use a smaller selection.',
	'selection': 'Select a smaller target.',
	'transport': 'Reduce context, chat history, or Web output.',
};

export class ContextCapacityError extends Error {
	constructor(
		readonly code: ContextCapacityErrorCode,
		message: string,
		readonly details: {
			inputTokens?: number;
			effectiveInputTokens?: number;
			kind?: ContextRequestKind;
		} = {},
	) {
		super(message);
		this.name = 'ContextCapacityError';
	}
}

export function resolveContextCapacity(
	config: Pick<
		ProviderConfig,
		'contextWindowTokens' | 'outputReserveTokens' | 'contextCapacityInvalid'
	>,
): ContextCapacityState {
	const {
		contextWindowTokens,
		outputReserveTokens,
		contextCapacityInvalid,
	} = config;
	if (contextWindowTokens === null && outputReserveTokens === null) {
		return contextCapacityInvalid
			? { kind: 'invalid', reason: INVALID_CONTEXT_CAPACITY_MESSAGE }
			: { kind: 'unconfigured' };
	}
	if (
		contextWindowTokens === null ||
		outputReserveTokens === null ||
		!isPositiveInteger(contextWindowTokens) ||
		!isPositiveInteger(outputReserveTokens)
	) {
		return { kind: 'invalid', reason: INVALID_CONTEXT_CAPACITY_MESSAGE };
	}

	const effectiveInputTokens = contextWindowTokens - outputReserveTokens;
	if (effectiveInputTokens <= 0) {
		return { kind: 'invalid', reason: INVALID_CONTEXT_CAPACITY_MESSAGE };
	}

	return {
		kind: 'valid',
		contextWindowTokens,
		outputReserveTokens,
		effectiveInputTokens,
	};
}

export function requireValidContextCapacity(
	provider: ProviderConfig,
): ContextCapacityState {
	const capacity = resolveContextCapacity(provider);
	if (capacity.kind === 'invalid') {
		throw new ContextCapacityError(
			'invalid-context-capacity',
			INVALID_CONTEXT_CAPACITY_MESSAGE,
		);
	}
	return capacity;
}

export function assertRequestWithinCapacity(
	request: ContextRequestText,
	capacity: ContextCapacityState,
	kind: ContextRequestKind,
): void {
	if (capacity.kind === 'unconfigured') {
		return;
	}
	if (capacity.kind === 'invalid') {
		throw new ContextCapacityError(
			'invalid-context-capacity',
			INVALID_CONTEXT_CAPACITY_MESSAGE,
		);
	}

	const inputTokens = accountRequestCharacters(request).estimatedInputTokens;
	if (inputTokens >= capacity.effectiveInputTokens) {
		throw new ContextCapacityError(
			'context-capacity-exceeded',
			`This request needs about ${inputTokens} input tokens, at or above the ${capacity.effectiveInputTokens}-token input capacity. ${CAPACITY_GUIDANCE[kind]}`,
			{
				inputTokens,
				effectiveInputTokens: capacity.effectiveInputTokens,
				kind,
			},
		);
	}
}

export function estimateTokensForCharacters(characters: number): number {
	return characters === 0 ? 0 : Math.max(1, Math.ceil(characters / 4));
}

export function countRequestCharacters(request: ContextRequestText): number {
	const counts = countCategories(request);
	return counts.system + counts.user + counts.history +
		counts.continuation + counts.tools;
}

export function accountRequestCharacters(
	request: ContextRequestText,
): RequestCharacterCategories {
	const counts = countCategories(request);
	const total = counts.system + counts.user + counts.history +
		counts.continuation + counts.tools;
	return {
		...counts,
		total,
		estimatedInputTokens:
			estimateTokensForCharacters(counts.system) +
			estimateTokensForCharacters(counts.user) +
			estimateTokensForCharacters(counts.history) +
			estimateTokensForCharacters(counts.continuation) +
			estimateTokensForCharacters(counts.tools),
	};
}

function countCategories(request: ContextRequestText) {
	const history = formatProviderHistory(request.history).reduce(
		(sum, message) => sum + message.content.length,
		0,
	);
	const continuation = (request.continuation ?? []).reduce((sum, message) => {
		if (message.role !== 'assistant' || !('toolCalls' in message)) {
			return sum + message.content.length;
		}
		return sum + message.content.length + message.toolCalls.reduce(
			(callSum, call) => callSum + call.name.length + call.arguments.length,
			0,
		);
	}, 0);
	const tools = request.tools?.length ? JSON.stringify(request.tools).length : 0;
	return {
		system: request.systemPrompt.length,
		user: request.userPrompt.length,
		history,
		continuation,
		tools,
	};
}

function isPositiveInteger(value: number): boolean {
	return Number.isInteger(value) && value > 0;
}
