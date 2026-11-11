import { TFile, type MarkdownView } from 'obsidian';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { AdditionalNoteSnapshot } from '../src/additional-notes-context';
import type { EditPreparation } from '../src/edit-strategy';
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

const provider: ProviderConfig = {
	name: 'Local test provider',
	baseUrl: 'http://127.0.0.1:8787/v1',
	apiKey: 'dummy-test-key',
	model: 'dummy-model',
	reasoningEffort: 'low',
	requestUsage: false,
	discoveredModels: [],
};

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
	let targetCurrent = true;
	const adapter: SelectionEditorAdapter = {
		readCurrentText: vi.fn(() => currentText),
		isTargetCurrent: vi.fn(() => targetCurrent),
		replaceRange: vi.fn(),
	};
	return {
		adapter,
		setCurrentText: (text: string) => {
			currentText = text;
		},
		setTargetCurrent: (current: boolean) => {
			targetCurrent = current;
		},
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
	it('returns the exact snapshot and an adapter bound to the same view', () => {
		const fullText = '# Note\nAlpha beta gamma.\nEnd';
		const from = fullText.indexOf('beta');
		const to = from + 4;
		const { editor, file, view } = makeView(fullText, from, to);
		const isTargetCurrent = vi.fn(() => true);

		const target = captureSelectionEditTarget(view, isTargetCurrent);

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

		expect(() => captureSelectionEditTarget(view, () => true)).toThrow(
			'Select non-whitespace text first.',
		);
	});

	it('retains the saved-file error', () => {
		const { view } = makeView('Alpha beta', 0, 5);
		view.file = null;

		expect(() => captureSelectionEditTarget(view, () => true)).toThrow(
			'Open a saved Markdown note first.',
		);
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
	it('replaces only the captured selection offsets and returns its summary items and summary', () => {
		const snapshot = makeSnapshot();
		const { adapter } = makeAdapter(snapshot);
		const summaryItems = [{ type: 'replace', start: 0, end: 4 }] as const;
		const prepared: EditPreparation = {
			annotatedMarkdown: '{~~beta~>delta~~}',
			changeCount: 1,
			summaryItems,
			summary: 'Renamed beta to delta.',
		};

		const result = applyPreparedSelectionEdit(
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
		expect(adapter.isTargetCurrent).toHaveBeenCalledOnce();
		expect(adapter.replaceRange).toHaveBeenCalledExactlyOnceWith(
			'{~~beta~>delta~~}',
			snapshot.from,
			snapshot.to,
		);
	});

	it('replaces a complete multiline selection without changing its neighbors', () => {
		const fullText = 'Before\nFirst\nSecond\nAfter';
		const snapshot = makeSnapshot(fullText, 'First\nSecond');
		const { adapter } = makeAdapter(snapshot);

		applyPreparedSelectionEdit(
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

	it('does not re-read or replace an unchanged selection and returns no items but keeps the summary', () => {
		const snapshot = makeSnapshot();
		const { adapter } = makeAdapter(snapshot);

		const result = applyPreparedSelectionEdit(
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
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('applies a valid comment-only selection edit with zero text changes and its comment item', () => {
		const snapshot = makeSnapshot();
		const { adapter } = makeAdapter(snapshot);
		const commentItems = [{ type: 'comment', start: 0, end: 4 }] as const;

		const result = applyPreparedSelectionEdit(
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

	it('rejects without a result when the editor replacement fails', () => {
		const snapshot = makeSnapshot();
		const { adapter } = makeAdapter(snapshot);
		const replaceError = new Error('Editor unavailable');
		adapter.replaceRange = vi.fn(() => {
			throw replaceError;
		});

		expect(() =>
			applyPreparedSelectionEdit(
				'edit',
				snapshot,
				{
					annotatedMarkdown: '{~~beta~>delta~~}',
					changeCount: 1,
					summaryItems: [{ type: 'replace', start: 0, end: 4 }],
				},
				adapter,
			),
		).toThrow(replaceError);
	});

	it('rejects stale full text without replacing the selection', () => {
		const snapshot = makeSnapshot();
		const { adapter, setCurrentText } = makeAdapter(snapshot);
		setCurrentText('# Note\nAlpha beta changed while waiting.\nEnd');

		expect(() =>
			applyPreparedSelectionEdit(
				'edit',
				snapshot,
				{ annotatedMarkdown: '{~~beta~>delta~~}', changeCount: 1, summaryItems: [] },
				adapter,
			),
		).toThrow(STALE_ERROR);
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('rejects a target-view switch without replacing the selection', () => {
		const snapshot = makeSnapshot();
		const { adapter, setTargetCurrent } = makeAdapter(snapshot);
		setTargetCurrent(false);

		expect(() =>
			applyPreparedSelectionEdit(
				'edit',
				snapshot,
				{ annotatedMarkdown: '{~~beta~>delta~~}', changeCount: 1, summaryItems: [] },
				adapter,
			),
		).toThrow(STALE_ERROR);
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('does not replace when aborted immediately before application', () => {
		const snapshot = makeSnapshot();
		const { adapter } = makeAdapter(snapshot);
		const controller = new AbortController();
		controller.abort();

		let thrown: unknown;
		try {
			applyPreparedSelectionEdit(
				'edit',
				snapshot,
				{ annotatedMarkdown: '{~~beta~>delta~~}', changeCount: 1, summaryItems: [] },
				adapter,
				controller.signal,
			);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toMatchObject({ name: 'AbortError' });
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it.each(['ask', 'discuss', 'brainstorm'] as const)(
		'has no selection write path in %s mode',
		(mode) => {
			const snapshot = makeSnapshot();
			const { adapter } = makeAdapter(snapshot);

			const result = applyPreparedSelectionEdit(
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
			expect(adapter.replaceRange).not.toHaveBeenCalled();
		},
	);
});

describe('createSelectionEditorAdapter', () => {
	it('checks captured view/file identity and converts offsets for editor.replaceRange', () => {
		const snapshot = makeSnapshot();
		const { editor, view } = makeView(
			snapshot.fullText,
			snapshot.from,
			snapshot.to,
		);
		const isTargetCurrent = vi.fn(() => true);
		const adapter = createSelectionEditorAdapter(view, isTargetCurrent);

		expect(adapter.readCurrentText()).toBe(snapshot.fullText);
		expect(adapter.isTargetCurrent()).toBe(true);
		adapter.replaceRange('{~~beta~>delta~~}', snapshot.from, snapshot.to);

		expect(isTargetCurrent).toHaveBeenCalledExactlyOnceWith(view);
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
		const adapter = createSelectionEditorAdapter(view, () => true);
		view.file = markdownFile('other.md');

		expect(adapter.isTargetCurrent()).toBe(false);
	});
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
) {
	const { adapter, setCurrentText, setTargetCurrent } = makeAdapter(snapshot);
	const loadInstructions = vi.fn(async () => instructions);
	const loadAdditionalNotes = vi.fn(
		async (
			_paths: readonly string[],
			_activeNotePath: string,
			_signal: AbortSignal,
		): Promise<AdditionalNoteSnapshot[]> => [],
	);
	const coordinator = new SelectionEditRequestCoordinator({
		provider,
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
});
