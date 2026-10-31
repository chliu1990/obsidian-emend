import { TFile, type MarkdownView } from 'obsidian';
import { describe, expect, it } from 'vitest';
import {
	captureRequestContext,
	getBoundedContext,
} from '../src/context';

function markdownFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	return file;
}

describe('getBoundedContext', () => {
	it('returns a note below the configured limit unchanged', () => {
		const sourceText = '# Short note\nA small amount of text.';

		expect(getBoundedContext(sourceText, 4, 4, 100)).toBe(sourceText);
	});

	it('centers a caret window and marks both omitted edges exactly', () => {
		const sourceText = '0123456789'.repeat(10);

		expect(getBoundedContext(sourceText, 50, 50, 20)).toBe(
			`[...]\n${sourceText.slice(40, 60)}\n[...]`,
		);
	});

	it('centers a selection without splitting it', () => {
		const sourceText = '0123456789'.repeat(10);

		expect(getBoundedContext(sourceText, 40, 50, 20)).toBe(
			`[...]\n${sourceText.slice(35, 55)}\n[...]`,
		);
	});

	it('redistributes unused budget at the start toward later text', () => {
		const sourceText = '0123456789'.repeat(10);

		expect(getBoundedContext(sourceText, 3, 3, 20)).toBe(
			`${sourceText.slice(0, 20)}\n[...]`,
		);
	});

	it('redistributes unused budget at the end toward earlier text', () => {
		const sourceText = '0123456789'.repeat(10);

		expect(getBoundedContext(sourceText, 97, 97, 20)).toBe(
			`[...]\n${sourceText.slice(80, 100)}`,
		);
	});
});

describe('captureRequestContext', () => {
	it('captures file identity, source, selection, and labels before asynchronous work', () => {
		const file = markdownFile('folder/note.md');
		const sourceText = '0123456789'.repeat(10);
		const view = {
			file,
			editor: {
				getValue: () => sourceText,
				getCursor: (which: 'from' | 'to') => ({ offset: which === 'from' ? 40 : 50 }),
				posToOffset: (position: { offset: number }) => position.offset,
			},
			app: { vault: { getName: () => 'Vault name' } },
		} as unknown as MarkdownView;

		const context = captureRequestContext(view, {
			maxCharacters: 20,
			includeNotePath: true,
		});

		expect(context).toEqual({
			file,
			sourceText,
			selection: { from: 40, to: 50 },
			noteLabel: 'folder/note.md',
			notePath: 'Vault name/folder/note.md',
			markdown: `[...]\n${sourceText.slice(35, 55)}\n[...]`,
		});
		expect(view.editor.getValue()).toBe(context.sourceText);
	});

	it('omits the vault-qualified path unless note-path sharing is enabled', () => {
		const file = markdownFile('private/note.md');
		const view = {
			file,
			editor: {
				getValue: () => 'Private text',
				getCursor: () => ({ offset: 0 }),
				posToOffset: () => 0,
			},
			app: { vault: { getName: () => 'Private vault' } },
		} as unknown as MarkdownView;

		const context = captureRequestContext(view, {
			maxCharacters: 100,
			includeNotePath: false,
		});

		expect(context.notePath).toBeUndefined();
		expect(context.noteLabel).toBe('private/note.md');
		expect(context.markdown).toBe('Private text');
	});
});
