import { TFile, type MarkdownView } from 'obsidian';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { AdditionalNoteSnapshot } from '../src/additional-notes-context';
import { ContextCapacityError, accountRequestCharacters } from '../src/context-accounting';
import { prepareCriticMarkupEdit } from '../src/critic-markup';
import type { EditPreparation } from '../src/edit-strategy';
import { EditResponseValidationError } from '../src/edit-validation';
import { operationEditStrategy } from '../src/operation-edit-strategy';
import { formatProviderHistory } from '../src/provider-history';
import type {
	AiProviderRequest,
	StreamEvent,
	StreamResult,
} from '../src/provider-stream';
import { QUICK_ACTIONS } from '../src/quick-actions';
import {
	applyPreparedSelectionEdit,
	buildSelectionUserPrompt,
	captureSelectionEditTarget,
	captureSelectionSnapshot,
	createSelectionEditorAdapter,
	getSelectionContext,
	SelectionEditRequestCoordinator,
	type SelectionEditSubmission,
	type SelectionEditorAdapter,
} from '../src/selection-editor';
import type {
	InstructionPromptParts,
	ProviderConfig,
	ProviderHistoryMessage,
	SelectionSnapshot,
} from '../src/types';

const STALE_ERROR =
	'The note changed while Emend was responding. No edits were applied.';
const IN_TOKEN_SELECTION_ERROR =
	'This selection is inside a pending tracked change. Accept or reject that change in Track Changes first, then try again. No edits were applied.';
const COMPOSED_MARKUP_ERROR =
	'Compiled operations produce invalid CriticMarkup in the complete note. Preserve existing CriticMarkup tokens and do not nest markup.';

const provider: ProviderConfig = {
	name: 'Local test provider',
	baseUrl: 'http://127.0.0.1:8787/v1',
	apiKey: 'dummy-test-key',
	model: 'dummy-model',
	reasoningEffort: 'low',
	requestUsage: false,
	discoveredModels: [],
	contextWindowTokens: null,
	outputReserveTokens: null,
	contextCapacityInvalid: false,
};

const invalidCapacityProvider: ProviderConfig = {
	...provider,
	contextWindowTokens: 8000,
	outputReserveTokens: 8000,
	contextCapacityInvalid: true,
};

const validCapacityProvider: ProviderConfig = {
	...provider,
	contextWindowTokens: 128000,
	outputReserveTokens: 8000,
	contextCapacityInvalid: false,
};

function capacityProviderForTokens(tokens: number, slack = 1): ProviderConfig {
	const outputReserveTokens = 1000;
	const effectiveInputTokens = Math.max(1, tokens - slack);
	return {
		...provider,
		contextWindowTokens: effectiveInputTokens + outputReserveTokens,
		outputReserveTokens,
		contextCapacityInvalid: false,
	};
}

function requestTokens(request: AiProviderRequest): number {
	return accountRequestCharacters(request).estimatedInputTokens;
}

function requireRequest(
	request: AiProviderRequest | undefined,
): AiProviderRequest {
	if (!request) {
		throw new Error('Provider request missing.');
	}
	return request;
}

function markdownFile(path = 'folder/note.md'): TFile {
	const file = new TFile();
	file.path = path;
	return file;
}

function makeView(sourceText: string, from: number, to: number) {
	const file = markdownFile();
	const editor = {
		getValue: vi.fn(() => sourceText),
		getCursor: vi.fn((which?: 'from' | 'to') => ({
			offset: which === 'from' ? from : to,
		})),
		posToOffset: vi.fn((position: { offset: number }) => position.offset),
		offsetToPos: vi.fn((offset: number) => ({ offset })),
		replaceRange: vi.fn(),
	};
	const view = { file, editor } as unknown as MarkdownView;
	return { file, editor, view };
}

function makeSnapshot(
	fullText = '# Note\nAlpha beta gamma.\nEnd',
	selectedText = 'beta',
	selectionFrom?: number,
): SelectionSnapshot {
	const from = selectionFrom ?? fullText.indexOf(selectedText);
	if (from < 0) {
		throw new Error('Test selection must occur in the source.');
	}
	return {
		file: markdownFile(),
		fullText,
		selectedText,
		from,
		to: from + selectedText.length,
	};
}

function makeAdapter(snapshot: SelectionSnapshot) {
	let currentText = snapshot.fullText;
	let diskText = snapshot.fullText;
	let editorTexts: readonly string[] | undefined = [];
	let targetCurrent = true;
	const adapter: SelectionEditorAdapter = {
		readCurrentText: vi.fn(() => currentText),
		readDiskText: vi.fn(async () => diskText),
		readEditorTexts: vi.fn(() => editorTexts),
		isTargetCurrent: vi.fn(() => targetCurrent),
		replaceRange: vi.fn(),
	};
	return {
		adapter,
		setCurrentText: (text: string) => {
			currentText = text;
		},
		setDiskText: (text: string) => {
			diskText = text;
		},
		setEditorTexts: (texts: readonly string[] | undefined) => {
			editorTexts = texts;
		},
		setTargetCurrent: (current: boolean) => {
			targetCurrent = current;
		},
	};
}

function expectNoFreshnessOrWrite(adapter: SelectionEditorAdapter): void {
	expect(adapter.readCurrentText).not.toHaveBeenCalled();
	expect(adapter.readDiskText).not.toHaveBeenCalled();
	expect(adapter.readEditorTexts).not.toHaveBeenCalled();
	expect(adapter.isTargetCurrent).not.toHaveBeenCalled();
	expect(adapter.replaceRange).not.toHaveBeenCalled();
}

function makeFreshnessReaders(sourceText: string) {
	return {
		readDiskText: vi.fn(async (_file: TFile) => sourceText),
		readEditorTexts: vi.fn((_file: TFile) => [sourceText]),
	};
}


describe('captureSelectionSnapshot', () => {
	it('captures exact selection offsets and text synchronously', () => {
		const fullText = '# Note\nAlpha beta gamma.\nEnd';
		const from = fullText.indexOf('beta');
		const { file, view } = makeView(fullText, from, from + 4);

		const snapshot = captureSelectionSnapshot(view);

		expect(snapshot).toEqual({
			file,
			fullText,
			selectedText: 'beta',
			from,
			to: from + 4,
		});
		expectTypeOf<SelectionSnapshot>().not.toHaveProperty('editor');
		expectTypeOf<SelectionSnapshot>().not.toHaveProperty('markdownView');
	});

	it('preserves a multiline selection exactly', () => {
		const fullText = 'First line\nSecond line\nThird line';
		const from = fullText.indexOf('Second');
		const to = fullText.indexOf('Third');
		const { view } = makeView(fullText, from, to);

		expect(captureSelectionSnapshot(view)).toMatchObject({
			fullText,
			selectedText: 'Second line\n',
			from,
			to,
		});
	});

	it.each([
		['empty', ''],
		['whitespace', ' \n\t'],
	])('rejects an %s selection', (_label, selectedText) => {
		const fullText = `Before${selectedText}After`;
		const { view } = makeView(fullText, 6, 6 + selectedText.length);

		expect(() => captureSelectionSnapshot(view)).toThrow(
			'Select non-whitespace text first.',
		);
	});

	it('requires a saved Markdown file', () => {
		const { view } = makeView('Alpha beta', 0, 5);
		view.file = null;

		expect(() => captureSelectionSnapshot(view)).toThrow(
			'Open a saved Markdown note first.',
		);
	});
});

describe('captureSelectionEditTarget', () => {
	it('returns the exact snapshot and an adapter bound to the same view', async () => {
		const fullText = '# Note\nAlpha beta gamma.\nEnd';
		const from = fullText.indexOf('beta');
		const to = from + 4;
		const { editor, file, view } = makeView(fullText, from, to);
		const isTargetCurrent = vi.fn(() => true);
		const readers = makeFreshnessReaders(fullText);

		const target = captureSelectionEditTarget(view, isTargetCurrent, readers);

		expect(target.snapshot).toEqual({
			file,
			fullText,
			selectedText: 'beta',
			from,
			to,
		});
		expect(target.editor.readCurrentText()).toBe(fullText);
		expect(target.editor.isTargetCurrent()).toBe(true);
		expect(isTargetCurrent).toHaveBeenCalledExactlyOnceWith(view);
		await expect(target.editor.readDiskText()).resolves.toBe(fullText);
		expect(target.editor.readEditorTexts()).toEqual([fullText]);
		expect(readers.readDiskText).toHaveBeenCalledExactlyOnceWith(file);
		expect(readers.readEditorTexts).toHaveBeenCalledExactlyOnceWith(file);
		target.editor.replaceRange('{~~beta~>delta~~}', from, to);
		expect(editor.replaceRange).toHaveBeenCalledExactlyOnceWith(
			'{~~beta~>delta~~}',
			{ offset: from },
			{ offset: to },
		);
	});

	it.each([
		['empty', ''],
		['whitespace', ' \n\t'],
	])('retains the %s selection error', (_label, selectedText) => {
		const fullText = `Before${selectedText}After`;
		const { view } = makeView(fullText, 6, 6 + selectedText.length);

		expect(() => captureSelectionEditTarget(
			view,
			() => true,
			makeFreshnessReaders(fullText),
		)).toThrow('Select non-whitespace text first.');
	});

	it('retains the saved-file error', () => {
		const { view } = makeView('Alpha beta', 0, 5);
		view.file = null;

		expect(() => captureSelectionEditTarget(
			view,
			() => true,
			makeFreshnessReaders('Alpha beta'),
		)).toThrow('Open a saved Markdown note first.');
	});
});

