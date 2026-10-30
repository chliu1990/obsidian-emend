import type { RequestContext } from './context';
import { criticMarkupEditStrategy } from './edit-strategy';
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

export class EditRequestCoordinator {
	constructor(
		private readonly dependencies: EditRequestCoordinatorDependencies,
	) {}

	async submit(submission: EditSubmission): Promise<EditResult> {
		const instructions = await this.dependencies.loadInstructions();
		let response = '';
		await this.dependencies.request(
			{
				provider: this.dependencies.provider,
				systemPrompt: criticMarkupEditStrategy.getFullNotePrompt(instructions),
				userPrompt: buildUserPrompt(
					submission.context,
					submission.prompt,
					submission.context.sourceText,
				),
				history: submission.history.slice(-8),
			},
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

		const prepared = criticMarkupEditStrategy.prepareEdit(
			submission.context.sourceText,
			response,
		);
		return applyPreparedEdit(
			submission.mode,
			submission.context,
			prepared,
			this.dependencies.writer,
		);
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
