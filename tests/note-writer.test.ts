import { TFile, type Vault } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '../src/context';
import {
	applyPreparedEdit,
	createVaultNoteWriter,
	type NoteWriter,
} from '../src/note-writer';
import type { Mode } from '../src/types';

const STALE_ERROR =
	'The note changed while Emend was responding. No edits were applied.';

const SUMMARY_ITEMS = [
	{ type: 'replace', start: 7, end: 15 },
] as const;

function makeContext(sourceText = '# Note\nOriginal text'): RequestContext {
	const file = new TFile();
	file.path = 'folder/note.md';
	return {
		file,
		sourceText,
		selection: { from: 0, to: 0 },
		noteLabel: file.path,
		markdown: sourceText,
	};
}

function makeWriter(
	currentText = '# Note\nOriginal text',
	editorTexts?: readonly string[],
) {
	let targetCurrent = true;
	const writer: NoteWriter = {
		readCurrentText: vi.fn(async () => currentText),
		write: vi.fn(async () => undefined),
		isTargetCurrent: vi.fn(() => targetCurrent),
		...(editorTexts === undefined
			? {}
			: { readEditorTexts: vi.fn(() => editorTexts) }),
	};
	return {
		writer,
		setTargetCurrent: (value: boolean) => {
			targetCurrent = value;
		},
	};
}