describe('getSelectionContext', () => {
	it('returns all surrounding text when it fits the budget', () => {
		const snapshot = makeSnapshot('Before beta after', 'beta');

		expect(getSelectionContext(snapshot, 100)).toEqual({
			before: 'Before ',
			after: ' after',
		});
	});

	it('bounds before and after context around the complete selection', () => {
		const sourceText = '0123456789'.repeat(10);
		const snapshot = makeSnapshot(sourceText, sourceText.slice(40, 50), 40);

		const context = getSelectionContext(snapshot, 20);

		expect(context).toEqual({
			before: sourceText.slice(35, 40),
			after: sourceText.slice(50, 55),
		});
		expect(snapshot.selectedText).toBe(sourceText.slice(40, 50));
	});

	it('redistributes unused context budget at the start of the note', () => {
		const sourceText = '0123456789'.repeat(10);
		const snapshot = makeSnapshot(sourceText, sourceText.slice(2, 4), 2);

		expect(getSelectionContext(snapshot, 10)).toEqual({
			before: sourceText.slice(0, 2),
			after: sourceText.slice(4, 10),
		});
	});

	it('never truncates a selection larger than the context budget', () => {
		const sourceText = '0123456789'.repeat(10);
		const selectedText = sourceText.slice(20, 80);
		const snapshot = makeSnapshot(sourceText, selectedText, 20);

		expect(getSelectionContext(snapshot, 20)).toEqual({ before: '', after: '' });
		expect(snapshot.selectedText).toHaveLength(60);
		expect(snapshot.selectedText).toBe(selectedText);
	});
});

