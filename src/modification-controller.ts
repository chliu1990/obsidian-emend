import type { RequestContext } from './context';
import { formatEditSummary, formatNoChangeSummary } from './edit-summary';
import type { EditRequestResult, EditSubmission } from './request-coordinator';
import type {
	SelectionEditCallbacks,
	SelectionEditResult,
	SelectionEditTarget,
	SelectionEditorAdapter,
} from './selection-editor';
import type { SelectionContextPolicy } from './selection-focus';
import type { TokenUsage } from './token-usage';
import type { ProviderHistoryMessage, SelectionSnapshot } from './types';

export type ModificationTarget =
	| {
		readonly type: 'full-note';
		readonly mode: 'edit';
		readonly context: RequestContext;
	}
	| {
		readonly type: 'selection';
		readonly mode: 'edit';
		readonly target: SelectionEditTarget;
		readonly selectionContext: SelectionContextPolicy;
	};

export interface ModificationStreamCallbacks {
	onReasoning(text: string): void;
	onRetry(): void;
}

export interface ModificationSubmission {
	readonly target: ModificationTarget;
	readonly prompt: string;
	readonly history: ProviderHistoryMessage[];
	readonly additionalNotePaths: readonly string[];
	readonly signal: AbortSignal;
	readonly callbacks: ModificationStreamCallbacks;
}

export interface ModificationResult {
	readonly applied: boolean;
	readonly content: string;
	readonly usage: TokenUsage;
}

export interface ModificationControllerDependencies {
	requestFullNoteEdit(submission: EditSubmission): Promise<EditRequestResult>;
	requestSelectionEdit(
		snapshot: SelectionSnapshot,
		prompt: string,
		signal: AbortSignal,
		editor: SelectionEditorAdapter,
		additionalNotePaths: readonly string[],
		history: ProviderHistoryMessage[],
		callbacks: SelectionEditCallbacks,
		selectionContext: SelectionContextPolicy,
	): Promise<SelectionEditResult>;
}

export class ModificationController {
	constructor(
		private readonly dependencies: ModificationControllerDependencies,
	) {}

	async submit(submission: ModificationSubmission): Promise<ModificationResult> {
		if (submission.target.type === 'full-note') {
			const target = submission.target;
			const result = await this.dependencies.requestFullNoteEdit({
				context: target.context,
				mode: target.mode,
				prompt: submission.prompt,
				history: submission.history,
				additionalNotePaths: submission.additionalNotePaths,
				callbacks: submission.callbacks,
				signal: submission.signal,
			});
			return {
				applied: result.applied,
				content: result.applied
					? formatEditSummary(
						result.changeCount,
						result.summaryItems,
						target.context.sourceText,
						0,
						{ target: 'full-note', summary: result.summary },
					)
					: formatNoChangeSummary(result.summary),
				usage: result.usage,
			};
		}

		const target = submission.target.target;
		const result = await this.dependencies.requestSelectionEdit(
			target.snapshot,
			submission.prompt,
			submission.signal,
			target.editor,
			submission.additionalNotePaths,
			submission.history,
			submission.callbacks,
			submission.target.selectionContext,
		);
		return {
			applied: result.applied,
			content: result.applied
				? formatEditSummary(
					result.changeCount,
					result.summaryItems,
					target.snapshot.fullText,
					target.snapshot.from,
					{ target: 'selection', summary: result.summary },
				)
				: formatNoChangeSummary(result.summary),
			usage: result.usage,
		};
	}
}
