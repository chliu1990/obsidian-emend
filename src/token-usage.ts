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
	'systemPrompt' | 'userPrompt' | 'history'
>;

export function resolveTokenUsage(
	request: RequestText,
	result: StreamResult,
): TokenUsage {
	if (result.usage) {
		return { ...result.usage, source: 'provider' };
	}

	const promptCharacters =
		request.systemPrompt.length +
		request.userPrompt.length +
		request.history.reduce((sum, message) => sum + message.content.length, 0);
	const completionCharacters = result.content.length + result.reasoning.length;
	const promptTokens = estimateTokens(promptCharacters);
	const completionTokens = estimateTokens(completionCharacters);
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

function estimateTokens(characterCount: number) {
	return Math.max(1, Math.ceil(characterCount / 4));
}
