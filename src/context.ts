import { TFile, type MarkdownView } from 'obsidian';

export interface RequestContext {
	file: TFile;
	sourceText: string;
	selection: {
		from: number;
		to: number;
	};
	noteLabel: string;
	notePath?: string;
	markdown: string;
}

export interface ContextCaptureOptions {
	maxCharacters: number;
	includeNotePath: boolean;
}

export function captureRequestContext(
	markdownView: MarkdownView,
	options: ContextCaptureOptions,
): RequestContext {
	const file = markdownView.file;
	if (!file) {
		throw new Error('Open a saved Markdown note first.');
	}

	const editor = markdownView.editor;
	const sourceText = editor.getValue();
	const from = editor.posToOffset(editor.getCursor('from'));
	const to = editor.posToOffset(editor.getCursor('to'));
	const notePath = file.path;

	return {
		file,
		sourceText,
		selection: { from, to },
		noteLabel: notePath,
		notePath: options.includeNotePath
			? `${markdownView.app.vault.getName()}/${notePath}`
			: undefined,
		markdown: getBoundedContext(
			sourceText,
			from,
			to,
			options.maxCharacters,
		),
	};
}

export function getBoundedContext(
	fullNote: string,
	from: number,
	to: number,
	maxCharacters: number,
): string {
	if (fullNote.length <= maxCharacters) {
		return fullNote;
	}

	const selectionLength = Math.max(to - from, 0);
	const remainingCharacters = Math.max(maxCharacters - selectionLength, 0);
	const beforeBudget = Math.floor(remainingCharacters / 2);
	const afterBudget = remainingCharacters - beforeBudget;

	let start = Math.max(0, from - beforeBudget);
	let end = Math.min(fullNote.length, to + afterBudget);

	const unusedBeforeBudget = beforeBudget - (from - start);
	if (unusedBeforeBudget > 0) {
		end = Math.min(fullNote.length, end + unusedBeforeBudget);
	}

	const unusedAfterBudget = afterBudget - (end - to);
	if (unusedAfterBudget > 0) {
		start = Math.max(0, start - unusedAfterBudget);
	}

	const prefix = start > 0 ? '[...]\n' : '';
	const suffix = end < fullNote.length ? '\n[...]' : '';
	return `${prefix}${fullNote.slice(start, end)}${suffix}`;
}
