import { TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../src/context';
import {
	ModificationController,
	type ModificationControllerDependencies,
	type ModificationStreamCallbacks,
	type ModificationSubmission,
} from '../src/modification-controller';
import type { EditRequestResult } from '../src/request-coordinator';
import type { SelectionEditorAdapter } from '../src/selection-editor';
import type { TokenUsage } from '../src/token-usage';
import type { ProviderHistoryMessage, SelectionSnapshot } from '../src/types';

const failureSentinels = [
	{ kind: 'provider', error: new Error('provider sentinel') },
	{ kind: 'validation', error: new Error('validation sentinel') },
	{ kind: 'stale', error: new Error('stale sentinel') },
	{ kind: 'abort', error: new DOMException('abort sentinel', 'AbortError') },
];

function makeUsage(): TokenUsage {
	return {
		promptTokens: 12,
		completionTokens: 8,
		totalTokens: 20,
		source: 'provider',
	};
}

function makeResult(overrides: Partial<EditRequestResult> = {}): EditRequestResult {
	return {
		applied: false,
		changeCount: 0,
		summaryItems: [],
		usage: makeUsage(),
		...overrides,
	};
}

function makeContext(): RequestContext {
	const file = new TFile();
	file.path = 'folder/note.md';
	return {
		file,
		sourceText: '# Title\nOriginal text\nLast line.',
		selection: { from: 0, to: 0 },
		noteLabel: 'folder/note.md',
		markdown: '# Title\nOriginal text\nLast line.',
	};
}

function makeHistory(): ProviderHistoryMessage[] {
	return [
		{ role: 'user', content: 'Earlier request', mode: 'ask', origin: 'user' },
		{ role: 'assistant', content: 'Earlier answer', mode: 'ask', origin: 'model' },
	];
}

function makeCallbacks(): ModificationStreamCallbacks {
	return {
		onReasoning: () => undefined,
		onRetry: () => undefined,
	};
}

function makeFullNoteSubmission(): ModificationSubmission {
	return {
		target: { type: 'full-note', mode: 'edit', context: makeContext() },
		prompt: 'Improve the note.',
		history: makeHistory(),
		additionalNotePaths: ['references/full-note.md'],
		signal: new AbortController().signal,
		callbacks: makeCallbacks(),
	};
}

function makeSelectionSubmission() {
	const file = new TFile();
	file.path = 'folder/selection.md';
	const fullText = 'Intro.\nFirst selected.\nSecond selected.\nTail.';
	const selectedText = 'First selected.\nSecond selected.';
	const from = fullText.indexOf(selectedText);
	const snapshot: SelectionSnapshot = {
		file,
		fullText,
		selectedText,
		from,
		to: from + selectedText.length,
	};
	const editor: SelectionEditorAdapter = {
		readCurrentText: () => fullText,
		readDiskText: async () => fullText,
		readEditorTexts: () => [fullText],
		isTargetCurrent: () => true,
		replaceRange: () => undefined,
	};
	const history = makeHistory();
	const additionalNotePaths = ['references/selection.md'];
	const callbacks = makeCallbacks();
	const signal = new AbortController().signal;
	const submission: ModificationSubmission = {
		target: {
			type: 'selection',
			mode: 'edit',
			target: { snapshot, editor },
			selectionContext: 'full-note',
		},
		prompt: 'Improve the selection.',
		history,
		additionalNotePaths,
		signal,
		callbacks,
	};
	return { submission, snapshot, editor, history, additionalNotePaths, callbacks, signal };
}

function createController() {
	const requestFullNoteEdit = vi.fn<ModificationControllerDependencies['requestFullNoteEdit']>();
	const requestSelectionEdit = vi.fn<ModificationControllerDependencies['requestSelectionEdit']>();
	const controller = new ModificationController({ requestFullNoteEdit, requestSelectionEdit });
	return { controller, requestFullNoteEdit, requestSelectionEdit };
}

describe('ModificationController', () => {
	it('routes Full-note submissions and formats the applied result', async () => {
		const { controller, requestFullNoteEdit, requestSelectionEdit } = createController();
		const context = makeContext();
		const history = makeHistory();
		const additionalNotePaths = ['references/full-note.md'];
		const signal = new AbortController().signal;
		const callbacks = makeCallbacks();
		const usage = makeUsage();
		requestFullNoteEdit.mockResolvedValue(makeResult({
			applied: true,
			changeCount: 2,
			summary: 'Tightened the note.',
			summaryItems: [
				{ type: 'replace', start: 8, end: 21 },
				{ type: 'remove', start: 22, end: 32 },
			],
			usage,
		}));

		const result = await controller.submit({
			target: { type: 'full-note', mode: 'edit', context },
			prompt: 'Improve the note.',
			history,
			additionalNotePaths,
			signal,
			callbacks,
		});

		expect(requestFullNoteEdit).toHaveBeenCalledOnce();
		const editSubmission = requestFullNoteEdit.mock.calls[0]?.[0];
		expect(editSubmission).toStrictEqual({
			context,
			mode: 'edit',
			prompt: 'Improve the note.',
			history,
			additionalNotePaths,
			callbacks,
			signal,
		});
		expect(editSubmission?.context).toBe(context);
		expect(editSubmission?.history).toBe(history);
		expect(editSubmission?.additionalNotePaths).toBe(additionalNotePaths);
		expect(editSubmission?.callbacks).toBe(callbacks);
		expect(editSubmission?.signal).toBe(signal);
		expect(requestSelectionEdit).not.toHaveBeenCalled();
		expect(result).toStrictEqual({
			applied: true,
			content: [
				'Edit applied — 2 changes tracked. Review in Track Changes.',
				'Target: Full note.',
				'',
				'Tightened the note.',
				'',
				'- Replaced line 2.',
				'- Removed line 3.',
			].join('\n'),
			usage,
		});
		expect(result.usage).toBe(usage);
	});

	it('routes Selection submissions with the captured editor and note-absolute summary offset', async () => {
		const { controller, requestFullNoteEdit, requestSelectionEdit } = createController();
		const {
			submission,
			snapshot,
			editor,
			history,
			additionalNotePaths,
			callbacks,
			signal,
		} = makeSelectionSubmission();
		const usage = makeUsage();
		requestSelectionEdit.mockResolvedValue(makeResult({
			applied: true,
			changeCount: 1,
			summaryItems: [{ type: 'replace', start: 0, end: snapshot.selectedText.length }],
			usage,
		}));

		const result = await controller.submit(submission);

		expect(requestSelectionEdit).toHaveBeenCalledOnce();
		const args = requestSelectionEdit.mock.calls[0];
		expect(args).toHaveLength(8);
		expect(args?.[0]).toBe(snapshot);
		expect(args?.[1]).toBe('Improve the selection.');
		expect(args?.[2]).toBe(signal);
		expect(args?.[3]).toBe(editor);
		expect(args?.[4]).toBe(additionalNotePaths);
		expect(args?.[5]).toBe(history);
		expect(args?.[6]).toBe(callbacks);
		expect(args?.[7]).toBe('full-note');
		expect(requestFullNoteEdit).not.toHaveBeenCalled();
		expect(result).toStrictEqual({
			applied: true,
			content: [
				'Edit applied — 1 changes tracked. Review in Track Changes.',
				'Target: Selection.',
				'',
				'- Replaced lines 2–3.',
			].join('\n'),
			usage,
		});
		expect(result.usage).toBe(usage);
	});

	it('keeps the exact no-op result when non-applied summary items exist', async () => {
		const { controller, requestFullNoteEdit } = createController();
		const usage = makeUsage();
		requestFullNoteEdit.mockResolvedValue(makeResult({
			applied: false,
			summaryItems: [{ type: 'replace', start: 8, end: 21 }],
			usage,
		}));

		const result = await controller.submit(makeFullNoteSubmission());

		expect(result).toStrictEqual({
			applied: false,
			content: 'No changes were needed.',
			usage,
		});
		expect(result.usage).toBe(usage);
	});

	it('places an optional validated summary after the no-op sentence', async () => {
		const { controller, requestFullNoteEdit } = createController();
		requestFullNoteEdit.mockResolvedValue(makeResult({
			applied: false,
			summary: 'The note was already concise.',
		}));

		const result = await controller.submit(makeFullNoteSubmission());

		expect(result.content).toBe(
			'No changes were needed.\n\nThe note was already concise.',
		);
	});

	it.each(['full-note', 'selection'] as const)(
		'forwards reasoning and retry callbacks without adding correction policy (%s)',
		async (targetType) => {
			const { controller, requestFullNoteEdit, requestSelectionEdit } = createController();
			const events: string[] = [];
			const callbacks: ModificationStreamCallbacks = {
				onReasoning: (text) => {
					events.push(`reasoning: ${text}`);
				},
				onRetry: () => {
					events.push('retry');
				},
			};
			requestFullNoteEdit.mockImplementation(async (submission) => {
				submission.callbacks.onReasoning('Rejected attempt reasoning.');
				submission.callbacks.onRetry?.();
				submission.callbacks.onReasoning('Successful attempt reasoning.');
				return makeResult();
			});
			requestSelectionEdit.mockImplementation(async (
				_snapshot,
				_prompt,
				_signal,
				_editor,
				_additionalNotePaths,
				_history,
				selectionCallbacks,
			) => {
				selectionCallbacks.onReasoning?.('Rejected attempt reasoning.');
				selectionCallbacks.onRetry?.();
				selectionCallbacks.onReasoning?.('Successful attempt reasoning.');
				return makeResult();
			});
			const submission = targetType === 'full-note'
				? makeFullNoteSubmission()
				: makeSelectionSubmission().submission;

			await controller.submit({ ...submission, callbacks });

			expect(events).toEqual([
				'reasoning: Rejected attempt reasoning.',
				'retry',
				'reasoning: Successful attempt reasoning.',
			]);
			expect(requestFullNoteEdit).toHaveBeenCalledTimes(targetType === 'full-note' ? 1 : 0);
			expect(requestSelectionEdit).toHaveBeenCalledTimes(targetType === 'selection' ? 1 : 0);
		},
	);

	it.each(failureSentinels)(
		'propagates Full-note failures without Selection fallback or result formatting ($kind)',
		async ({ error }) => {
			const { controller, requestFullNoteEdit, requestSelectionEdit } = createController();
			requestFullNoteEdit.mockRejectedValue(error);

			await expect(controller.submit(makeFullNoteSubmission())).rejects.toBe(error);

			expect(requestFullNoteEdit).toHaveBeenCalledOnce();
			expect(requestSelectionEdit).not.toHaveBeenCalled();
		},
	);

	it.each(failureSentinels)(
		'propagates Selection failures without Full-note fallback ($kind)',
		async ({ error }) => {
			const { controller, requestFullNoteEdit, requestSelectionEdit } = createController();
			requestSelectionEdit.mockRejectedValue(error);

			await expect(controller.submit(makeSelectionSubmission().submission)).rejects.toBe(error);

			expect(requestSelectionEdit).toHaveBeenCalledOnce();
			expect(requestFullNoteEdit).not.toHaveBeenCalled();
		},
	);
});
