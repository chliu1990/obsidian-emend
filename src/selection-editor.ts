import type { MarkdownView } from 'obsidian';
import {
	formatAdditionalNotesPrompt,
	type AdditionalNoteSnapshot,
} from './additional-notes-context';
import {
	assertRequestWithinCapacity,
	requireValidContextCapacity,
	resolveContextCapacity,
} from './context-accounting';
import { prepareEditResponse } from './edit-response';
import type { EditPreparation, EditStrategy } from './edit-strategy';
import type { EditResult } from './note-writer';
import { canWriteToNote } from './permissions';
import type { requestAiResponse } from './provider-stream';
import { buildSmartSelectionContext } from './selection-context';
import type { TokenUsage } from './token-usage';
import type {
	InstructionPromptParts,
	Mode,
	ProviderConfig,
	ProviderHistoryMessage,
	SelectionSnapshot,
} from './types';

const STALE_NOTE_ERROR =
	'The note changed while Emend was responding. No edits were applied.';

interface SymmetricSelectionContext {
	before: string;
	after: string;
}

export interface SelectionEditorAdapter {
	readCurrentText: () => string;
	isTargetCurrent: () => boolean;
	replaceRange: (replacement: string, from: number, to: number) => void;
}

interface SelectionEditRequestCoordinatorDependencies {
	provider: ProviderConfig;
	loadAdditionalNotes(
		paths: readonly string[],
		activeNotePath: string,
		signal: AbortSignal,
	): Promise<AdditionalNoteSnapshot[]>;
	loadInstructions(): Promise<InstructionPromptParts>;
	request: typeof requestAiResponse;
	editor: SelectionEditorAdapter;
	editStrategy: EditStrategy;
}

export interface SelectionEditCallbacks {
	onReasoning?: (text: string) => void;
	onRetry?: () => void;
}

export interface SelectionEditResult extends EditResult {
	usage: TokenUsage;
}

export interface SelectionEditSubmission {
	snapshot: SelectionSnapshot;
	prompt: string;
	maxContextCharacters: number;
	smartSelectionContext: boolean;
	additionalNotePaths: readonly string[];
	history: ProviderHistoryMessage[];
	notePath?: string;
	signal: AbortSignal;
	callbacks?: SelectionEditCallbacks;
}

export function captureSelectionSnapshot(
	markdownView: MarkdownView,
): SelectionSnapshot {
	const file = markdownView.file;
	if (!file) {
		throw new Error('Open a saved Markdown note first.');
	}

	const editor = markdownView.editor;
	const fullText = editor.getValue();
	const from = editor.posToOffset(editor.getCursor('from'));
	const to = editor.posToOffset(editor.getCursor('to'));
	const selectedText = fullText.slice(from, to);
	if (!selectedText.trim()) {
		throw new Error('Select non-whitespace text first.');
	}

	return { file, fullText, selectedText, from, to };
}

export function getSelectionContext(
	snapshot: SelectionSnapshot,
	maxCharacters: number,
): SymmetricSelectionContext {
	if (snapshot.fullText.length <= maxCharacters) {
		return {
			before: snapshot.fullText.slice(0, snapshot.from),
			after: snapshot.fullText.slice(snapshot.to),
		};
	}

	const remainingCharacters = Math.max(
		maxCharacters - snapshot.selectedText.length,
		0,
	);
	const beforeBudget = Math.floor(remainingCharacters / 2);
	const afterBudget = remainingCharacters - beforeBudget;
	let start = Math.max(0, snapshot.from - beforeBudget);
	let end = Math.min(snapshot.fullText.length, snapshot.to + afterBudget);

	const unusedBeforeBudget = beforeBudget - (snapshot.from - start);
	if (unusedBeforeBudget > 0) {
		end = Math.min(snapshot.fullText.length, end + unusedBeforeBudget);
	}
	const unusedAfterBudget = afterBudget - (end - snapshot.to);
	if (unusedAfterBudget > 0) {
		start = Math.max(0, start - unusedAfterBudget);
	}

	return {
		before: snapshot.fullText.slice(start, snapshot.from),
		after: snapshot.fullText.slice(snapshot.to, end),
	};
}

export function createSelectionEditorAdapter(
	markdownView: MarkdownView,
	isTargetCurrent: (view: MarkdownView) => boolean,
): SelectionEditorAdapter {
	const file = markdownView.file;
	return {
		readCurrentText: () => markdownView.editor.getValue(),
		isTargetCurrent: () =>
			file !== null && markdownView.file === file && isTargetCurrent(markdownView),
		replaceRange: (replacement, from, to) => {
			const editor = markdownView.editor;
			editor.replaceRange(
				replacement,
				editor.offsetToPos(from),
				editor.offsetToPos(to),
			);
		},
	};
}

