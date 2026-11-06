import {
	formatAdditionalNotesPrompt,
	type AdditionalNoteSnapshot,
} from './additional-notes-context';
import type { RequestContext } from './context';
import type { DeepSeekWebSearchCoordinator } from './deepseek-web';
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
import { resolveRoundTokenUsage, resolveTokenUsage } from './token-usage';
import type { TokenUsage } from './token-usage';
import type {
	InstructionPromptParts,
	Mode,
	ProviderConfig,
	ProviderHistoryMessage,
} from './types';
import type { WebActivityRecord, WebSearchRunOptions, WebSource } from './web-search';

export type ReadOnlyMode = Exclude<Mode, 'edit'>;

export interface ReadOnlyStreamCallbacks {
	onContent: (text: string) => void;
	onReasoning: (text: string) => void;
}

export type ReadOnlyWebSearchOptions = Omit<
	WebSearchRunOptions,
	'callbacks' | 'signal'
>;

export interface ReadOnlySubmission {
	context: RequestContext;
	mode: ReadOnlyMode;
	prompt: string;
	history: ProviderHistoryMessage[];
	additionalNotePaths: readonly string[];
	callbacks: ReadOnlyStreamCallbacks;
	signal: AbortSignal;
	webSearch?: ReadOnlyWebSearchOptions;
}

export interface EditSubmission {
	context: RequestContext;
	mode: 'edit';
	prompt: string;
	history: ProviderHistoryMessage[];
	additionalNotePaths: readonly string[];
	callbacks: Pick<ReadOnlyStreamCallbacks, 'onReasoning'>;
	signal: AbortSignal;
}

interface ReadOnlyRequestCoordinatorDependencies {
	provider: ProviderConfig;
	loadAdditionalNotes(
		paths: readonly string[],
		activeNotePath: string,
		signal: AbortSignal,
	): Promise<AdditionalNoteSnapshot[]>;
	loadInstructions(): Promise<InstructionPromptParts>;
	request: typeof requestAiResponse;
	webSearch?: Pick<DeepSeekWebSearchCoordinator, 'submit'>;
}

interface EditRequestCoordinatorDependencies
	extends ReadOnlyRequestCoordinatorDependencies {
	writer: NoteWriter;
	editStrategy: EditStrategy;
}

export interface ChatStreamResult extends Omit<StreamResult, 'usage'> {
	usage: TokenUsage;
	sources?: WebSource[];
	activities?: WebActivityRecord[];
}

export interface EditRequestResult extends EditResult {
	usage: TokenUsage;
}

export class ReadOnlyRequestCoordinator {
	constructor(
		private readonly dependencies: ReadOnlyRequestCoordinatorDependencies,
	) {}

	async submit(submission: ReadOnlySubmission): Promise<ChatStreamResult> {
		const additionalNotes = await this.dependencies.loadAdditionalNotes(
			submission.additionalNotePaths,
			submission.context.file.path,
			submission.signal,
		);
		const instructions = await this.dependencies.loadInstructions();
		const request = {
			provider: this.dependencies.provider,
			systemPrompt: getSystemPrompt(submission.mode, instructions),
			userPrompt: buildUserPrompt(
				submission.context,
				submission.prompt,
				additionalNotes,
			),
			history: submission.history.slice(-8),
		};
		const callbacks = {
			onEvent: (event: Parameters<Parameters<typeof requestAiResponse>[1]['onEvent']>[0]) => {
				if (event.type === 'content') {
					submission.callbacks.onContent(event.text);
				} else if (event.type === 'reasoning') {
					submission.callbacks.onReasoning(event.text);
				}
			},
		};
		if (submission.webSearch) {
			if (!this.dependencies.webSearch) {
				throw new Error('Online search is not available for this provider and model.');
			}
			const result = await this.dependencies.webSearch.submit(request, {
				...submission.webSearch,
				callbacks,
				signal: submission.signal,
			});
			return {
				content: result.content,
				reasoning: result.reasoning,
				sources: result.sources,
				activities: result.activities,
				usage: resolveRoundTokenUsage(result.rounds),
			};
		}

		const result = await this.dependencies.request(
			request,
			callbacks,
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
		const additionalNotes = await this.dependencies.loadAdditionalNotes(
			submission.additionalNotePaths,
			submission.context.file.path,
			submission.signal,
		);
		const instructions = await this.dependencies.loadInstructions();
		let response = '';
		const request = {
			provider: this.dependencies.provider,
			systemPrompt: this.dependencies.editStrategy.getFullNotePrompt(instructions),
			userPrompt: buildUserPrompt(
				submission.context,
				submission.prompt,
				additionalNotes,
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
	additionalNotes: readonly AdditionalNoteSnapshot[],
	markdown = context.markdown,
) {
	const parts: string[] = [];
	const notePath = context.notePath?.trim();
	if (notePath) {
		parts.push('Active note path:', notePath, '');
	}

	parts.push('Active note Markdown:', '```markdown', markdown, '```');
	const additionalNotesPrompt = formatAdditionalNotesPrompt(additionalNotes);
	if (additionalNotesPrompt) {
		parts.push('', additionalNotesPrompt);
	}
	parts.push('', 'User message:', prompt);
	return parts.join('\n');
}
