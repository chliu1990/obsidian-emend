import { TFile, type MarkdownView } from 'obsidian';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
	criticMarkupEditStrategy,
	type EditPreparation,
} from '../src/edit-strategy';
import type {
	AiProviderRequest,
	StreamEvent,
	StreamResult,
} from '../src/provider-stream';
import {
	applyPreparedSelectionEdit,
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
	it('replaces only the captured selection offsets', () => {
		const snapshot = makeSnapshot();
		const { adapter } = makeAdapter(snapshot);
		const prepared: EditPreparation = {
			annotatedMarkdown: '{~~beta~>delta~~}',
			changeCount: 1,
		};

		const result = applyPreparedSelectionEdit(
			'edit',
			snapshot,
			prepared,
			adapter,
		);

		expect(result).toEqual({ applied: true, changeCount: 1 });
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
			{ annotatedMarkdown: '{~~First\nSecond~>Combined lines~~}', changeCount: 1 },
			adapter,
		);

		expect(adapter.replaceRange).toHaveBeenCalledExactlyOnceWith(
			'{~~First\nSecond~>Combined lines~~}',
			snapshot.from,
			snapshot.to,
		);
	});

	it('does not re-read or replace an unchanged selection', () => {
		const snapshot = makeSnapshot();
		const { adapter } = makeAdapter(snapshot);

		const result = applyPreparedSelectionEdit(
			'edit',
			snapshot,
			{ annotatedMarkdown: snapshot.selectedText, changeCount: 0 },
			adapter,
		);

		expect(result).toEqual({ applied: false, changeCount: 0 });
		expect(adapter.readCurrentText).not.toHaveBeenCalled();
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('applies a valid comment-only selection edit with zero text changes', () => {
		const snapshot = makeSnapshot();
		const { adapter } = makeAdapter(snapshot);

		const result = applyPreparedSelectionEdit(
			'edit',
			snapshot,
			{ annotatedMarkdown: 'beta{>>Review this.<<}', changeCount: 0 },
			adapter,
		);

		expect(result).toEqual({ applied: true, changeCount: 0 });
		expect(adapter.replaceRange).toHaveBeenCalledOnce();
	});

	it('rejects stale full text without replacing the selection', () => {
		const snapshot = makeSnapshot();
		const { adapter, setCurrentText } = makeAdapter(snapshot);
		setCurrentText('# Note\nAlpha beta changed while waiting.\nEnd');

		expect(() =>
			applyPreparedSelectionEdit(
				'edit',
				snapshot,
				{ annotatedMarkdown: '{~~beta~>delta~~}', changeCount: 1 },
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
				{ annotatedMarkdown: '{~~beta~>delta~~}', changeCount: 1 },
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
				{ annotatedMarkdown: '{~~beta~>delta~~}', changeCount: 1 },
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
				{ annotatedMarkdown: '{--beta--}', changeCount: 1 },
				adapter,
			);

			expect(result).toEqual({ applied: false, changeCount: 0 });
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
	const { adapter } = makeAdapter(snapshot);
	const loadInstructions = vi.fn(async () => instructions);
	const coordinator = new SelectionEditRequestCoordinator({
		provider,
		loadInstructions,
		request,
		editor: adapter,
		editStrategy: criticMarkupEditStrategy,
	});
	return { adapter, coordinator, loadInstructions, request };
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
		signal: new AbortController().signal,
		...overrides,
	};
}

describe('SelectionEditRequestCoordinator', () => {
	it('loads current instructions and uses the Stage 03 selection prompt', async () => {
		const snapshot = makeSnapshot();
		const instructions: InstructionPromptParts = {
			agentText: 'Agent instructions',
			skillTexts: new Map([['skills/review/SKILL.md', 'Review skill']]),
		};
		const { coordinator, loadInstructions, request } = makeSelectionCoordinator(
			selectionRequest(snapshot.selectedText),
			snapshot,
			instructions,
		);

		await coordinator.submit(makeSelectionSubmission(snapshot));
		await coordinator.submit(makeSelectionSubmission(snapshot));

		expect(loadInstructions).toHaveBeenCalledTimes(2);
		for (const call of request.mock.calls) {
			const systemPrompt = call[0].systemPrompt;
			expect(systemPrompt).toContain('Return ONLY the modified selected portion');
			expect(systemPrompt).not.toContain('Return the COMPLETE note');
			expect(systemPrompt.indexOf('Review skill')).toBeLessThan(
				systemPrompt.indexOf('Agent instructions'),
			);
		}
	});

	it('restores Stage 09 symmetric context when smart context is disabled', async () => {
		const sourceText = '0123456789'.repeat(10);
		const snapshot = makeSnapshot(sourceText, sourceText.slice(40, 50), 40);
		const { coordinator, request } = makeSelectionCoordinator(
			selectionRequest(snapshot.selectedText),
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
			selectionRequest('{~~beta~>delta~~}'),
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
			selectionRequest(selectedText),
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
			selectionRequest('{~~beta~>delta~~}'),
			snapshot,
		);

		const result = await coordinator.submit(makeSelectionSubmission(snapshot));

		expect(result).toEqual({ applied: true, changeCount: 1 });
		expect(adapter.replaceRange).toHaveBeenCalledExactlyOnceWith(
			'{~~beta~>delta~~}',
			snapshot.from,
			snapshot.to,
		);
	});

	it('returns a no-op result without replacing unchanged output', async () => {
		const snapshot = makeSnapshot();
		const { adapter, coordinator } = makeSelectionCoordinator(
			selectionRequest(snapshot.selectedText),
			snapshot,
		);

		await expect(
			coordinator.submit(makeSelectionSubmission(snapshot)),
		).resolves.toEqual({ applied: false, changeCount: 0 });
		expect(adapter.replaceRange).not.toHaveBeenCalled();
	});

	it('rejects invalid output before reading or replacing', async () => {
		const snapshot = makeSnapshot();
		const { adapter, coordinator } = makeSelectionCoordinator(
			selectionRequest('An unannotated replacement.'),
			snapshot,
		);

		await expect(
			coordinator.submit(makeSelectionSubmission(snapshot)),
		).rejects.toThrow('Response reject view differs');
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
				callbacks.onEvent({ type: 'content', text: '{~~beta~>delta~~}' });
				controller.abort();
				return { content: '{~~beta~>delta~~}', reasoning: '' };
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
});