export interface SelectionEditTarget {
	snapshot: SelectionSnapshot;
	editor: SelectionEditorAdapter;
}

export function captureSelectionEditTarget(
	view: MarkdownView,
	isTargetCurrent: (view: MarkdownView) => boolean,
): SelectionEditTarget {
	return {
		snapshot: captureSelectionSnapshot(view),
		editor: createSelectionEditorAdapter(view, isTargetCurrent),
	};
}

export function applyPreparedSelectionEdit(
	mode: Mode,
	snapshot: SelectionSnapshot,
	prepared: EditPreparation,
	editor: SelectionEditorAdapter,
	signal?: AbortSignal,
): EditResult {
	const annotatedFullText = `${snapshot.fullText.slice(0, snapshot.from)}${prepared.annotatedMarkdown}${snapshot.fullText.slice(snapshot.to)}`;
	if (!canWriteToNote(mode)) {
		return {
			applied: false,
			changeCount: 0,
			summaryItems: [],
			summary: undefined,
		};
	}
	if (annotatedFullText === snapshot.fullText) {
		return {
			applied: false,
			changeCount: 0,
			summaryItems: [],
			summary: prepared.summary,
		};
	}

	signal?.throwIfAborted();
	if (editor.readCurrentText() !== snapshot.fullText || !editor.isTargetCurrent()) {
		throw new Error(STALE_NOTE_ERROR);
	}
	if (!canWriteToNote(mode)) {
		return {
			applied: false,
			changeCount: 0,
			summaryItems: [],
			summary: undefined,
		};
	}

	signal?.throwIfAborted();
	editor.replaceRange(prepared.annotatedMarkdown, snapshot.from, snapshot.to);
	return {
		applied: true,
		changeCount: prepared.changeCount,
		summaryItems: prepared.summaryItems,
		summary: prepared.summary,
	};
}

export class SelectionEditRequestCoordinator {
	constructor(
		private readonly dependencies: SelectionEditRequestCoordinatorDependencies,
	) {}

	async submit(submission: SelectionEditSubmission): Promise<SelectionEditResult> {
		requireValidContextCapacity(this.dependencies.provider);
		const additionalNotes = await this.dependencies.loadAdditionalNotes(
			submission.additionalNotePaths,
			submission.snapshot.file.path,
			submission.signal,
		);
		const instructions = await this.dependencies.loadInstructions();
		const request = {
			provider: this.dependencies.provider,
			systemPrompt: this.dependencies.editStrategy.getSelectionPrompt(instructions),
			userPrompt: buildSelectionUserPrompt(submission, additionalNotes),
			history: submission.history,
		};
		assertRequestWithinCapacity(
			request,
			resolveContextCapacity(this.dependencies.provider),
			'selection',
		);
		const { prepared, usage } = await prepareEditResponse({
			original: submission.snapshot.selectedText,
			sourceContext: submission.snapshot,
			request,
			editStrategy: this.dependencies.editStrategy,
			requestRound: this.dependencies.request,
			signal: submission.signal,
			onReasoning: submission.callbacks?.onReasoning,
			onRetry: submission.callbacks?.onRetry,
		});
		return {
			...applyPreparedSelectionEdit(
				'edit',
				submission.snapshot,
				prepared,
				this.dependencies.editor,
				submission.signal,
			),
			usage,
		};
	}
}

function buildSelectionUserPrompt(
	submission: SelectionEditSubmission,
	additionalNotes: readonly AdditionalNoteSnapshot[],
): string {
	const { snapshot } = submission;
	const parts: string[] = [];
	const notePath = submission.notePath?.trim();
	if (notePath) {
		parts.push('Active note path:', notePath, '');
	}
	parts.push(`Selected text:\n${snapshot.selectedText}`, '');
	if (submission.smartSelectionContext) {
		const context = buildSmartSelectionContext(
			snapshot.fullText,
			snapshot.from,
			snapshot.to,
			submission.maxContextCharacters,
		);
		parts.push(`Context:\n${context.contextText}`, '');
	} else {
		const context = getSelectionContext(
			snapshot,
			submission.maxContextCharacters,
		);
		parts.push(
			`Context before:\n${context.before}`,
			'',
			`Context after:\n${context.after}`,
			'',
		);
	}
	const additionalNotesPrompt = formatAdditionalNotesPrompt(additionalNotes);
	if (additionalNotesPrompt) {
		parts.push(additionalNotesPrompt, '');
	}
	parts.push('User message:', submission.prompt);
	return parts.join('\n');
}
