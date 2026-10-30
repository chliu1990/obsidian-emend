import type { MarkdownView } from 'obsidian';
import { criticMarkupEditStrategy, type EditPreparation } from './edit-strategy';
import type { EditResult } from './note-writer';
import { canWriteToNote } from './permissions';
import type { requestAiResponse } from './provider-stream';
import type {
	InstructionPromptParts,
	Mode,
	ProviderConfig,
	SelectionSnapshot,
} from './types';

const STALE_NOTE_ERROR =
	'The note changed while Emend was responding. No edits were applied.';

export interface SelectionContext {
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
	loadInstructions(): Promise<InstructionPromptParts>;
	request: typeof requestAiResponse;
	editor: SelectionEditorAdapter;
}

export interface SelectionEditSubmission {
	snapshot: SelectionSnapshot;
	prompt: string;
	maxContextCharacters: number;
	notePath?: string;
	signal: AbortSignal;
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
): SelectionContext {
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

export function applyPreparedSelectionEdit(
	mode: Mode,
	snapshot: SelectionSnapshot,
	prepared: EditPreparation,
	editor: SelectionEditorAdapter,
	signal?: AbortSignal,
): EditResult {
	const annotatedFullText = `${snapshot.fullText.slice(0, snapshot.from)}${prepared.annotatedMarkdown}${snapshot.fullText.slice(snapshot.to)}`;
	if (!canWriteToNote(mode) || annotatedFullText === snapshot.fullText) {
		return { applied: false, changeCount: 0 };
	}

	signal?.throwIfAborted();
	if (editor.readCurrentText() !== snapshot.fullText || !editor.isTargetCurrent()) {
		throw new Error(STALE_NOTE_ERROR);
	}
	if (!canWriteToNote(mode)) {
		return { applied: false, changeCount: 0 };
	}

	signal?.throwIfAborted();
	editor.replaceRange(prepared.annotatedMarkdown, snapshot.from, snapshot.to);
	return { applied: true, changeCount: prepared.changeCount };
}

export class SelectionEditRequestCoordinator {
	constructor(
		private readonly dependencies: SelectionEditRequestCoordinatorDependencies,
	) {}

	async submit(submission: SelectionEditSubmission): Promise<EditResult> {
		const instructions = await this.dependencies.loadInstructions();
		let response = '';
		await this.dependencies.request(
			{
				provider: this.dependencies.provider,
				systemPrompt: criticMarkupEditStrategy.getSelectionPrompt(instructions),
				userPrompt: buildSelectionUserPrompt(submission),
				history: [],
			},
			{
				onEvent: (event) => {
					if (event.type === 'content') {
						response += event.text;
					}
				},
			},
			submission.signal,
		);
		submission.signal.throwIfAborted();

		const prepared = criticMarkupEditStrategy.prepareEdit(
			submission.snapshot.selectedText,
			response,
		);
		return applyPreparedSelectionEdit(
			'edit',
			submission.snapshot,
			prepared,
			this.dependencies.editor,
			submission.signal,
		);
	}
}

function buildSelectionUserPrompt(submission: SelectionEditSubmission): string {
	const { snapshot } = submission;
	const context = getSelectionContext(snapshot, submission.maxContextCharacters);
	const parts: string[] = [];
	const notePath = submission.notePath?.trim();
	if (notePath) {
		parts.push('Active note path:', notePath, '');
	}
	parts.push(
		`Selected text:\n${snapshot.selectedText}`,
		'',
		`Context before:\n${context.before}`,
		'',
		`Context after:\n${context.after}`,
		'',
		'User message:',
		submission.prompt,
	);
	return parts.join('\n');
}
