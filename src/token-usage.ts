import { formatProviderHistory } from './provider-history';
import type {
	AiProviderRequest,
	ProviderTokenUsage,
	StreamResult,
} from './provider-stream';

export interface TokenUsage extends ProviderTokenUsage {
	source: 'provider' | 'estimated';
}

type RequestText = Pick<
	AiProviderRequest,
	'systemPrompt' | 'userPrompt' | 'history' | 'continuation' | 'tools'
>;

export function resolveTokenUsage(
	request: RequestText,
	result: StreamResult,
): TokenUsage {
	if (result.usage) {
		return { ...result.usage, source: 'provider' };
	}
	return estimateRequestUsage(request, result);
}

export function resolveRoundTokenUsage(
	rounds: Array<{ request: RequestText; result: StreamResult }>,
): TokenUsage {
	if (rounds.every((round) => round.result.usage)) {
		return rounds.reduce<TokenUsage>((total, round) => ({
			promptTokens: total.promptTokens + (round.result.usage?.promptTokens ?? 0),
			completionTokens: total.completionTokens + (round.result.usage?.completionTokens ?? 0),
			totalTokens: total.totalTokens + (round.result.usage?.totalTokens ?? 0),
			source: 'provider',
		}), { promptTokens: 0, completionTokens: 0, totalTokens: 0, source: 'provider' });
	}

	return rounds.reduce<TokenUsage>((total, round) => {
		const usage = estimateRequestUsage(round.request, round.result);
		return {
			promptTokens: total.promptTokens + usage.promptTokens,
			completionTokens: total.completionTokens + usage.completionTokens,
			totalTokens: total.totalTokens + usage.totalTokens,
			source: 'estimated',
		};
	}, { promptTokens: 0, completionTokens: 0, totalTokens: 0, source: 'estimated' });
}

function estimateRequestUsage(request: RequestText, result: StreamResult): TokenUsage {
	const promptTokens = estimateTokens(countRequestCharacters(request));
	const completionTokens = estimateTokens(result.content.length + result.reasoning.length);
	return {
		promptTokens,
		completionTokens,
		totalTokens: promptTokens + completionTokens,
		source: 'estimated',
	};
}

export function formatTokenUsage(usage: TokenUsage) {
	const source = usage.source === 'estimated' ? 'Estimated' : 'Provider';
	return `${source} usage · ${usage.totalTokens} total · ${usage.promptTokens} prompt · ${usage.completionTokens} completion`;
}

function countRequestCharacters(request: RequestText) {
	const historyCharacters = formatProviderHistory(request.history).reduce(
		(sum, message) => sum + message.content.length,
		0,
	);
	const continuationCharacters = (request.continuation ?? []).reduce((sum, message) => {
		if (message.role !== 'assistant' || !('toolCalls' in message)) {
			return sum + message.content.length;
		}
		return sum + message.content.length + message.toolCalls.reduce(
			(callSum, call) => callSum + call.name.length + call.arguments.length,
			0,
		);
	}, 0);
	const toolCharacters = request.tools?.length
		? JSON.stringify(request.tools).length
		: 0;
	return request.systemPrompt.length + request.userPrompt.length +
		historyCharacters + continuationCharacters + toolCharacters;
}

function estimateTokens(characterCount: number) {
	return Math.max(1, Math.ceil(characterCount / 4));
}
