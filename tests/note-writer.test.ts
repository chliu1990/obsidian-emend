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

function makeWriter(currentText = '# Note\nOriginal text') {
	let targetCurrent = true;
	const writer: NoteWriter = {
		readCurrentText: vi.fn(async () => currentText),
		write: vi.fn(async () => undefined),
		isTargetCurrent: vi.fn(() => targetCurrent),
	};
	return {
		writer,
		setTargetCurrent: (value: boolean) => {
			targetCurrent = value;
		},
	};
}

describe('applyPreparedEdit', () => {
	it('writes a validated Edit response once to the captured file', async () => {
		const context = makeContext();
		const { writer } = makeWriter();
		const annotatedMarkdown = '# Note\n{~~Original~>Edited~~} text';

		const result = await applyPreparedEdit(
			'edit',
			context,
			{ annotatedMarkdown, changeCount: 1 },
			writer,
		);

		expect(result).toEqual({ applied: true, changeCount: 1 });
		expect(writer.readCurrentText).toHaveBeenCalledExactlyOnceWith(context.file);
		expect(writer.isTargetCurrent).toHaveBeenCalledExactlyOnceWith(context.file);
		expect(writer.write).toHaveBeenCalledExactlyOnceWith(
			context.file,
			annotatedMarkdown,
		);
	});

	it('does not write or re-read an unchanged response', async () => {
		const context = makeContext();
		const { writer } = makeWriter();

		const result = await applyPreparedEdit(
			'edit',
			context,
			{ annotatedMarkdown: context.sourceText, changeCount: 0 },
			writer,
		);

		expect(result).toEqual({ applied: false, changeCount: 0 });
		expect(writer.readCurrentText).not.toHaveBeenCalled();
		expect(writer.write).not.toHaveBeenCalled();
	});

	it('applies a valid comment-only edit with zero text changes', async () => {
		const context = makeContext();
		const { writer } = makeWriter();
		const annotatedMarkdown = `${context.sourceText}{>>Review this.<<}`;

		const result = await applyPreparedEdit(
			'edit',
			context,
			{ annotatedMarkdown, changeCount: 0 },
			writer,
		);

		expect(result).toEqual({ applied: true, changeCount: 0 });
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
				},
				writer,
			),
		).rejects.toThrow(STALE_ERROR);

		expect(writer.write).not.toHaveBeenCalled();
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
				},
				writer,
			);

			expect(result).toEqual({ applied: false, changeCount: 0 });
			expect(writer.readCurrentText).not.toHaveBeenCalled();
			expect(writer.isTargetCurrent).not.toHaveBeenCalled();
			expect(writer.write).not.toHaveBeenCalled();
		},
	);
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
});