describe('applyPreparedEdit', () => {
	it('writes a validated Edit response once and returns its summary items and summary after the write', async () => {
		const context = makeContext();
		const { writer } = makeWriter();
		const annotatedMarkdown = '# Note\n{~~Original~>Edited~~} text';

		const result = await applyPreparedEdit(
			'edit',
			context,
			{
				annotatedMarkdown,
				changeCount: 1,
				summaryItems: SUMMARY_ITEMS,
				summary: 'Tightened the opening.',
			},
			writer,
		);

		expect(result).toEqual({
			applied: true,
			changeCount: 1,
			summaryItems: SUMMARY_ITEMS,
			summary: 'Tightened the opening.',
		});
		expect(result.summaryItems).toBe(SUMMARY_ITEMS);
		expect(writer.readCurrentText).toHaveBeenCalledExactlyOnceWith(context.file);
		expect(writer.isTargetCurrent).toHaveBeenCalledExactlyOnceWith(context.file);
		expect(writer.write).toHaveBeenCalledExactlyOnceWith(
			context.file,
			annotatedMarkdown,
		);
	});

	it('does not write or re-read but keeps the summary for an unchanged response', async () => {
		const context = makeContext();
		const { writer } = makeWriter();

		const result = await applyPreparedEdit(
			'edit',
			context,
			{
				annotatedMarkdown: context.sourceText,
				changeCount: 0,
				summaryItems: SUMMARY_ITEMS,
				summary: 'Reviewed without changing anything.',
			},
			writer,
		);

		expect(result).toEqual({
			applied: false,
			changeCount: 0,
			summaryItems: [],
			summary: 'Reviewed without changing anything.',
		});
		expect(writer.readCurrentText).not.toHaveBeenCalled();
		expect(writer.write).not.toHaveBeenCalled();
	});

	it('applies a valid comment-only edit with zero text changes and its comment item', async () => {
		const context = makeContext();
		const { writer } = makeWriter();
		const annotatedMarkdown = '# Note\nOriginal{>>Review this.<<} text';
		const commentItems = [{ type: 'comment', start: 7, end: 15 }] as const;

		const result = await applyPreparedEdit(
			'edit',
			context,
			{ annotatedMarkdown, changeCount: 0, summaryItems: commentItems },
			writer,
		);

		expect(result).toEqual({
			applied: true,
			changeCount: 0,
			summaryItems: commentItems,
		});
		expect(result.summary).toBeUndefined();
		expect(writer.write).toHaveBeenCalledExactlyOnceWith(
			context.file,
			annotatedMarkdown,
		);
	});

	it('rejects an edit when the original note changes while waiting', async () => {
		const context = makeContext();
		const { writer } = makeWriter('# Note\nChanged while waiting');

		await expect(
			applyPreparedEdit(
				'edit',
				context,
				{
					annotatedMarkdown: '# Note\n{++Added++}\nOriginal text',
					changeCount: 1,
					summaryItems: [],
				},
				writer,
			),
		).rejects.toThrow(STALE_ERROR);

		expect(writer.write).not.toHaveBeenCalled();
	});

	it('rejects an edit when the active target note changes while waiting', async () => {
		const context = makeContext();
		const { writer, setTargetCurrent } = makeWriter();
		setTargetCurrent(false);

		await expect(
			applyPreparedEdit(
				'edit',
				context,
				{
					annotatedMarkdown: '# Note\n{++Added++}\nOriginal text',
					changeCount: 1,
					summaryItems: [],
				},
				writer,
			),
		).rejects.toThrow(STALE_ERROR);

		expect(writer.write).not.toHaveBeenCalled();
	});

	it('rejects an edit when the open editor text differs from the captured source', async () => {
		const context = makeContext();
		const { writer } = makeWriter(context.sourceText, [`${context.sourceText} `]);

		await expect(
			applyPreparedEdit(
				'edit',
				context,
				{
					annotatedMarkdown: '# Note\n{~~Original~>Edited~~} text',
					changeCount: 1,
					summaryItems: SUMMARY_ITEMS,
				},
				writer,
			),
		).rejects.toThrow(STALE_ERROR);

		expect(writer.readEditorTexts).toHaveBeenCalledExactlyOnceWith(context.file);
		expect(writer.write).not.toHaveBeenCalled();
	});

	it('rejects an edit when the target pane is dirty and another pane matches the snapshot', async () => {
		const context = makeContext();
		const { writer } = makeWriter(context.sourceText, [
			`${context.sourceText} typing`,
			context.sourceText,
		]);

		await expect(
			applyPreparedEdit(
				'edit',
				context,
				{
					annotatedMarkdown: '# Note\n{~~Original~>Edited~~} text',
					changeCount: 1,
					summaryItems: SUMMARY_ITEMS,
				},
				writer,
			),
		).rejects.toThrow(STALE_ERROR);

		expect(writer.readEditorTexts).toHaveBeenCalledExactlyOnceWith(context.file);
		expect(writer.write).not.toHaveBeenCalled();
	});

	it('rejects an edit when any open pane differs from the captured source', async () => {
		const context = makeContext();
		const { writer } = makeWriter(context.sourceText, [
			context.sourceText,
			context.sourceText,
			`${context.sourceText}\n`,
		]);

		await expect(
			applyPreparedEdit(
				'edit',
				context,
				{
					annotatedMarkdown: '# Note\n{~~Original~>Edited~~} text',
					changeCount: 1,
					summaryItems: SUMMARY_ITEMS,
				},
				writer,
			),
		).rejects.toThrow(STALE_ERROR);

		expect(writer.write).not.toHaveBeenCalled();
	});

	it('applies when disk and editor text both match the captured source', async () => {
		const context = makeContext();
		const { writer } = makeWriter(context.sourceText, [context.sourceText]);
		const annotatedMarkdown = '# Note\n{~~Original~>Edited~~} text';

		const result = await applyPreparedEdit(
			'edit',
			context,
			{ annotatedMarkdown, changeCount: 1, summaryItems: SUMMARY_ITEMS },
			writer,
		);

		expect(result.applied).toBe(true);
		expect(writer.readEditorTexts).toHaveBeenCalledExactlyOnceWith(context.file);
		expect(writer.write).toHaveBeenCalledExactlyOnceWith(
			context.file,
			annotatedMarkdown,
		);
	});

	it('applies when every open editor matches the captured source', async () => {
		const context = makeContext();
		const { writer } = makeWriter(context.sourceText, [
			context.sourceText,
			context.sourceText,
		]);

		const result = await applyPreparedEdit(
			'edit',
			context,
			{
				annotatedMarkdown: '# Note\n{~~Original~>Edited~~} text',
				changeCount: 1,
				summaryItems: SUMMARY_ITEMS,
			},
			writer,
		);

		expect(result.applied).toBe(true);
		expect(writer.write).toHaveBeenCalledOnce();
	});

	it('accepts a disk-only writer when no editor reader is supplied', async () => {
		const context = makeContext();
		const { writer } = makeWriter();

		const result = await applyPreparedEdit(
			'edit',
			context,
			{
				annotatedMarkdown: '# Note\n{~~Original~>Edited~~} text',
				changeCount: 1,
				summaryItems: SUMMARY_ITEMS,
			},
			writer,
		);

		expect(writer.readEditorTexts).toBeUndefined();
		expect(result.applied).toBe(true);
		expect(writer.write).toHaveBeenCalledOnce();
	});

	it('does not write when aborted while the current-text read is pending', async () => {
		const context = makeContext();
		const { writer } = makeWriter();
		const controller = new AbortController();
		let finishRead!: (text: string) => void;
		writer.readCurrentText = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					finishRead = resolve;
				}),
		);

		const application = applyPreparedEdit(
			'edit',
			context,
			{
				annotatedMarkdown: '# Note\n{~~Original~>Edited~~} text',
				changeCount: 1,
				summaryItems: [],
			},
			writer,
			controller.signal,
		);
		controller.abort();
		finishRead(context.sourceText);

		await expect(application).rejects.toMatchObject({ name: 'AbortError' });
		expect(writer.write).not.toHaveBeenCalled();
	});

	it('does not write when the target check triggers the final abort', async () => {
		const context = makeContext();
		const { writer } = makeWriter();
		const controller = new AbortController();
		writer.isTargetCurrent = vi.fn(() => {
			controller.abort();
			return true;
		});

		await expect(
			applyPreparedEdit(
				'edit',
				context,
				{
					annotatedMarkdown: '# Note\n{~~Original~>Edited~~} text',
					changeCount: 1,
					summaryItems: SUMMARY_ITEMS,
				},
				writer,
				controller.signal,
			),
		).rejects.toMatchObject({ name: 'AbortError' });

		expect(writer.readCurrentText).toHaveBeenCalledExactlyOnceWith(context.file);
		expect(writer.write).not.toHaveBeenCalled();
	});

	it('writes exact matching CRLF source without normalization or a second disk read', async () => {
		const context = makeContext('# Note\r\nOriginal text\r\n');
		const { writer } = makeWriter(context.sourceText, [context.sourceText]);
		const annotatedMarkdown = '# Note\r\n{~~Original~>Edited~~} text\r\n';

		const result = await applyPreparedEdit(
			'edit',
			context,
			{ annotatedMarkdown, changeCount: 1, summaryItems: SUMMARY_ITEMS },
			writer,
		);

		expect(result.applied).toBe(true);
		expect(writer.readCurrentText).toHaveBeenCalledExactlyOnceWith(context.file);
		expect(writer.write).toHaveBeenCalledExactlyOnceWith(
			context.file,
			annotatedMarkdown,
		);
	});

	it('hands off disk, editors, target, and one guarded write in order', async () => {
		const context = makeContext();
		const { writer } = makeWriter();
		const events: string[] = [];
		writer.readCurrentText = vi.fn(async () => {
			events.push('disk read');
			return context.sourceText;
		});
		writer.readEditorTexts = vi.fn(() => {
			events.push('editor snapshot');
			return [context.sourceText];
		});
		writer.isTargetCurrent = vi.fn(() => {
			events.push('target check');
			return true;
		});
		writer.write = vi.fn(async () => {
			events.push('vault write');
		});

		await applyPreparedEdit(
			'edit',
			context,
			{
				annotatedMarkdown: '# Note\n{~~Original~>Edited~~} text',
				changeCount: 1,
				summaryItems: SUMMARY_ITEMS,
			},
			writer,
		);

		expect(events).toEqual([
			'disk read',
			'editor snapshot',
			'target check',
			'vault write',
		]);
		expect(writer.readCurrentText).toHaveBeenCalledExactlyOnceWith(context.file);
		expect(writer.write).toHaveBeenCalledExactlyOnceWith(
			context.file,
			'# Note\n{~~Original~>Edited~~} text',
		);
	});

	it.each(['ask', 'discuss', 'brainstorm'] as const)(
		'never reads or writes annotated text in %s mode',
		async (mode: Mode) => {
			const context = makeContext();
			const { writer } = makeWriter();

			const result = await applyPreparedEdit(
				mode,
				context,
				{
					annotatedMarkdown: '# Note\n{--Original--} text',
					changeCount: 1,
					summaryItems: SUMMARY_ITEMS,
					summary: 'Model prose must not leak from a read-only path.',
				},
				writer,
			);

			expect(result).toEqual({
				applied: false,
				changeCount: 0,
				summaryItems: [],
				summary: undefined,
			});
			expect(result.summary).toBeUndefined();
			expect(writer.readCurrentText).not.toHaveBeenCalled();
			expect(writer.isTargetCurrent).not.toHaveBeenCalled();
			expect(writer.write).not.toHaveBeenCalled();
		},
	);

	it('rejects without a result when the guarded write fails', async () => {
		const context = makeContext();
		const { writer } = makeWriter();
		const writeError = new Error('Vault write failed');
		writer.write = vi.fn(async () => {
			throw writeError;
		});

		await expect(
			applyPreparedEdit(
				'edit',
				context,
				{
					annotatedMarkdown: '# Note\n{++Added++}\nOriginal text',
					changeCount: 1,
					summaryItems: SUMMARY_ITEMS,
				},
				writer,
			),
		).rejects.toBe(writeError);

		expect(writer.write).toHaveBeenCalledOnce();
	});
});

