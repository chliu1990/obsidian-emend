import {
	formatAdditionalNotesPrompt,
	type AdditionalNoteSnapshot,
} from './additional-notes-context';
import type { RequestContext } from './context';
import {
	assertRequestWithinCapacity,
	requireValidContextCapacity,
	resolveContextCapacity,
} from './context-accounting';
import type { DeepSeekWebSearchCoordinator } from './deepseek-web';
import { prepareEditResponse } from './edit-response';
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
	'callbacks' | 'signal' | 'question'
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
	callbacks: Pick<ReadOnlyStreamCallbacks, 'onReasoning'> & {
		onRetry?: () => void;
	};
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
	failedExtractions: number;
	failedSearches: number;
	skippedWebCalls: number;
	omittedEvidence: boolean;
}

export interface EditRequestResult extends EditResult {
	usage: TokenUsage;
}

export class ReadOnlyRequestCoordinator {
	constructor(
		private readonly dependencies: ReadOnlyRequestCoordinatorDependencies,
	) {}

	async submit(submission: ReadOnlySubmission): Promise<ChatStreamResult> {
		requireValidContextCapacity(this.dependencies.provider);
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
			history: submission.history,
		};
		submission.signal.throwIfAborted();
		assertRequestWithinCapacity(
			request,
			resolveContextCapacity(this.dependencies.provider),
			'read-only',
		);
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
				question: submission.prompt,
				callbacks,
				signal: submission.signal,
			});
			return {
				content: result.content,
				reasoning: result.reasoning,
				sources: result.sources,
				activities: result.activities,
				failedExtractions: result.failedExtractions,
				failedSearches: result.failedSearches,
				skippedWebCalls: result.skippedWebCalls,
				omittedEvidence: result.omittedEvidence,
				usage: resolveRoundTokenUsage(result.rounds),
			};
		}

		const result = await this.dependencies.request(
			request,
			callbacks,
			submission.signal,
		);
		return {
			...result,
			failedExtractions: 0,
			failedSearches: 0,
			skippedWebCalls: 0,
			omittedEvidence: false,
			usage: resolveTokenUsage(request, result),
		};
	}
}

export class EditRequestCoordinator {
	constructor(
		private readonly dependencies: EditRequestCoordinatorDependencies,
	) {}

	async submit(submission: EditSubmission): Promise<EditRequestResult> {
		requireValidContextCapacity(this.dependencies.provider);
		const additionalNotes = await this.dependencies.loadAdditionalNotes(
			submission.additionalNotePaths,
			submission.context.file.path,
			submission.signal,
		);
		const instructions = await this.dependencies.loadInstructions();
		const request = {
			provider: this.dependencies.provider,
			systemPrompt: this.dependencies.editStrategy.getFullNotePrompt(instructions),
			userPrompt: buildUserPrompt(
				submission.context,
				submission.prompt,
				additionalNotes,
				submission.context.sourceText,
			),
			history: submission.history,
		};
		submission.signal.throwIfAborted();
		assertRequestWithinCapacity(
			request,
			resolveContextCapacity(this.dependencies.provider),
			'full-note',
		);
		const { prepared, usage } = await prepareEditResponse({
			original: submission.context.sourceText,
			request,
			editStrategy: this.dependencies.editStrategy,
			requestRound: this.dependencies.request,
			signal: submission.signal,
			onReasoning: submission.callbacks.onReasoning,
			onRetry: submission.callbacks.onRetry,
		});
		const editResult = await applyPreparedEdit(
			submission.mode,
			submission.context,
			prepared,
			this.dependencies.writer,
			submission.signal,
		);
		return { ...editResult, usage };
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
