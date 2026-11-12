import {
	countRequestCharacters,
	estimateTokensForCharacters,
} from './context-accounting';
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
	const promptTokens = Math.max(
		1,
		estimateTokensForCharacters(countRequestCharacters(request)),
	);
	const completionTokens = Math.max(
		1,
		estimateTokensForCharacters(result.content.length + result.reasoning.length),
	);
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