describe('createVaultNoteWriter', () => {
	it('reads current text and adapts writes to vault.modify', async () => {
		const context = makeContext();
		const vault = {
			read: vi.fn(async () => context.sourceText),
			modify: vi.fn(async () => undefined),
		};
		const isTargetCurrent = vi.fn(() => true);
		const writer = createVaultNoteWriter(
			vault as unknown as Vault,
			isTargetCurrent,
		);

		await expect(writer.readCurrentText(context.file)).resolves.toBe(
			context.sourceText,
		);
		await writer.write(context.file, 'updated');
		expect(writer.isTargetCurrent(context.file)).toBe(true);

		expect(vault.read).toHaveBeenCalledExactlyOnceWith(context.file);
		expect(vault.modify).toHaveBeenCalledExactlyOnceWith(context.file, 'updated');
		expect(isTargetCurrent).toHaveBeenCalledExactlyOnceWith(context.file);
	});

	it('forwards an optional editor-text reader and omits it when absent', async () => {
		const context = makeContext();
		const vault = {
			read: vi.fn(async () => context.sourceText),
			modify: vi.fn(async () => undefined),
		};
		const readEditorTexts = vi.fn((file: TFile) => [`${file.path}:editor`]);

		const writer = createVaultNoteWriter(
			vault as unknown as Vault,
			() => true,
			readEditorTexts,
		);
		const diskOnlyWriter = createVaultNoteWriter(
			vault as unknown as Vault,
			() => true,
		);

		expect(writer.readEditorTexts?.(context.file)).toEqual([
			'folder/note.md:editor',
		]);
		expect(readEditorTexts).toHaveBeenCalledExactlyOnceWith(context.file);
		expect(diskOnlyWriter.readEditorTexts).toBeUndefined();
	});
});