describe('applyPreparedSelectionEdit', () => {
	it('replaces only the captured selection offsets and returns its summary items and summary', async () => {
		const snapshot = makeSnapshot();
		const { adapter } = makeAdapter(snapshot);
		const summaryItems = [{ type: 'replace', start: 0, end: 4 }] as const;
		const prepared: EditPreparation = {
			annotatedMarkdown: '{~~beta~>delta~~}',
			changeCount: 1,
			summaryItems,
			summary: 'Renamed beta to delta.',
		};

		const result = await applyPreparedSelectionEdit(
			'edit',
			snapshot,
			prepared,
			adapter,
		);

		expect(result).toEqual({
			applied: true,
			changeCount: 1,
			summaryItems,
			summary: 'Renamed beta to delta.',
		});
		expect(result.summaryItems).toBe(summaryItems);
		expect(adapter.readCurrentText).toHaveBeenCalledOnce();
		expect(adapter.readDiskText).toHaveBeenCalledOnce();
		expect(adapter.readEditorTexts).toHaveBeenCalledOnce();
		expect(adapter.isTargetCurrent).toHaveBeenCalledOnce();
		expect(adapter.replaceRange).toHaveBeenCalledExactlyOnceWith(
			'{~~beta~>delta~~}',
			snapshot.from,
			snapshot.to,
		);
	});

	it('replaces a complete multiline selection without changing its neighbors', async () => {
		const fullText = 'Before\nFirst\nSecond\nAfter';
		const snapshot = makeSnapshot(fullText, 'First\nSecond');
		const { adapter } = makeAdapter(snapshot);

		await applyPreparedSelectionEdit(
			'edit',
			snapshot,
			{ annotatedMarkdown: '{~~First\nSecond~>Combined lines~~}', changeCount: 1, summaryItems: [] },
			adapter,
		);

		expect(adapter.replaceRange).toHaveBeenCalledExactlyOnceWith(
			'{~~First\nSecond~>Combined lines~~}',
			snapshot.from,
			snapshot.to,
		);
	});

	it('does not re-read or replace an unchanged selection and returns no items but keeps the summary', async () => {
		const snapshot = makeSnapshot();
		const { adapter } = makeAdapter(snapshot);

		const result = await applyPreparedSelectionEdit(
			'edit',
			snapshot,
			{
				annotatedMarkdown: snapshot.selectedText,
				changeCount: 0,
				summaryItems: [{ type: 'replace', start: 0, end: 4 }],
				summary: 'Reviewed without changing the selection.',
			},
			adapter,
		);

		expect(result).toEqual({
			applied: false,
			changeCount: 0,
			summaryItems: [],
			summary: 'Reviewed without changing the selection.',
		});
		expect(adapter.readCurrentText).not.toHaveBeenCalled();
		expect(adapter.readDiskText).not.toHaveBeenCalled();
		expect(adapter.readEditorTexts).not.toHaveBeenCalled();
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('applies a valid comment-only selection edit with zero text changes and its comment item', async () => {
		const snapshot = makeSnapshot();
		const { adapter } = makeAdapter(snapshot);
		const commentItems = [{ type: 'comment', start: 0, end: 4 }] as const;

		const result = await applyPreparedSelectionEdit(
			'edit',
			snapshot,
			{
				annotatedMarkdown: 'beta{>>Review this.<<}',
				changeCount: 0,
				summaryItems: commentItems,
			},
			adapter,
		);

		expect(result).toEqual({
			applied: true,
			changeCount: 0,
			summaryItems: commentItems,
		});
		expect(adapter.replaceRange).toHaveBeenCalledOnce();
	});

	it('rejects without a result when the editor replacement fails', async () => {
		const snapshot = makeSnapshot();
		const { adapter } = makeAdapter(snapshot);
		const replaceError = new Error('Editor unavailable');
		adapter.replaceRange = vi.fn(() => {
			throw replaceError;
		});

		await expect(applyPreparedSelectionEdit(
			'edit',
			snapshot,
			{
				annotatedMarkdown: '{~~beta~>delta~~}',
				changeCount: 1,
				summaryItems: [{ type: 'replace', start: 0, end: 4 }],
			},
			adapter,
		)).rejects.toBe(replaceError);
	});

	it('rejects a captured-editor change outside the Selection even with a clean sibling', async () => {
		const snapshot = makeSnapshot();
		const { adapter, setCurrentText, setEditorTexts } = makeAdapter(snapshot);
		setCurrentText('# Note\nAlpha beta changed while waiting.\nEnd');
		setEditorTexts([snapshot.fullText]);

		await expect(applyPreparedSelectionEdit(
			'edit',
			snapshot,
			{ annotatedMarkdown: '{~~beta~>delta~~}', changeCount: 1, summaryItems: [] },
			adapter,
		)).rejects.toThrow(STALE_ERROR);
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('rejects disk-only divergence without replacing the selection', async () => {
		const snapshot = makeSnapshot();
		const { adapter, setDiskText } = makeAdapter(snapshot);
		setDiskText('# Note\nAlpha beta changed on disk.\nEnd');

		await expect(applyPreparedSelectionEdit(
			'edit',
			snapshot,
			{ annotatedMarkdown: '{~~beta~>delta~~}', changeCount: 1, summaryItems: [] },
			adapter,
		)).rejects.toThrow(STALE_ERROR);
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('rejects secondary-editor-only divergence without replacing the selection', async () => {
		const snapshot = makeSnapshot();
		const { adapter, setEditorTexts } = makeAdapter(snapshot);
		setEditorTexts([snapshot.fullText, `${snapshot.fullText}\nUnsaved sibling`]);

		await expect(applyPreparedSelectionEdit(
			'edit',
			snapshot,
			{ annotatedMarkdown: '{~~beta~>delta~~}', changeCount: 1, summaryItems: [] },
			adapter,
		)).rejects.toThrow(STALE_ERROR);
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('rejects a target-view switch without replacing the selection', async () => {
		const snapshot = makeSnapshot();
		const { adapter, setTargetCurrent } = makeAdapter(snapshot);
		setTargetCurrent(false);

		await expect(applyPreparedSelectionEdit(
			'edit',
			snapshot,
			{ annotatedMarkdown: '{~~beta~>delta~~}', changeCount: 1, summaryItems: [] },
			adapter,
		)).rejects.toThrow(STALE_ERROR);
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('does not replace when aborted immediately before application', async () => {
		const snapshot = makeSnapshot();
		const { adapter } = makeAdapter(snapshot);
		const controller = new AbortController();
		controller.abort();

		await expect(applyPreparedSelectionEdit(
			'edit',
			snapshot,
			{ annotatedMarkdown: '{~~beta~>delta~~}', changeCount: 1, summaryItems: [] },
			adapter,
			controller.signal,
		)).rejects.toMatchObject({ name: 'AbortError' });
		expect(adapter.readDiskText).not.toHaveBeenCalled();
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('does not replace when aborted while the disk read is pending', async () => {
		const snapshot = makeSnapshot();
		const { adapter } = makeAdapter(snapshot);
		const controller = new AbortController();
		let resolveDisk!: (text: string) => void;
		adapter.readDiskText = vi.fn(() => new Promise<string>((resolve) => {
			resolveDisk = resolve;
		}));

		const applying = applyPreparedSelectionEdit(
			'edit',
			snapshot,
			{ annotatedMarkdown: '{~~beta~>delta~~}', changeCount: 1, summaryItems: [] },
			adapter,
			controller.signal,
		);
		await vi.waitFor(() => expect(adapter.readDiskText).toHaveBeenCalledOnce());
		controller.abort();
		resolveDisk(snapshot.fullText);

		await expect(applying).rejects.toMatchObject({ name: 'AbortError' });
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('rechecks abort after the final target check without an intervening await', async () => {
		const snapshot = makeSnapshot();
		const { adapter } = makeAdapter(snapshot);
		const controller = new AbortController();
		adapter.isTargetCurrent = vi.fn(() => {
			controller.abort();
			return true;
		});

		await expect(applyPreparedSelectionEdit(
			'edit',
			snapshot,
			{ annotatedMarkdown: '{~~beta~>delta~~}', changeCount: 1, summaryItems: [] },
			adapter,
			controller.signal,
		)).rejects.toMatchObject({ name: 'AbortError' });
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('preserves matching CRLF text and captured offsets exactly', async () => {
		const snapshot = makeSnapshot('Before\r\nbeta\r\nAfter', 'beta');
		const { adapter, setEditorTexts } = makeAdapter(snapshot);
		setEditorTexts([snapshot.fullText]);

		await expect(applyPreparedSelectionEdit(
			'edit',
			snapshot,
			{ annotatedMarkdown: '{~~beta~>delta~~}', changeCount: 1, summaryItems: [] },
			adapter,
		)).resolves.toMatchObject({ applied: true, changeCount: 1 });
		expect(adapter.replaceRange).toHaveBeenCalledExactlyOnceWith(
			'{~~beta~>delta~~}',
			snapshot.from,
			snapshot.to,
		);
	});

	it.each(['ask', 'discuss', 'brainstorm'] as const)(
		'has no selection write path in %s mode',
		async (mode) => {
			const snapshot = makeSnapshot();
			const { adapter } = makeAdapter(snapshot);

			const result = await applyPreparedSelectionEdit(
				mode,
				snapshot,
				{
					annotatedMarkdown: '{--beta--}',
					changeCount: 1,
					summaryItems: [{ type: 'replace', start: 0, end: 4 }],
					summary: 'Model prose must not leak from a read-only path.',
				},
				adapter,
			);

			expect(result).toEqual({
				applied: false,
				changeCount: 0,
				summaryItems: [],
				summary: undefined,
			});
			expect(result.summary).toBeUndefined();
			expect(adapter.readCurrentText).not.toHaveBeenCalled();
			expect(adapter.readDiskText).not.toHaveBeenCalled();
			expect(adapter.readEditorTexts).not.toHaveBeenCalled();
			expect(adapter.replaceRange).not.toHaveBeenCalled();
		},
	);
});

describe('createSelectionEditorAdapter', () => {
	it('binds freshness readers to the captured file and converts offsets for editor.replaceRange', async () => {
		const snapshot = makeSnapshot();
		const { editor, file, view } = makeView(
			snapshot.fullText,
			snapshot.from,
			snapshot.to,
		);
		const isTargetCurrent = vi.fn(() => true);
		const readers = makeFreshnessReaders(snapshot.fullText);
		const adapter = createSelectionEditorAdapter(view, isTargetCurrent, readers);

		expect(adapter.readCurrentText()).toBe(snapshot.fullText);
		expect(adapter.isTargetCurrent()).toBe(true);
		await expect(adapter.readDiskText()).resolves.toBe(snapshot.fullText);
		expect(adapter.readEditorTexts()).toEqual([snapshot.fullText]);
		adapter.replaceRange('{~~beta~>delta~~}', snapshot.from, snapshot.to);

		expect(isTargetCurrent).toHaveBeenCalledExactlyOnceWith(view);
		expect(readers.readDiskText).toHaveBeenCalledExactlyOnceWith(file);
		expect(readers.readEditorTexts).toHaveBeenCalledExactlyOnceWith(file);
		expect(editor.offsetToPos).toHaveBeenCalledWith(snapshot.from);
		expect(editor.offsetToPos).toHaveBeenCalledWith(snapshot.to);
		expect(editor.replaceRange).toHaveBeenCalledExactlyOnceWith(
			'{~~beta~>delta~~}',
			{ offset: snapshot.from },
			{ offset: snapshot.to },
		);
	});

	it('rejects identity when the captured view now points at another file', () => {
		const snapshot = makeSnapshot();
		const { view } = makeView(snapshot.fullText, snapshot.from, snapshot.to);
		const adapter = createSelectionEditorAdapter(
			view,
			() => true,
			makeFreshnessReaders(snapshot.fullText),
		);
		view.file = markdownFile('other.md');

		expect(adapter.isTargetCurrent()).toBe(false);
	});
});

describe('buildSelectionUserPrompt', () => {
	it('keeps explicit Default Smart output byte-for-byte unchanged', () => {
		const fullText = '# Note\n\nAlpha beta gamma.\n\nEnd';
		const snapshot = makeSnapshot(fullText);

		expect(buildSelectionUserPrompt({
			snapshot,
			prompt: 'Improve this selection.',
			maxContextCharacters: 1000,
			smartSelectionContext: true,
			selectionContext: 'default',
			additionalNotes: [],
		})).toBe(
			`Selected text:\nbeta\n\nContext:\n${fullText}\n\nUser message:\nImprove this selection.`,
		);
	});

	it('keeps explicit Default Symmetric output byte-for-byte unchanged', () => {
		const fullText = '# Note\n\nAlpha beta gamma.\n\nEnd';
		const snapshot = makeSnapshot(fullText);

		expect(buildSelectionUserPrompt({
			snapshot,
			prompt: 'Improve this selection.',
			maxContextCharacters: 1000,
			smartSelectionContext: false,
			selectionContext: 'default',
			additionalNotes: [],
		})).toBe(
			'Selected text:\nbeta\n\nContext before:\n# Note\n\nAlpha \n\nContext after:\n gamma.\n\nEnd\n\nUser message:\nImprove this selection.',
		);
	});

	it.each([true, false])(
		'uses the complete long note and duplicate selection for Full note (smart=%s)',
		(smartSelectionContext) => {
			const selectedText = 'Target 选择 😀';
			const fullText = `Intro π\n\n${'Before 😀 '.repeat(30)}\n${selectedText}\n${'After λ\n'.repeat(30)}End`;
			const snapshot = makeSnapshot(fullText, selectedText);

			const prompt = buildSelectionUserPrompt({
				snapshot,
				prompt: 'Improve this selection.',
				maxContextCharacters: 40,
				smartSelectionContext,
				selectionContext: 'full-note',
				additionalNotes: [],
			});

			expect(fullText.length).toBeGreaterThan(40);
			expect(prompt).toBe(
				`Full note (supporting context):\n${fullText}\n\nSelected text (the only edit target):\n${selectedText}\n\nUser message:\nImprove this selection.`,
			);
			expect(prompt.match(/Target 选择 😀/g)).toHaveLength(2);
			expect(prompt).not.toContain('[...]');
			expect(prompt).not.toContain('Context before:');
			expect(prompt).not.toContain('Context after:');
		},
	);
});

function selectionRequest(response: string) {
	return vi.fn(
		async (
			_request: AiProviderRequest,
			callbacks: { onEvent(event: StreamEvent): void },
			_signal: AbortSignal,
		): Promise<StreamResult> => {
			for (const chunk of response.match(/.{1,5}/gs) ?? []) {
				callbacks.onEvent({ type: 'content', text: chunk });
			}
			return { content: response, reasoning: '' };
		},
	);
}

function makeSelectionCoordinator(
	request: ReturnType<typeof selectionRequest>,
	snapshot: SelectionSnapshot,
	instructions: InstructionPromptParts = { skillTexts: new Map() },
	providerConfig: ProviderConfig = provider,
) {
	const {
		adapter,
		setCurrentText,
		setDiskText,
		setEditorTexts,
		setTargetCurrent,
	} = makeAdapter(snapshot);
	const loadInstructions = vi.fn(async () => instructions);
	const loadAdditionalNotes = vi.fn(
		async (
			_paths: readonly string[],
			_activeNotePath: string,
			_signal: AbortSignal,
		): Promise<AdditionalNoteSnapshot[]> => [],
	);
	const coordinator = new SelectionEditRequestCoordinator({
		provider: providerConfig,
		loadAdditionalNotes,
		loadInstructions,
		request,
		editor: adapter,
		editStrategy: operationEditStrategy,
	});
	return {
		adapter,
		coordinator,
		loadAdditionalNotes,
		loadInstructions,
		request,
		setCurrentText,
		setDiskText,
		setEditorTexts,
		setTargetCurrent,
	};
}

function makeSelectionSubmission(
	snapshot: SelectionSnapshot,
	overrides: Partial<SelectionEditSubmission> = {},
): SelectionEditSubmission {
	return {
		snapshot,
		prompt: 'Improve this selection.',
		maxContextCharacters: 20,
		smartSelectionContext: true,
		selectionContext: 'default',
		additionalNotePaths: [],
		history: [],
		signal: new AbortController().signal,
		...overrides,
	};
}

describe('SelectionEditRequestCoordinator', () => {
	const replaceBetaResponse = JSON.stringify([
		{ type: 'replace', target: 'beta', replacement: 'delta' },
	]);

	it('requires an additional-note loader in its dependencies', () => {
		type Dependencies = ConstructorParameters<
			typeof SelectionEditRequestCoordinator
		>[0];

		expectTypeOf<Dependencies['loadAdditionalNotes']>().toEqualTypeOf<
			Required<Dependencies>['loadAdditionalNotes']
		>();
	});

	it('rejects an invalid context capacity before loading or replacing', async () => {
		const snapshot = makeSnapshot();
		const {
			adapter,
			coordinator,
			loadAdditionalNotes,
			loadInstructions,
			request,
		} = makeSelectionCoordinator(
			selectionRequest(replaceBetaResponse),
			snapshot,
			{ skillTexts: new Map() },
			invalidCapacityProvider,
		);

		const error = await coordinator
			.submit(makeSelectionSubmission(snapshot))
			.catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(ContextCapacityError);
		expect(error).toMatchObject({ code: 'invalid-context-capacity' });
		expect(loadAdditionalNotes).not.toHaveBeenCalled();
		expect(loadInstructions).not.toHaveBeenCalled();
		expect(request).not.toHaveBeenCalled();
		expect(adapter.readCurrentText).not.toHaveBeenCalled();
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('proceeds unchanged for a valid context capacity', async () => {
		const snapshot = makeSnapshot();
		const { adapter, coordinator, request } = makeSelectionCoordinator(
			selectionRequest('[]'),
			snapshot,
			{ skillTexts: new Map() },
			validCapacityProvider,
		);

		await expect(
			coordinator.submit(makeSelectionSubmission(snapshot)),
		).resolves.toMatchObject({ applied: false, changeCount: 0 });
		expect(request).toHaveBeenCalledOnce();
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('loads current instructions and uses the operation selection prompt', async () => {
		const snapshot = makeSnapshot();
		const instructions: InstructionPromptParts = {
			agentText: 'Agent instructions',
			skillTexts: new Map([['skills/review/SKILL.md', 'Review skill']]),
		};
		const { coordinator, loadInstructions, request } = makeSelectionCoordinator(
			selectionRequest('[]'),
			snapshot,
			instructions,
		);

		await coordinator.submit(makeSelectionSubmission(snapshot));
		await coordinator.submit(makeSelectionSubmission(snapshot));

		expect(loadInstructions).toHaveBeenCalledTimes(2);
		for (const call of request.mock.calls) {
			const systemPrompt = call[0].systemPrompt;
			expect(systemPrompt).toContain('bare JSON array');
			expect(systemPrompt).toContain('selected portion');
			expect(systemPrompt).not.toContain('Return the COMPLETE note');
			expect(systemPrompt.indexOf('Review skill')).toBeLessThan(
				systemPrompt.indexOf('Agent instructions'),
			);
		}
	});

	it('loads exact additional-note paths before instructions and places labelled context before the message', async () => {
		const snapshot = makeSnapshot();
		const order: string[] = [];
		const request = selectionRequest('[]');
		const originalRequest = request.getMockImplementation();
		request.mockImplementation(async (...args) => {
			order.push('request');
			return originalRequest?.(...args) ?? { content: '[]', reasoning: '' };
		});
		const { coordinator, loadAdditionalNotes, loadInstructions } =
			makeSelectionCoordinator(request, snapshot);
		loadAdditionalNotes.mockImplementation(async () => {
			order.push('additional notes');
			return [{
				sourcePath: 'Reference.md',
				providerPath: 'Vault/Reference.md',
				markdown: 'Additional only.',
				sourceCharacters: 16,
				includedCharacters: 16,
			}];
		});
		loadInstructions.mockImplementation(async () => {
			order.push('instructions');
			return { skillTexts: new Map() };
		});
		const additionalNotePaths = ['Reference.md'];
		const submission = makeSelectionSubmission(snapshot, { additionalNotePaths });

		await coordinator.submit(submission);

		expect(loadAdditionalNotes).toHaveBeenCalledExactlyOnceWith(
			additionalNotePaths,
			'folder/note.md',
			submission.signal,
		);
		expect(order).toEqual(['additional notes', 'instructions', 'request']);
		const userPrompt = request.mock.calls[0]?.[0].userPrompt ?? '';
		expect(userPrompt.indexOf('Selected text:')).toBeLessThan(
			userPrompt.indexOf('## Additional note 1'),
		);
		expect(userPrompt.indexOf('Context:')).toBeLessThan(
			userPrompt.indexOf('## Additional note 1'),
		);
		expect(userPrompt.indexOf('## Additional note 1')).toBeLessThan(
			userPrompt.indexOf('User message:'),
		);
		expect(userPrompt).toContain('Path: Vault/Reference.md');
		expect(userPrompt).toContain('Additional only.');
	});

	it('omits additional-note sections when no paths are selected', async () => {
		const snapshot = makeSnapshot();
		const { coordinator, loadAdditionalNotes, request } =
			makeSelectionCoordinator(selectionRequest('[]'), snapshot);
		const submission = makeSelectionSubmission(snapshot);

		await coordinator.submit(submission);

		expect(loadAdditionalNotes).toHaveBeenCalledExactlyOnceWith(
			[],
			'folder/note.md',
			submission.signal,
		);
		expect(request.mock.calls[0]?.[0].userPrompt).not.toContain(
			'## Additional note',
		);
	});

	it('restores Stage 09 symmetric context when smart context is disabled', async () => {
		const sourceText = '0123456789'.repeat(10);
		const snapshot = makeSnapshot(sourceText, sourceText.slice(40, 50), 40);
		const { coordinator, request } = makeSelectionCoordinator(
			selectionRequest('[]'),
			snapshot,
		);

		await coordinator.submit(
			makeSelectionSubmission(snapshot, {
				notePath: 'Vault/folder/note.md',
				smartSelectionContext: false,
			}),
		);

		const providerRequest = request.mock.calls[0]?.[0];
		const userPrompt = providerRequest?.userPrompt ?? '';
		expect(userPrompt).toContain('Vault/folder/note.md');
		expect(userPrompt).toContain(`Selected text:\n${snapshot.selectedText}`);
		expect(userPrompt).toContain(`Context before:\n${sourceText.slice(35, 40)}`);
		expect(userPrompt).toContain(`Context after:\n${sourceText.slice(50, 55)}`);
		expect(userPrompt).not.toContain('Context:\n');
		expect(userPrompt).toContain('Improve this selection.');
		expect(userPrompt).not.toContain(sourceText);
		expect(providerRequest?.history).toEqual([]);
	});

	it('sends full-paragraph smart context while replacing only the exact target', async () => {
		const paragraph = 'A long sentence with beta and more words.';
		const sourceText = `Before paragraph.\n\n${paragraph}\n\nAfter paragraph.`;
		const snapshot = makeSnapshot(sourceText, 'beta');
		const { adapter, coordinator, request } = makeSelectionCoordinator(
			selectionRequest(replaceBetaResponse),
			snapshot,
		);

		await coordinator.submit(
			makeSelectionSubmission(snapshot, {
				maxContextCharacters: paragraph.length,
			}),
		);

		const userPrompt = request.mock.calls[0]?.[0].userPrompt ?? '';
		expect(userPrompt).toContain(`Selected text:\nbeta`);
		expect(userPrompt).toContain(`Context:\n[...]\n${paragraph}\n[...]`);
		expect(userPrompt).not.toContain('Context before:');
		expect(userPrompt).not.toContain(sourceText);
		expect(adapter.replaceRange).toHaveBeenCalledExactlyOnceWith(
			'{~~beta~>delta~~}',
			snapshot.from,
			snapshot.to,
		);
	});

	it('never truncates an oversized selection in the provider request', async () => {
		const sourceText = '0123456789'.repeat(10);
		const selectedText = sourceText.slice(20, 80);
		const snapshot = makeSnapshot(sourceText, selectedText, 20);
		const { coordinator, request } = makeSelectionCoordinator(
			selectionRequest('[]'),
			snapshot,
		);

		await coordinator.submit(
			makeSelectionSubmission(snapshot, {
				maxContextCharacters: 20,
				smartSelectionContext: false,
			}),
		);

		const userPrompt = request.mock.calls[0]?.[0].userPrompt ?? '';
		expect(userPrompt).toContain(`Selected text:\n${selectedText}`);
		expect(userPrompt).toContain('Context before:\n\n\nContext after:');
	});

	it('rejects Full-note-context Operations anchored only outside the selection without native replacement', async () => {
		const snapshot = makeSnapshot('Outside only\nAlpha beta gamma.', 'beta');
		const { adapter, coordinator, request } = makeSelectionCoordinator(
			selectionRequest(JSON.stringify([
				{ type: 'replace', target: 'Outside only', replacement: 'Changed' },
			])),
			snapshot,
		);

		await expect(coordinator.submit(makeSelectionSubmission(snapshot, {
			selectionContext: 'full-note',
		}))).rejects.toThrow(/not found|match/i);

		expect(request).toHaveBeenCalledTimes(2);
		expect(request.mock.calls[0]?.[0].userPrompt).toContain(
			`Full note (supporting context):\n${snapshot.fullText}`,
		);
		expect(adapter.readCurrentText).not.toHaveBeenCalled();
		expect(adapter.replaceRange).not.toHaveBeenCalled();
		expect(snapshot.fullText).toBe('Outside only\nAlpha beta gamma.');
	});

	it('validates and applies only the returned annotated selection', async () => {
		const snapshot = makeSnapshot();
		const { adapter, coordinator } = makeSelectionCoordinator(
			selectionRequest(replaceBetaResponse),
			snapshot,
		);

		const result = await coordinator.submit(makeSelectionSubmission(snapshot));

		expect(result).toMatchObject({
			applied: true,
			changeCount: 1,
			usage: { source: 'estimated' },
		});
		expect(result.summary).toBeUndefined();
		expect(adapter.replaceRange).toHaveBeenCalledExactlyOnceWith(
			'{~~beta~>delta~~}',
			snapshot.from,
			snapshot.to,
		);
	});

	it.each(['disk', 'secondary editor'] as const)(
		'keeps %s divergence terminal without a correction request',
		async (divergence) => {
			const snapshot = makeSnapshot();
			const {
				adapter,
				coordinator,
				request,
				setDiskText,
				setEditorTexts,
			} = makeSelectionCoordinator(selectionRequest(replaceBetaResponse), snapshot);
			if (divergence === 'disk') {
				setDiskText('# Note\nAlpha beta changed on disk.\nEnd');
			} else {
				setEditorTexts([`${snapshot.fullText}\nUnsaved sibling`]);
			}

			await expect(
				coordinator.submit(makeSelectionSubmission(snapshot)),
			).rejects.toThrow(STALE_ERROR);
			expect(request).toHaveBeenCalledOnce();
			expect(adapter.replaceRange).not.toHaveBeenCalled();
		},
	);

	it('returns the successful candidate summary and never the rejected one', async () => {
		const snapshot = makeSnapshot();
		const invalidResponse = JSON.stringify({
			summary: 'Rejected summary.',
			operations: [{ type: 'remove', target: 'missing' }],
		});
		const validResponse = JSON.stringify({
			summary: 'Renamed beta to delta.',
			operations: [{ type: 'replace', target: 'beta', replacement: 'delta' }],
		});
		const request = selectionRequest('');
		request
			.mockResolvedValueOnce({ content: invalidResponse, reasoning: '' })
			.mockResolvedValueOnce({ content: validResponse, reasoning: '' });
		const { adapter, coordinator } = makeSelectionCoordinator(request, snapshot);

		const result = await coordinator.submit(makeSelectionSubmission(snapshot));

		expect(request).toHaveBeenCalledTimes(2);
		expect(result).toMatchObject({
			applied: true,
			changeCount: 1,
			summary: 'Renamed beta to delta.',
		});
		expect(result.summaryItems).toEqual([{ type: 'replace', start: 0, end: 4 }]);
		expect(adapter.replaceRange).toHaveBeenCalledExactlyOnceWith(
			'{~~beta~>delta~~}',
			snapshot.from,
			snapshot.to,
		);
	});

	it.each(QUICK_ACTIONS)(
		'$id uses the same additional-note selection path',
		async (action) => {
			const snapshot = makeSnapshot();
			const { coordinator, loadAdditionalNotes, request } =
				makeSelectionCoordinator(selectionRequest('[]'), snapshot);
			loadAdditionalNotes.mockResolvedValue([{
				sourcePath: 'Reference.md',
				markdown: 'Additional only.',
				sourceCharacters: 16,
				includedCharacters: 16,
			}]);
			const additionalNotePaths = ['Reference.md'];
			const submission = makeSelectionSubmission(snapshot, {
				prompt: action.prompt,
				additionalNotePaths,
			});

			await coordinator.submit(submission);

			expect(loadAdditionalNotes).toHaveBeenCalledExactlyOnceWith(
				additionalNotePaths,
				'folder/note.md',
				submission.signal,
			);
			const userPrompt = request.mock.calls[0]?.[0].userPrompt ?? '';
			expect(userPrompt).toContain('## Additional note 1');
			expect(userPrompt).toContain(`User message:\n${action.prompt}`);
		},
	);

	it('rejects an Operation target found only in an additional note without replacing', async () => {
		const snapshot = makeSnapshot();
		const additionalNote: AdditionalNoteSnapshot = {
			sourcePath: 'Reference.md',
			markdown: 'Additional only.',
			sourceCharacters: 16,
			includedCharacters: 16,
		};
		const originalAdditionalMarkdown = additionalNote.markdown;
		const request = selectionRequest(JSON.stringify([
			{ type: 'replace', target: 'Additional only', replacement: 'Changed' },
		]));
		const { adapter, coordinator, loadAdditionalNotes } =
			makeSelectionCoordinator(request, snapshot);
		loadAdditionalNotes.mockResolvedValue([additionalNote]);

		await expect(
			coordinator.submit(makeSelectionSubmission(snapshot, {
				additionalNotePaths: ['Reference.md'],
			})),
		).rejects.toThrow(/not found|match/i);

		expect(request).toHaveBeenCalledTimes(2);
		expect(adapter.readCurrentText).not.toHaveBeenCalled();
		expect(adapter.replaceRange).not.toHaveBeenCalled();
		expect(snapshot.fullText).toBe('# Note\nAlpha beta gamma.\nEnd');
		expect(additionalNote.markdown).toBe(originalAdditionalMarkdown);
	});

	it('applies an active-selection insertion without changing additional-note text', async () => {
		const snapshot = makeSnapshot();
		const additionalNote: AdditionalNoteSnapshot = {
			sourcePath: 'Reference.md',
			markdown: 'Additional only.',
			sourceCharacters: 16,
			includedCharacters: 16,
		};
		const request = selectionRequest(JSON.stringify([
			{ type: 'insert', anchor: 'beta', position: 'after', text: ' changed' },
		]));
		const { adapter, coordinator, loadAdditionalNotes } =
			makeSelectionCoordinator(request, snapshot);
		loadAdditionalNotes.mockResolvedValue([additionalNote]);

		await expect(
			coordinator.submit(makeSelectionSubmission(snapshot, {
				additionalNotePaths: ['Reference.md'],
			})),
		).resolves.toMatchObject({
			applied: true,
			changeCount: 1,
			usage: { source: 'estimated' },
		});

		expect(adapter.replaceRange).toHaveBeenCalledExactlyOnceWith(
			'beta{++ changed++}',
			snapshot.from,
			snapshot.to,
		);
		expect(additionalNote.markdown).toBe('Additional only.');
	});

	it('returns a no-op result with usage for modal-style submissions without callbacks', async () => {
		const snapshot = makeSnapshot();
		const { adapter, coordinator } = makeSelectionCoordinator(
			selectionRequest('[]'),
			snapshot,
		);

		await expect(
			coordinator.submit(makeSelectionSubmission(snapshot)),
		).resolves.toMatchObject({
			applied: false,
			changeCount: 0,
			summaryItems: [],
			usage: { source: 'estimated' },
		});
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('forwards reasoning and returns provider usage without changing the edit result', async () => {
		const snapshot = makeSnapshot();
		const request = vi.fn(async (
			_request: AiProviderRequest,
			callbacks: { onEvent(event: StreamEvent): void },
		): Promise<StreamResult> => {
			callbacks.onEvent({ type: 'reasoning', text: 'Consider ' });
			callbacks.onEvent({ type: 'reasoning', text: 'the selection.' });
			callbacks.onEvent({ type: 'content', text: replaceBetaResponse });
			return {
				content: replaceBetaResponse,
				reasoning: 'Consider the selection.',
				usage: { promptTokens: 11, completionTokens: 5, totalTokens: 16 },
			};
		});
		const { coordinator } = makeSelectionCoordinator(request, snapshot);
		const onReasoning = vi.fn();
		const onRetry = vi.fn();

		const result = await coordinator.submit(makeSelectionSubmission(snapshot, {
			callbacks: { onReasoning, onRetry },
		}));

		expect(onReasoning.mock.calls).toEqual([
			['Consider '],
			['the selection.'],
		]);
		expect(onRetry).not.toHaveBeenCalled();
		expect(result).toEqual({
			applied: true,
			changeCount: 1,
			summaryItems: [{ type: 'replace', start: 0, end: 4 }],
			usage: {
				promptTokens: 11,
				completionTokens: 5,
				totalTokens: 16,
				source: 'provider',
			},
		});
		expect(request.mock.calls[0]?.[0].history).toEqual([]);
	});

	it('sends the captured ready history and counts it in estimated usage', async () => {
		const snapshot = makeSnapshot();
		const { coordinator, request } = makeSelectionCoordinator(
			selectionRequest(replaceBetaResponse),
			snapshot,
		);
		const history: ProviderHistoryMessage[] = Array.from(
			{ length: 12 },
			(_, index) => ({
				role: index % 2 === 0 ? 'user' : 'assistant',
				content: `ready ${index}`,
				mode: 'ask',
				origin: index % 2 === 0 ? 'user' : 'model',
			}),
		);

		const result = await coordinator.submit(
			makeSelectionSubmission(snapshot, { history }),
		);

		const requestArg = request.mock.calls[0]?.[0];
		if (!requestArg) {
			throw new Error('Provider request missing.');
		}
		expect(requestArg.history).toEqual(history);
		const historyCharacters = formatProviderHistory(requestArg.history).reduce(
			(sum, item) => sum + item.content.length,
			0,
		);
		const promptTokens = Math.max(
			1,
			Math.ceil(
				(requestArg.systemPrompt.length +
					requestArg.userPrompt.length +
					historyCharacters) /
					4,
			),
		);
		const completionTokens = Math.max(
			1,
			Math.ceil(replaceBetaResponse.length / 4),
		);
		expect(result.usage).toEqual({
			promptTokens,
			completionTokens,
			totalTokens: promptTokens + completionTokens,
			source: 'estimated',
		});
		expect(result.usage.promptTokens).toBeGreaterThan(
			Math.max(
				1,
				Math.ceil(
					(requestArg.systemPrompt.length + requestArg.userPrompt.length) / 4,
				),
			),
		);
	});

	it('notifies retry and sums provider usage across two correction rounds', async () => {
		const snapshot = makeSnapshot();
		const request = selectionRequest('not-json')
			.mockResolvedValueOnce({
				content: 'not-json',
				reasoning: 'invalid attempt',
				usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
			})
			.mockResolvedValueOnce({
				content: replaceBetaResponse,
				reasoning: 'corrected attempt',
				usage: { promptTokens: 20, completionTokens: 3, totalTokens: 23 },
			});
		const { coordinator } = makeSelectionCoordinator(request, snapshot);
		const onRetry = vi.fn();

		const result = await coordinator.submit(makeSelectionSubmission(snapshot, {
			callbacks: { onRetry },
		}));

		expect(onRetry).toHaveBeenCalledOnce();
		expect(result).toEqual({
			applied: true,
			changeCount: 1,
			summaryItems: [{ type: 'replace', start: 0, end: 4 }],
			usage: {
				promptTokens: 30,
				completionTokens: 5,
				totalTokens: 35,
				source: 'provider',
			},
		});
		expect(request).toHaveBeenCalledTimes(2);
		expect(request.mock.calls.map((call) => call[0].history)).toEqual([[], []]);
	});

	it('estimates every round when any correction round lacks provider usage', async () => {
		const snapshot = makeSnapshot();
		const request = selectionRequest('not-json')
			.mockResolvedValueOnce({
				content: 'not-json',
				reasoning: 'bad',
				usage: { promptTokens: 999, completionTokens: 999, totalTokens: 1998 },
			})
			.mockResolvedValueOnce({
				content: replaceBetaResponse,
				reasoning: 'good',
			});
		const { coordinator } = makeSelectionCoordinator(request, snapshot);

		const result = await coordinator.submit(makeSelectionSubmission(snapshot));

		const firstRequest = request.mock.calls[0]?.[0];
		const secondRequest = request.mock.calls[1]?.[0];
		if (!firstRequest || !secondRequest) {
			throw new Error('Correction requests missing.');
		}
		const firstPromptTokens = Math.max(1, Math.ceil(
			(firstRequest.systemPrompt.length + firstRequest.userPrompt.length) / 4,
		));
		const continuationCharacters = (secondRequest.continuation ?? []).reduce(
			(sum, message) => sum + message.content.length,
			0,
		);
		const secondPromptTokens = Math.max(1, Math.ceil(
			(secondRequest.systemPrompt.length + secondRequest.userPrompt.length +
				continuationCharacters) / 4,
		));
		const firstCompletionTokens = Math.max(1, Math.ceil(
			('not-json'.length + 'bad'.length) / 4,
		));
		const secondCompletionTokens = Math.max(1, Math.ceil(
			(replaceBetaResponse.length + 'good'.length) / 4,
		));
		const promptTokens = firstPromptTokens + secondPromptTokens;
		const completionTokens = firstCompletionTokens + secondCompletionTokens;
		expect(result).toEqual({
			applied: true,
			changeCount: 1,
			summaryItems: [{ type: 'replace', start: 0, end: 4 }],
			usage: {
				promptTokens,
				completionTokens,
				totalTokens: promptTokens + completionTokens,
				source: 'estimated',
			},
		});
	});

	it('rejects invalid output before reading or replacing', async () => {
		const snapshot = makeSnapshot();
		const { adapter, coordinator } = makeSelectionCoordinator(
			selectionRequest('An unannotated replacement.'),
			snapshot,
		);

		await expect(
			coordinator.submit(makeSelectionSubmission(snapshot)),
		).rejects.toThrow(
			'Operation edit response must be a bare JSON array of operations or an envelope object with operations and an optional summary.',
		);
		expect(adapter.readCurrentText).not.toHaveBeenCalled();
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it.each(['provider error', 'abort'])(
		'does not replace after a %s',
		async (failure) => {
			const snapshot = makeSnapshot();
			const error =
				failure === 'abort'
					? new DOMException('Stopped', 'AbortError')
					: new Error('Provider unavailable');
			const request = vi.fn(async () => {
				throw error;
			});
			const { adapter, coordinator } = makeSelectionCoordinator(
				request,
				snapshot,
			);

			await expect(
				coordinator.submit(makeSelectionSubmission(snapshot)),
			).rejects.toBe(error);
			expect(adapter.readCurrentText).not.toHaveBeenCalled();
			expect(adapter.replaceRange).not.toHaveBeenCalled();
		},
	);

	it('does not replace when aborted after streaming but before application', async () => {
		const snapshot = makeSnapshot();
		const controller = new AbortController();
		const request = vi.fn(
			async (
				_request: AiProviderRequest,
				callbacks: { onEvent(event: StreamEvent): void },
			): Promise<StreamResult> => {
				callbacks.onEvent({ type: 'content', text: replaceBetaResponse });
				controller.abort();
				return { content: replaceBetaResponse, reasoning: '' };
			},
		);
		const { adapter, coordinator } = makeSelectionCoordinator(request, snapshot);

		await expect(
			coordinator.submit(
				makeSelectionSubmission(snapshot, { signal: controller.signal }),
			),
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(adapter.readCurrentText).not.toHaveBeenCalled();
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('rejects a selection inside fenced code without reading or replacing', async () => {
		const snapshot = makeSnapshot('Before\n```\nalpha\n```\nAfter', 'alpha');
		const request = selectionRequest(JSON.stringify([{ type: 'remove', target: 'alpha' }]));
		const { adapter, coordinator } = makeSelectionCoordinator(request, snapshot);

		await expect(coordinator.submit(makeSelectionSubmission(snapshot))).rejects.toMatchObject({
			code: 'fenced-code-edit',
			line: 3,
		});
		expect(request).toHaveBeenCalledTimes(2);
		expect(adapter.readCurrentText).not.toHaveBeenCalled();
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('uses absolute selection offsets for inline-code guards without expanding the target', async () => {
		const snapshot = makeSnapshot('Before `alpha` after', 'alpha');
		const request = selectionRequest(JSON.stringify([
			{ type: 'replace', target: 'alpha', replacement: 'beta' },
		]));
		const { adapter, coordinator } = makeSelectionCoordinator(request, snapshot);

		await expect(coordinator.submit(makeSelectionSubmission(snapshot))).rejects.toMatchObject({
			code: 'inline-code-range',
			line: 1,
		});
		expect(request).toHaveBeenCalledTimes(2);
		expect(snapshot.selectedText).toBe('alpha');
		expect(snapshot.fullText).toBe('Before `alpha` after');
		expect(adapter.readCurrentText).not.toHaveBeenCalled();
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('applies a complete inline-code span selection at its original offsets', async () => {
		const snapshot = makeSnapshot('Before `alpha` after', '`alpha`');
		const request = selectionRequest(JSON.stringify([
			{ type: 'replace', target: '`alpha`', replacement: '`beta`' },
		]));
		const { adapter, coordinator } = makeSelectionCoordinator(request, snapshot);

		await expect(coordinator.submit(makeSelectionSubmission(snapshot))).resolves.toMatchObject({
			applied: true,
			changeCount: 1,
			usage: { source: 'estimated' },
		});
		expect(adapter.replaceRange).toHaveBeenCalledExactlyOnceWith(
			'{~~`alpha`~>`beta`~~}',
			snapshot.from,
			snapshot.to,
		);
	});

	it('corrects one invalid response against the same selection and replaces minimal markup once', async () => {
		const fullText = '# Note\nThey have a plan.\nEnd';
		const snapshot = makeSnapshot(fullText, 'They have a plan.');
		const validResponse = JSON.stringify([
			{
				type: 'replace',
				target: 'They have a plan.',
				replacement: 'They has a plan.',
			},
		]);
		const request = selectionRequest('not-json')
			.mockResolvedValueOnce({ content: 'not-json', reasoning: '' })
			.mockResolvedValueOnce({ content: validResponse, reasoning: '' });
		const { adapter, coordinator, loadAdditionalNotes, loadInstructions } =
			makeSelectionCoordinator(request, snapshot);
		loadAdditionalNotes.mockResolvedValue([{
			sourcePath: 'Reference.md',
			markdown: 'Additional only.',
			sourceCharacters: 16,
			includedCharacters: 16,
		}]);
		const submission = makeSelectionSubmission(snapshot, {
			maxContextCharacters: 1000,
			additionalNotePaths: ['Reference.md'],
		});

		const result = await coordinator.submit(submission);

		expect(result).toMatchObject({
			applied: true,
			changeCount: 1,
			usage: { source: 'estimated' },
		});
		expect(result.summaryItems).toEqual([{
			type: 'replace',
			start: 0,
			end: snapshot.selectedText.length,
		}]);
		expect(request).toHaveBeenCalledTimes(2);
		expect(loadAdditionalNotes).toHaveBeenCalledOnce();
		expect(loadInstructions).toHaveBeenCalledOnce();
		expect(adapter.readCurrentText).toHaveBeenCalledOnce();
		expect(adapter.replaceRange).toHaveBeenCalledExactlyOnceWith(
			'They {~~have~>has~~} a plan.',
			snapshot.from,
			snapshot.to,
		);
		const firstRequest = request.mock.calls[0]?.[0];
		const secondRequest = request.mock.calls[1]?.[0];
		if (!firstRequest || !secondRequest) {
			throw new Error('Correction request missing.');
		}
		expect(firstRequest.userPrompt).toContain(
			`Selected text:\n${snapshot.selectedText}`,
		);
		expect(firstRequest.userPrompt).toContain('Additional only.');
		const { continuation, ...correctionBaseRequest } = secondRequest;
		expect(correctionBaseRequest).toEqual(firstRequest);
		expect(continuation?.[0]).toEqual({ role: 'assistant', content: 'not-json' });
		expect(continuation?.[1]?.content).toContain('Return only a new complete JSON array of operations, or an envelope object with operations and an optional summary, against the unchanged original snapshot.');
		expect(continuation?.[1]?.content).toContain('"code":"invalid-json"');
	});

	it.each(['provider error', 'abort'])(
		'does not read or replace after a second-round %s',
		async (failure) => {
			const snapshot = makeSnapshot();
			const controller = new AbortController();
			const error = failure === 'abort'
				? new DOMException('Stopped', 'AbortError')
				: new Error('Provider unavailable');
			const request = selectionRequest('not-json')
				.mockResolvedValueOnce({ content: 'not-json', reasoning: '' })
				.mockImplementationOnce(async () => {
					if (failure === 'abort') {
						controller.abort();
					}
					throw error;
				});
			const { adapter, coordinator } = makeSelectionCoordinator(request, snapshot);

			await expect(coordinator.submit(makeSelectionSubmission(snapshot, {
				signal: controller.signal,
			}))).rejects.toBe(error);

			expect(request).toHaveBeenCalledTimes(2);
			expect(adapter.readCurrentText).not.toHaveBeenCalled();
			expect(adapter.replaceRange).not.toHaveBeenCalled();
		},
	);

	it.each(['stale source', 'target switch'])(
		'keeps a corrected selection terminal after a %s',
		async (failure) => {
			const snapshot = makeSnapshot();
			const request = selectionRequest('not-json')
				.mockResolvedValueOnce({ content: 'not-json', reasoning: '' })
				.mockResolvedValueOnce({ content: replaceBetaResponse, reasoning: '' });
			const {
				adapter,
				coordinator,
				setCurrentText,
				setTargetCurrent,
			} = makeSelectionCoordinator(request, snapshot);
			if (failure === 'stale source') {
				setCurrentText('# Note\nAlpha beta changed.\nEnd');
			} else {
				setTargetCurrent(false);
			}

			await expect(
				coordinator.submit(makeSelectionSubmission(snapshot)),
			).rejects.toThrow(STALE_ERROR);

			expect(request).toHaveBeenCalledTimes(2);
			expect(adapter.readCurrentText).toHaveBeenCalledOnce();
			expect(adapter.replaceRange).not.toHaveBeenCalled();
		},
	);

	it.each([
		{ label: 'insertion with UTF-16 offsets', fullText: '😀a{++inside++}b', selectedText: 'inside' },
		{ label: 'deletion', fullText: 'a{--inside--}b', selectedText: 'inside' },
		{ label: 'substitution old side', fullText: 'a{~~before~>after~~}b', selectedText: 'before' },
		{ label: 'substitution new side', fullText: 'a{~~before~>after~~}b', selectedText: 'after' },
		{ label: 'comment', fullText: 'a{>>note<<}b', selectedText: 'note' },
		{ label: 'highlight', fullText: 'a{==marked==}b', selectedText: 'marked' },
	])('terminates a changed candidate strictly inside an $label token', async ({
		fullText,
		selectedText,
	}) => {
		const snapshot = makeSnapshot(fullText, selectedText);
		const originalSnapshot = { ...snapshot };
		const nestingResponse = JSON.stringify([
			{ type: 'replace', target: selectedText, replacement: `${selectedText} changed` },
		]);
		const request = selectionRequest(nestingResponse);
		const { adapter, coordinator } = makeSelectionCoordinator(request, snapshot);
		const onRetry = vi.fn();

		const error = await coordinator
			.submit(makeSelectionSubmission(snapshot, { callbacks: { onRetry } }))
			.catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(EditResponseValidationError);
		expect(error).toMatchObject({
			code: 'in-token-selection',
			message: IN_TOKEN_SELECTION_ERROR,
			correctionEligible: false,
		});
		expect(request).toHaveBeenCalledTimes(1);
		expect(request.mock.calls[0]?.[0].continuation).toBeUndefined();
		expect(onRetry).not.toHaveBeenCalled();
		expectNoFreshnessOrWrite(adapter);
		expect(snapshot).toEqual(originalSnapshot);
		expect(snapshot.fullText).toBe(fullText);
	});

	it.each([
		{ label: 'empty operations', response: '[]' },
		{
			label: 'unchanged replacement',
			response: JSON.stringify([{ type: 'replace', target: 'x', replacement: 'x' }]),
		},
	])('keeps a strict in-token $label response as a successful no-op', async ({
		response,
	}) => {
		const snapshot = makeSnapshot('a{++x++}b', 'x');
		const originalSnapshot = { ...snapshot };
		const request = selectionRequest(response).mockResolvedValueOnce({
			content: response,
			reasoning: '',
			usage: { promptTokens: 11, completionTokens: 3, totalTokens: 14 },
		});
		const { adapter, coordinator } = makeSelectionCoordinator(request, snapshot);
		const onRetry = vi.fn();

		const result = await coordinator.submit(
			makeSelectionSubmission(snapshot, { callbacks: { onRetry } }),
		);

		expect(result).toEqual({
			applied: false,
			changeCount: 0,
			summaryItems: [],
			summary: undefined,
			usage: {
				promptTokens: 11,
				completionTokens: 3,
				totalTokens: 14,
				source: 'provider',
			},
		});
		expect(request).toHaveBeenCalledTimes(1);
		expect(request.mock.calls[0]?.[0].continuation).toBeUndefined();
		expect(onRetry).not.toHaveBeenCalled();
		expectNoFreshnessOrWrite(adapter);
		expect(snapshot).toEqual(originalSnapshot);
	});

	it('keeps delimiter-fragment source validation ahead of in-token classification', async () => {
		const snapshot = makeSnapshot('a{++x++}b', 'x++}');
		const request = selectionRequest('[]');
		const { adapter, coordinator } = makeSelectionCoordinator(request, snapshot);
		const onRetry = vi.fn();

		const error = await coordinator
			.submit(makeSelectionSubmission(snapshot, { callbacks: { onRetry } }))
			.catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({
			name: 'EditSourceValidationError',
			message: 'The original snapshot contains invalid CriticMarkup; fix the existing markup before requesting edits.',
		});
		expect(request).toHaveBeenCalledTimes(1);
		expect(onRetry).not.toHaveBeenCalled();
		expectNoFreshnessOrWrite(adapter);
	});

	it('corrects malformed JSON once then terminates a strict changed candidate', async () => {
		const snapshot = makeSnapshot('a{++x++}b', 'x');
		const nestingResponse = JSON.stringify([
			{ type: 'replace', target: 'x', replacement: 'y' },
		]);
		const request = selectionRequest('not-json')
			.mockResolvedValueOnce({ content: 'not-json', reasoning: 'invalid attempt' })
			.mockResolvedValueOnce({ content: nestingResponse, reasoning: 'rejected attempt' });
		const { adapter, coordinator } = makeSelectionCoordinator(request, snapshot);
		const onRetry = vi.fn();

		const error = await coordinator
			.submit(makeSelectionSubmission(snapshot, { callbacks: { onRetry } }))
			.catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({
			code: 'in-token-selection',
			message: IN_TOKEN_SELECTION_ERROR,
			correctionEligible: false,
		});
		expect(request).toHaveBeenCalledTimes(2);
		expect(onRetry).toHaveBeenCalledOnce();
		expect(request.mock.calls[0]?.[0].continuation).toBeUndefined();
		expect(request.mock.calls[1]?.[0].continuation).toHaveLength(2);
		expect(request.mock.calls[1]?.[0].continuation?.[0]).toEqual({
			role: 'assistant',
			content: 'not-json',
		});
		expect(request.mock.calls[1]?.[0].continuation?.[1]?.content).toContain(
			'"code":"invalid-json"',
		);
		expectNoFreshnessOrWrite(adapter);
	});

	it('applies the corrected candidate after composed-markup rejection', async () => {
		const fullText = 'a{++x++}b';
		const snapshot = makeSnapshot(fullText, 'a{');
		const boundaryInsertion = JSON.stringify([
			{ type: 'insert', anchor: 'a{', position: 'after', text: 'p' },
		]);
		const corrected = JSON.stringify([
			{ type: 'insert', anchor: 'a', position: 'before', text: 'p' },
		]);
		const request = selectionRequest(boundaryInsertion)
			.mockResolvedValueOnce({ content: boundaryInsertion, reasoning: '' })
			.mockResolvedValueOnce({ content: corrected, reasoning: '' });
		const { adapter, coordinator } = makeSelectionCoordinator(request, snapshot);
		const onRetry = vi.fn();

		const result = await coordinator.submit(
			makeSelectionSubmission(snapshot, { callbacks: { onRetry } }),
		);

		expect(request).toHaveBeenCalledTimes(2);
		expect(onRetry).toHaveBeenCalledOnce();
		expect(adapter.replaceRange).toHaveBeenCalledExactlyOnceWith(
			'{++p++}a{',
			snapshot.from,
			snapshot.to,
		);
		expect(result.applied).toBe(true);
		const composedFullText = `${fullText.slice(0, snapshot.from)}{++p++}a{${fullText.slice(snapshot.to)}`;
		expect(composedFullText).toBe('{++p++}a{++x++}b');
		expect(() =>
			prepareCriticMarkupEdit(composedFullText, composedFullText),
		).not.toThrow();
	});

	it('retains generic correction for two invalid candidates at a non-strict boundary', async () => {
		const fullText = 'a{++x++}b';
		const snapshot = makeSnapshot(fullText, 'a{');
		const request = selectionRequest('not-json')
			.mockResolvedValueOnce({
				content: JSON.stringify([{ type: 'comment', target: 'a{', comment: 'note' }]),
				reasoning: '',
			})
			.mockResolvedValueOnce({
				content: JSON.stringify([{ type: 'remove', target: 'a{' }]),
				reasoning: '',
			});
		const { adapter, coordinator } = makeSelectionCoordinator(request, snapshot);
		const onRetry = vi.fn();

		const error = await coordinator
			.submit(makeSelectionSubmission(snapshot, { callbacks: { onRetry } }))
			.catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({
			code: 'compiled-markup-rejected',
			message: COMPOSED_MARKUP_ERROR,
			correctionEligible: true,
		});
		expect(request).toHaveBeenCalledTimes(2);
		expect(onRetry).toHaveBeenCalledOnce();
		expectNoFreshnessOrWrite(adapter);
	});

	it.each([
		{
			label: 'exact whole raw token',
			fullText: 'a{++x++}b',
			selectedText: '{++x++}',
		},
		{
			label: 'multi-token span',
			fullText: 'a{++x++}m{--y--}b',
			selectedText: 'a{++x++}m{--y--}b',
		},
	])('does not reclassify an $label as strict in-token rejection', async ({
		fullText,
		selectedText,
	}) => {
		const snapshot = makeSnapshot(fullText, selectedText);
		const response = JSON.stringify([{ type: 'replace', target: 'x', replacement: 'z' }]);
		const request = selectionRequest(response);
		const { adapter, coordinator } = makeSelectionCoordinator(request, snapshot);
		const onRetry = vi.fn();

		const error = await coordinator
			.submit(makeSelectionSubmission(snapshot, { callbacks: { onRetry } }))
			.catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({
			code: 'compiled-markup-rejected',
			correctionEligible: true,
		});
		expect((error as Error).message).not.toBe(IN_TOKEN_SELECTION_ERROR);
		expect(request).toHaveBeenCalledTimes(2);
		expect(onRetry).toHaveBeenCalledOnce();
		expectNoFreshnessOrWrite(adapter);
	});

	it('keeps malformed complete-note source on the sanitized generic correction path', async () => {
		const snapshot = makeSnapshot('a{++x b', 'x');
		const response = JSON.stringify([{ type: 'replace', target: 'x', replacement: 'y' }]);
		const request = selectionRequest(response);
		const { adapter, coordinator } = makeSelectionCoordinator(request, snapshot);
		const onRetry = vi.fn();

		const error = await coordinator
			.submit(makeSelectionSubmission(snapshot, { callbacks: { onRetry } }))
			.catch((thrown: unknown) => thrown);

		expect(error).toMatchObject({
			code: 'compiled-markup-rejected',
			message: COMPOSED_MARKUP_ERROR,
			correctionEligible: true,
		});
		expect((error as Error).message).not.toContain(snapshot.fullText);
		expect(request).toHaveBeenCalledTimes(2);
		expect(onRetry).toHaveBeenCalledOnce();
		expectNoFreshnessOrWrite(adapter);
	});

	it.each([
		{
			label: 'before',
			selectedText: 'a',
			operation: { type: 'insert', anchor: 'a', position: 'after', text: 'p' },
			annotatedSelection: 'a{++p++}',
			expectedFullText: 'a{++p++}{++x++}b',
		},
		{
			label: 'after',
			selectedText: 'b',
			operation: { type: 'insert', anchor: 'b', position: 'before', text: 'p' },
			annotatedSelection: '{++p++}b',
			expectedFullText: 'a{++x++}{++p++}b',
		},
	])('applies an immediately adjacent $label edit and preserves the token bytes', async ({
		selectedText,
		operation,
		annotatedSelection,
		expectedFullText,
	}) => {
		const fullText = 'a{++x++}b';
		const snapshot = makeSnapshot(fullText, selectedText);
		const request = selectionRequest(JSON.stringify([operation]));
		const { adapter, coordinator } = makeSelectionCoordinator(request, snapshot);
		const onRetry = vi.fn();

		const result = await coordinator.submit(
			makeSelectionSubmission(snapshot, { callbacks: { onRetry } }),
		);

		expect(result.applied).toBe(true);
		expect(request).toHaveBeenCalledTimes(1);
		expect(onRetry).not.toHaveBeenCalled();
		expect(adapter.replaceRange).toHaveBeenCalledExactlyOnceWith(
			annotatedSelection,
			snapshot.from,
			snapshot.to,
		);
		const composed = `${fullText.slice(0, snapshot.from)}${annotatedSelection}${fullText.slice(snapshot.to)}`;
		expect(composed).toBe(expectedFullText);
		expect(composed).toContain('{++x++}');
		expect(snapshot.fullText).toBe(fullText);
	});

	it('applies an enclosing Selection edit outside the token and preserves its bytes', async () => {
		const fullText = 'before a{++x++}b after';
		const snapshot = makeSnapshot(fullText, fullText);
		const response = JSON.stringify([
			{ type: 'replace', target: 'before', replacement: 'previous' },
		]);
		const request = selectionRequest(response);
		const { adapter, coordinator } = makeSelectionCoordinator(request, snapshot);
		const annotatedSelection = '{~~before~>previous~~} a{++x++}b after';

		const result = await coordinator.submit(makeSelectionSubmission(snapshot));

		expect(result.applied).toBe(true);
		expect(request).toHaveBeenCalledTimes(1);
		expect(adapter.replaceRange).toHaveBeenCalledExactlyOnceWith(
			annotatedSelection,
			0,
			fullText.length,
		);
		expect(annotatedSelection).toContain('a{++x++}b');
		expect(snapshot.fullText).toBe(fullText);
	});
});

describe('authoritative assembled-request capacity checks for selections', () => {
	it('counts the complete selected text and rejects without touching the editor', async () => {
		const fullText = 'Selected material line.\n'.repeat(1500);
		const snapshot = makeSnapshot(fullText, fullText, 0);

		const grownProbe = makeSelectionCoordinator(
			selectionRequest('[]'),
			snapshot,
		);
		await grownProbe.coordinator.submit(makeSelectionSubmission(snapshot));
		const grownTokens = requestTokens(
			requireRequest(grownProbe.request.mock.calls[0]?.[0]),
		);

		const baseSnapshot = makeSnapshot();
		const baseProbe = makeSelectionCoordinator(
			selectionRequest('[]'),
			baseSnapshot,
		);
		await baseProbe.coordinator.submit(
			makeSelectionSubmission(baseSnapshot),
		);
		const baseTokens = requestTokens(
			requireRequest(baseProbe.request.mock.calls[0]?.[0]),
		);
		expect(grownTokens).toBeGreaterThan(baseTokens);

		const capacity = capacityProviderForTokens(grownTokens);
		const {
			adapter,
			coordinator,
			loadAdditionalNotes,
			loadInstructions,
			request,
		} = makeSelectionCoordinator(
			selectionRequest('[]'),
			snapshot,
			{ skillTexts: new Map() },
			capacity,
		);
		const submission = makeSelectionSubmission(snapshot);
		const originalSelectedText = submission.snapshot.selectedText;

		const error = await coordinator
			.submit(submission)
			.catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(ContextCapacityError);
		expect(error).toMatchObject({
			code: 'context-capacity-exceeded',
			details: {
				kind: 'selection',
				inputTokens: grownTokens,
				effectiveInputTokens: grownTokens - 1,
			},
		});
		expect((error as Error).message).toContain('Select a smaller target.');
		expect((error as Error).message).not.toContain('Selected material line.');
		expect(loadAdditionalNotes).toHaveBeenCalledOnce();
		expect(loadInstructions).toHaveBeenCalledOnce();
		expect(request).not.toHaveBeenCalled();
		expect(adapter.readCurrentText).not.toHaveBeenCalled();
		expect(adapter.replaceRange).not.toHaveBeenCalled();
		expect(submission.snapshot.selectedText).toBe(originalSelectedText);
	});

	it('counts retained history in the assembled selection request', async () => {
		const snapshot = makeSnapshot();
		const history: ProviderHistoryMessage[] = Array.from(
			{ length: 20 },
			(_, index) => ({
				role: index % 2 === 0 ? 'user' : 'assistant',
				content: `Selection history ${index}. `.repeat(40),
				mode: 'edit',
				origin: index % 2 === 0 ? 'user' : 'local-edit-status',
			}),
		);

		const baseProbe = makeSelectionCoordinator(
			selectionRequest('[]'),
			snapshot,
		);
		await baseProbe.coordinator.submit(makeSelectionSubmission(snapshot));
		const baseTokens = requestTokens(
			requireRequest(baseProbe.request.mock.calls[0]?.[0]),
		);

		const historyProbe = makeSelectionCoordinator(
			selectionRequest('[]'),
			snapshot,
		);
		await historyProbe.coordinator.submit(
			makeSelectionSubmission(snapshot, { history }),
		);
		const grownTokens = requestTokens(
			requireRequest(historyProbe.request.mock.calls[0]?.[0]),
		);
		expect(grownTokens).toBeGreaterThan(baseTokens);

		const { adapter, coordinator, request } = makeSelectionCoordinator(
			selectionRequest('[]'),
			snapshot,
			{ skillTexts: new Map() },
			capacityProviderForTokens(grownTokens),
		);

		const error = await coordinator
			.submit(makeSelectionSubmission(snapshot, { history }))
			.catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(ContextCapacityError);
		expect(error).toMatchObject({
			code: 'context-capacity-exceeded',
			details: { kind: 'selection', inputTokens: grownTokens },
		});
		expect(request).not.toHaveBeenCalled();
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('counts freshly loaded instructions and additional notes in the assembled selection request', async () => {
		const snapshot = makeSnapshot();
		const instructions: InstructionPromptParts = {
			agentText: 'Agent instructions',
			skillTexts: new Map([
				['skills/large/SKILL.md', 'Selection skill guidance.\n'.repeat(2000)],
			]),
		};
		const additionalNote: AdditionalNoteSnapshot = {
			sourcePath: 'Reference.md',
			markdown: 'Additional selection context line.\n'.repeat(500),
			sourceCharacters: 16000,
			includedCharacters: 16000,
		};

		const baseProbe = makeSelectionCoordinator(
			selectionRequest('[]'),
			snapshot,
		);
		await baseProbe.coordinator.submit(makeSelectionSubmission(snapshot));
		const baseTokens = requestTokens(
			requireRequest(baseProbe.request.mock.calls[0]?.[0]),
		);

		const grownProbe = makeSelectionCoordinator(
			selectionRequest('[]'),
			snapshot,
			instructions,
		);
		grownProbe.loadAdditionalNotes.mockResolvedValue([additionalNote]);
		await grownProbe.coordinator.submit(
			makeSelectionSubmission(snapshot, {
				additionalNotePaths: ['Reference.md'],
			}),
		);
		const grownTokens = requestTokens(
			requireRequest(grownProbe.request.mock.calls[0]?.[0]),
		);
		expect(grownTokens).toBeGreaterThan(baseTokens);

		const {
			adapter,
			coordinator,
			loadAdditionalNotes,
			loadInstructions,
			request,
		} = makeSelectionCoordinator(
			selectionRequest('[]'),
			snapshot,
			instructions,
			capacityProviderForTokens(grownTokens),
		);
		loadAdditionalNotes.mockResolvedValue([additionalNote]);

		const error = await coordinator
			.submit(
				makeSelectionSubmission(snapshot, {
					additionalNotePaths: ['Reference.md'],
				}),
			)
			.catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(ContextCapacityError);
		expect(error).toMatchObject({
			code: 'context-capacity-exceeded',
			details: { kind: 'selection', inputTokens: grownTokens },
		});
		expect(loadAdditionalNotes).toHaveBeenCalledOnce();
		expect(loadInstructions).toHaveBeenCalledOnce();
		expect(request).not.toHaveBeenCalled();
		expect(adapter.readCurrentText).not.toHaveBeenCalled();
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});
});

describe('selection capacity abort precedence', () => {
	it('lets an abort during instruction loading win over a capacity error', async () => {
		const snapshot = makeSnapshot();
		const controller = new AbortController();
		const {
			adapter,
			coordinator,
			loadAdditionalNotes,
			loadInstructions,
			request,
		} = makeSelectionCoordinator(
			selectionRequest('[]'),
			snapshot,
			{ skillTexts: new Map() },
			capacityProviderForTokens(1),
		);
		loadInstructions.mockImplementation(async () => {
			controller.abort();
			return { skillTexts: new Map() };
		});

		const error = await coordinator
			.submit(makeSelectionSubmission(snapshot, {
				signal: controller.signal,
			}))
			.catch((thrown: unknown) => thrown);

		expect(error).not.toBeInstanceOf(ContextCapacityError);
		expect(error).toMatchObject({ name: 'AbortError' });
		expect(loadAdditionalNotes).toHaveBeenCalledOnce();
		expect(loadInstructions).toHaveBeenCalledOnce();
		expect(request).not.toHaveBeenCalled();
		expect(adapter.readCurrentText).not.toHaveBeenCalled();
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});
});
