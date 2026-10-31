import type { RequestContext } from './context';
import type { EditStrategy } from './edit-strategy';
import { getSystemPrompt } from './mode';
import {
	applyPreparedEdit,
	type EditResult,
	type NoteWriter,
} from './note-writer';
import {
	requestAiResponse,
	type StreamResult,
} from './provider-stream';
import { resolveTokenUsage } from './token-usage';
import type { TokenUsage } from './token-usage';
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

export interface EditSubmission {
	context: RequestContext;
	mode: 'edit';
	prompt: string;
	history: ProviderHistoryMessage[];
	callbacks: Pick<ReadOnlyStreamCallbacks, 'onReasoning'>;
	signal: AbortSignal;
}

interface ReadOnlyRequestCoordinatorDependencies {
	provider: ProviderConfig;
	loadInstructions(): Promise<InstructionPromptParts>;
	request: typeof requestAiResponse;
}

interface EditRequestCoordinatorDependencies
	extends ReadOnlyRequestCoordinatorDependencies {
	writer: NoteWriter;
	editStrategy: EditStrategy;
}

export interface ChatStreamResult extends Omit<StreamResult, 'usage'> {
	usage: TokenUsage;
}

export interface EditRequestResult extends EditResult {
	usage: TokenUsage;
}

export class ReadOnlyRequestCoordinator {
	constructor(
		private readonly dependencies: ReadOnlyRequestCoordinatorDependencies,
	) {}

	async submit(submission: ReadOnlySubmission): Promise<ChatStreamResult> {
		const instructions = await this.dependencies.loadInstructions();
		const request = {
			provider: this.dependencies.provider,
			systemPrompt: getSystemPrompt(submission.mode, instructions),
			userPrompt: buildUserPrompt(submission.context, submission.prompt),
			history: submission.history.slice(-8),
		};
		const result = await this.dependencies.request(
			request,
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
		return { ...result, usage: resolveTokenUsage(request, result) };
	}
}

export class EditRequestCoordinator {
	constructor(
		private readonly dependencies: EditRequestCoordinatorDependencies,
	) {}

	async submit(submission: EditSubmission): Promise<EditRequestResult> {
		const instructions = await this.dependencies.loadInstructions();
		let response = '';
		const request = {
			provider: this.dependencies.provider,
			systemPrompt: this.dependencies.editStrategy.getFullNotePrompt(instructions),
			userPrompt: buildUserPrompt(
				submission.context,
				submission.prompt,
				submission.context.sourceText,
			),
			history: submission.history.slice(-8),
		};
		const result = await this.dependencies.request(
			request,
			{
				onEvent: (event) => {
					if (event.type === 'content') {
						response += event.text;
					} else if (event.type === 'reasoning') {
						submission.callbacks.onReasoning(event.text);
					}
				},
			},
			submission.signal,
		);
		submission.signal.throwIfAborted();

		const prepared = this.dependencies.editStrategy.prepareEdit(
			submission.context.sourceText,
			response,
		);
		const editResult = await applyPreparedEdit(
			submission.mode,
			submission.context,
			prepared,
			this.dependencies.writer,
			submission.signal,
		);
		return { ...editResult, usage: resolveTokenUsage(request, result) };
	}
}

function buildUserPrompt(
	context: RequestContext,
	prompt: string,
	markdown = context.markdown,
) {
	const parts: string[] = [];
	const notePath = context.notePath?.trim();
	if (notePath) {
		parts.push('Active note path:', notePath, '');
	}

	parts.push(
		'Active note Markdown:',
		'```markdown',
		markdown,
		'```',
		'',
		'User message:',
		prompt,
	);
	return parts.join('\n');
}
