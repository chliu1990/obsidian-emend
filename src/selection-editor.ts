import type { MarkdownView, TFile } from 'obsidian';
import {
	formatAdditionalNotesPrompt,
	type AdditionalNoteSnapshot,
} from './additional-notes-context';
import {
	assertRequestWithinCapacity,
	requireValidContextCapacity,
	resolveContextCapacity,
} from './context-accounting';
import { parseCriticMarkup, prepareCriticMarkupEdit } from './critic-markup';
import { assertEditFreshness } from './edit-freshness';
import { prepareEditResponse } from './edit-response';
import type { EditPreparation, EditStrategy } from './edit-strategy';
import { EditResponseValidationError } from './edit-validation';
import type { EditResult } from './note-writer';
import { canWriteToNote } from './permissions';
import type { requestAiResponse } from './provider-stream';
import { buildSmartSelectionContext } from './selection-context';
import {
	buildFullNoteSelectionSections,
	type SelectionContextPolicy,
} from './selection-focus';
import type { TokenUsage } from './token-usage';
import type {
	InstructionPromptParts,
	Mode,
	ProviderConfig,
	ProviderHistoryMessage,
	SelectionSnapshot,
} from './types';

const COMPOSED_MARKUP_ERROR =
	'Compiled operations produce invalid CriticMarkup in the complete note. Preserve existing CriticMarkup tokens and do not nest markup.';
const IN_TOKEN_SELECTION_ERROR =
	'This selection is inside a pending tracked change. Accept or reject that change in Track Changes first, then try again. No edits were applied.';

function isStrictlyInsideExistingCriticMarkupToken(
	snapshot: SelectionSnapshot,
): boolean {
	if (snapshot.from >= snapshot.to) {
		return false;
	}
	try {
		return parseCriticMarkup(snapshot.fullText).some((token) =>
			snapshot.from > token.start && snapshot.to < token.end
		);
	} catch {
		return false;
	}
}

function validateComposedSelectionEdit(
	snapshot: SelectionSnapshot,
	prepared: EditPreparation,
): void {
	const composedFullText = `${snapshot.fullText.slice(0, snapshot.from)}${prepared.annotatedMarkdown}${snapshot.fullText.slice(snapshot.to)}`;
	try {
		prepareCriticMarkupEdit(snapshot.fullText, composedFullText);
	} catch {
		if (isStrictlyInsideExistingCriticMarkupToken(snapshot)) {
			throw new EditResponseValidationError(
				'in-token-selection',
				IN_TOKEN_SELECTION_ERROR,
				{},
				{ correctionEligible: false },
			);
		}
		throw new EditResponseValidationError(
			'compiled-markup-rejected',
			COMPOSED_MARKUP_ERROR,
		);
	}
}

interface SymmetricSelectionContext {
	before: string;
	after: string;
}

export interface SelectionFreshnessReaders {
	readDiskText(file: TFile): Promise<string>;
	readEditorTexts(file: TFile): readonly string[] | undefined;
}

export interface SelectionEditorAdapter {
	readCurrentText: () => string;
	readDiskText: () => Promise<string>;
	readEditorTexts: () => readonly string[] | undefined;
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
	selectionContext: SelectionContextPolicy;
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
	readers: SelectionFreshnessReaders,
): SelectionEditorAdapter {
	const file = markdownView.file;
	return {
		readCurrentText: () => markdownView.editor.getValue(),
		readDiskText: () => {
			if (!file) {
				return Promise.reject(new Error('Open a saved Markdown note first.'));
			}
			return readers.readDiskText(file);
		},
		readEditorTexts: () => {
			if (!file) {
				throw new Error('Open a saved Markdown note first.');
			}
			return readers.readEditorTexts(file);
		},
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
	readers: SelectionFreshnessReaders,
): SelectionEditTarget {
	return {
		snapshot: captureSelectionSnapshot(view),
		editor: createSelectionEditorAdapter(view, isTargetCurrent, readers),
	};
}

export async function applyPreparedSelectionEdit(
	mode: Mode,
	snapshot: SelectionSnapshot,
	prepared: EditPreparation,
	editor: SelectionEditorAdapter,
	signal?: AbortSignal,
): Promise<EditResult> {
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

	await assertEditFreshness({
		capturedText: snapshot.fullText,
		readDiskText: editor.readDiskText,
		readEditorTexts: () => [
			editor.readCurrentText(),
			...(editor.readEditorTexts() ?? []),
		],
		isTargetCurrent: editor.isTargetCurrent,
	}, signal);
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
			userPrompt: buildSelectionUserPrompt({
				snapshot: submission.snapshot,
				prompt: submission.prompt,
				maxContextCharacters: submission.maxContextCharacters,
				smartSelectionContext: submission.smartSelectionContext,
				selectionContext: submission.selectionContext,
				additionalNotes,
				notePath: submission.notePath,
			}),
			history: submission.history,
		};
		submission.signal.throwIfAborted();
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
			validatePrepared: (candidate) =>
				validateComposedSelectionEdit(submission.snapshot, candidate),
			onReasoning: submission.callbacks?.onReasoning,
			onRetry: submission.callbacks?.onRetry,
		});
		return {
			...(await applyPreparedSelectionEdit(
				'edit',
				submission.snapshot,
				prepared,
				this.dependencies.editor,
				submission.signal,
			)),
			usage,
		};
	}
}

export interface SelectionPromptInput {
	snapshot: SelectionSnapshot;
	prompt: string;
	maxContextCharacters: number;
	smartSelectionContext: boolean;
	selectionContext: SelectionContextPolicy;
	additionalNotes: readonly AdditionalNoteSnapshot[];
	notePath?: string;
}

export function buildSelectionUserPrompt(input: SelectionPromptInput): string {
	const { snapshot } = input;
	const parts: string[] = [];
	const notePath = input.notePath?.trim();
	if (notePath) {
		parts.push('Active note path:', notePath, '');
	}
	if (input.selectionContext === 'full-note') {
		parts.push(buildFullNoteSelectionSections(snapshot, 'edit-target'), '');
	} else {
		parts.push(`Selected text:\n${snapshot.selectedText}`, '');
		if (input.smartSelectionContext) {
			const context = buildSmartSelectionContext(
				snapshot.fullText,
				snapshot.from,
				snapshot.to,
				input.maxContextCharacters,
			);
			parts.push(`Context:\n${context.contextText}`, '');
		} else {
			const context = getSelectionContext(
				snapshot,
				input.maxContextCharacters,
			);
			parts.push(
				`Context before:\n${context.before}`,
				'',
				`Context after:\n${context.after}`,
				'',
			);
		}
	}
	const additionalNotesPrompt = formatAdditionalNotesPrompt(input.additionalNotes);
	if (additionalNotesPrompt) {
		parts.push(additionalNotesPrompt, '');
	}
	parts.push('User message:', input.prompt);
	return parts.join('\n');
}
