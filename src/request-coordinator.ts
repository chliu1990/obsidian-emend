import type { RequestContext } from './context';
import { getSystemPrompt } from './mode';
import {
	requestAiResponse,
	type StreamResult,
} from './provider-stream';
import type {
	InstructionPromptParts,
	Mode,
	ProviderConfig,
	ProviderHistoryMessage,
} from './types';

export type ReadOnlyMode = Exclude<Mode, 'edit'>;

export interface ReadOnlyStreamCallbacks {
	onContent: (text: string) => void;
	onReasoning: (text: string) => void;
}

export interface ReadOnlySubmission {
	context: RequestContext;
	mode: ReadOnlyMode;
	prompt: string;
	history: ProviderHistoryMessage[];
	callbacks: ReadOnlyStreamCallbacks;
	signal: AbortSignal;
}

interface ReadOnlyRequestCoordinatorDependencies {
	provider: ProviderConfig;
	loadInstructions(): Promise<InstructionPromptParts>;
	request: typeof requestAiResponse;
}

export class ReadOnlyRequestCoordinator {
	constructor(
		private readonly dependencies: ReadOnlyRequestCoordinatorDependencies,
	) {}

	async submit(submission: ReadOnlySubmission): Promise<StreamResult> {
		const instructions = await this.dependencies.loadInstructions();
		return this.dependencies.request(
			{
				provider: this.dependencies.provider,
				systemPrompt: getSystemPrompt(submission.mode, instructions),
				userPrompt: buildUserPrompt(submission.context, submission.prompt),
				history: submission.history.slice(-8),
			},
			{
				onEvent: (event) => {
					if (event.type === 'content') {
						submission.callbacks.onContent(event.text);
					} else if (event.type === 'reasoning') {
						submission.callbacks.onReasoning(event.text);
					}
				},
			},
			submission.signal,
		);
	}
}

function buildUserPrompt(context: RequestContext, prompt: string) {
	const parts: string[] = [];
	const notePath = context.notePath?.trim();
	if (notePath) {
		parts.push('Active note path:', notePath, '');
	}

	parts.push(
		'Active note Markdown:',
		'```markdown',
		context.markdown,
		'```',
		'',
		'User message:',
		prompt,
	);
	return parts.join('\n');
}
