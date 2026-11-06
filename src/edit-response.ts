import type { EditPreparation, EditStrategy } from './edit-strategy';
import {
	EditResponseValidationError,
	formatEditValidationFeedback,
} from './edit-validation';
import type { AiProviderRequest, requestAiResponse } from './provider-stream';
import { resolveRoundTokenUsage, type TokenUsage } from './token-usage';

export async function prepareEditResponse(options: {
	original: string;
	request: AiProviderRequest;
	editStrategy: Pick<EditStrategy, 'prepareEdit'>;
	requestRound: typeof requestAiResponse;
	signal: AbortSignal;
	onReasoning?: (text: string) => void;
	onRetry?: () => void;
}): Promise<{ prepared: EditPreparation; usage: TokenUsage }> {
	const rounds: Array<{ request: AiProviderRequest; result: Awaited<ReturnType<typeof requestAiResponse>> }> = [];
	let roundRequest = options.request;

	for (let round = 0; round < 2; round += 1) {
		options.signal.throwIfAborted();
		const result = await options.requestRound(
			roundRequest,
			{
				onEvent: (event) => {
					if (event.type === 'reasoning') {
						options.onReasoning?.(event.text);
					}
				},
			},
			options.signal,
		);
		options.signal.throwIfAborted();
		rounds.push({ request: roundRequest, result });

		let prepared: EditPreparation;
		try {
			prepared = options.editStrategy.prepareEdit(options.original, result.content);
		} catch (error) {
			if (round === 1 || !(error instanceof EditResponseValidationError)) {
				throw error;
			}
			options.onRetry?.();
			roundRequest = {
				...options.request,
				continuation: [
					...(options.request.continuation ?? []),
					{ role: 'assistant', content: result.content },
					{ role: 'user', content: formatEditValidationFeedback(error) },
				],
			};
			continue;
		}

		return { prepared, usage: resolveRoundTokenUsage(rounds) };
	}

	throw new Error('The edit response correction loop ended unexpectedly.');
}
