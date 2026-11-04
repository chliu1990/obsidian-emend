import { TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import {
	captureAdditionalNotes,
	formatAdditionalNotesPrompt,
	type AdditionalNoteSnapshot,
} from '../src/additional-notes-context';

function markdownFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	return file;
}

function createVault(entries: Record<string, string | null>) {
	const files = new Map<string, TFile>();
	const contents = new Map<string, string>();
	for (const [path, content] of Object.entries(entries)) {
		if (content === null) {
			continue;
		}
		files.set(path, markdownFile(path));
		contents.set(path, content);
	}

	return {
		getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
		read: vi.fn(async (file: TFile) => contents.get(file.path) ?? ''),
		getName: vi.fn(() => 'Vault'),
	};
}

function captureOptions(
	paths: readonly string[],
	maxCharacters = 100,
	signal = new AbortController().signal,
) {
	return {
		activeNotePath: 'active.md',
		paths,
		includeNotePath: false,
		maxCharacters,
		signal,
	};
}

describe('captureAdditionalNotes', () => {
	it('deduplicates active and repeated paths and reads only selected notes in order', async () => {
		const vault = createVault({
			'active.md': 'Active',
			'first.md': 'First',
			'second.md': 'Second',
			'unselected.md': 'Unselected',
		});

		const notes = await captureAdditionalNotes(vault, captureOptions([
			'second.md',
			'active.md',
			'first.md',
			'second.md',
			'first.md',
		]));

		expect(notes.map((note) => note.sourcePath)).toEqual(['second.md', 'first.md']);
		expect(notes.map((note) => note.markdown)).toEqual(['Second', 'First']);
		expect(vault.getAbstractFileByPath.mock.calls.map(([path]) => path)).toEqual([
			'second.md',
			'first.md',
		]);
		expect(vault.read.mock.calls.map(([file]) => file.path)).toEqual([
			'second.md',
			'first.md',
		]);
		expect(vault.getAbstractFileByPath).not.toHaveBeenCalledWith('unselected.md');
		expect(vault.read).not.toHaveBeenCalledWith(
			expect.objectContaining({ path: 'unselected.md' }),
		);
	});

	it('returns no snapshots and performs no vault access for empty input', async () => {
		const vault = createVault({ 'unselected.md': 'Unselected' });

		await expect(captureAdditionalNotes(vault, captureOptions([]))).resolves.toEqual([]);

		expect(vault.getAbstractFileByPath).not.toHaveBeenCalled();
		expect(vault.read).not.toHaveBeenCalled();
		expect(vault.getName).not.toHaveBeenCalled();
	});

	it('uses fair per-note caps and counts only included source characters', async () => {
		const vault = createVault({
			'first.md': '0123456789',
			'second.md': 'abcdefghij',
		});

		const notes = await captureAdditionalNotes(
			vault,
			captureOptions(['first.md', 'second.md'], 9),
		);

		expect(notes).toEqual([
			{
				sourcePath: 'first.md',
				providerPath: undefined,
				markdown: '0123\n[...]',
				sourceCharacters: 10,
				includedCharacters: 4,
			},
			{
				sourcePath: 'second.md',
				providerPath: undefined,
				markdown: 'abcde\n[...]',
				sourceCharacters: 10,
				includedCharacters: 5,
			},
		]);
		expect(notes.reduce((total, note) => total + note.includedCharacters, 0)).toBe(9);
		expect(notes[0]?.markdown.length).toBeGreaterThan(notes[0]?.includedCharacters ?? 0);
	});

	it('redistributes unused budget from shorter notes to later notes', async () => {
		const secondSource = 'abcdefghijklmnopqrstuvwxyz'.repeat(4);
		const vault = createVault({
			'first.md': '0123456789',
			'second.md': secondSource,
		});

		const notes = await captureAdditionalNotes(
			vault,
			captureOptions(['first.md', 'second.md'], 40),
		);

		expect(notes).toEqual([
			{
				sourcePath: 'first.md',
				providerPath: undefined,
				markdown: '0123456789',
				sourceCharacters: 10,
				includedCharacters: 10,
			},
			{
				sourcePath: 'second.md',
				providerPath: undefined,
				markdown: 'abcdefghijklmnopqrstuvwxyzabcd\n[...]',
				sourceCharacters: 104,
				includedCharacters: 30,
			},
		]);
		expect(notes.reduce((total, note) => total + note.includedCharacters, 0)).toBe(40);
	});

	it('preserves empty files, Unicode, frontmatter, wikilinks, fences, and math', async () => {
		const richMarkdown = [
			'---',
			'title: Café 😀',
			'---',
			'',
			'See [[Other note]].',
			'',
			'```ts',
			'const π = Math.PI;',
			'```',
			'',
			'$$',
			'e^{i\\pi} + 1 = 0',
			'$$',
		].join('\n');
		const vault = createVault({
			'empty.md': '',
			'rich.md': richMarkdown,
		});

		const notes = await captureAdditionalNotes(
			vault,
			captureOptions(['empty.md', 'rich.md'], 1_000),
		);

		expect(notes).toEqual([
			{
				sourcePath: 'empty.md',
				providerPath: undefined,
				markdown: '',
				sourceCharacters: 0,
				includedCharacters: 0,
			},
			{
				sourcePath: 'rich.md',
				providerPath: undefined,
				markdown: richMarkdown,
				sourceCharacters: richMarkdown.length,
				includedCharacters: richMarkdown.length,
			},
		]);
	});

	it('fails explicitly when two notes share a one-character budget', async () => {
		const vault = createVault({ 'first.md': 'First', 'second.md': 'Second' });

		await expect(captureAdditionalNotes(
			vault,
			captureOptions(['first.md', 'second.md'], 1),
		)).rejects.toThrow('Too many additional notes for the configured context budget.');
	});

	it('resolves every path before reading and names a missing note', async () => {
		const vault = createVault({ 'first.md': 'First', 'missing.md': null });

		await expect(captureAdditionalNotes(
			vault,
			captureOptions(['first.md', 'missing.md']),
		)).rejects.toThrow('Additional note not found: missing.md. Remove it and retry.');

		expect(vault.getAbstractFileByPath.mock.calls.map(([path]) => path)).toEqual([
			'first.md',
			'missing.md',
		]);
		expect(vault.read).not.toHaveBeenCalled();
	});

	it('rejects non-Markdown files before any read', async () => {
		const vault = createVault({ 'note.txt': 'Plain text' });

		await expect(captureAdditionalNotes(
			vault,
			captureOptions(['note.txt']),
		)).rejects.toThrow(
			'Additional note is not a Markdown file: note.txt. Remove it and retry.',
		);
		expect(vault.read).not.toHaveBeenCalled();
	});

	it('honors an abort before vault resolution or reads', async () => {
		const controller = new AbortController();
		controller.abort();
		const vault = createVault({ 'first.md': 'First' });

		await expect(captureAdditionalNotes(
			vault,
			captureOptions(['first.md'], 100, controller.signal),
		)).rejects.toMatchObject({ name: 'AbortError' });
		expect(vault.getAbstractFileByPath).not.toHaveBeenCalled();
		expect(vault.read).not.toHaveBeenCalled();
	});

	it('honors an abort after a read and does not start later reads', async () => {
		const controller = new AbortController();
		let finishFirstRead!: (value: string) => void;
		const files = new Map(['first.md', 'second.md'].map((path) => [path, markdownFile(path)]));
		const vault = {
			getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
			read: vi.fn((file: TFile) => new Promise<string>((resolve) => {
				if (file.path === 'first.md') {
					finishFirstRead = resolve;
				} else {
					resolve('Second');
				}
			})),
			getName: vi.fn(() => 'Vault'),
		};

		const capture = captureAdditionalNotes(
			vault,
			captureOptions(['first.md', 'second.md'], 100, controller.signal),
		);
		await vi.waitFor(() => expect(vault.read).toHaveBeenCalledTimes(1));
		controller.abort();
		finishFirstRead('First');

		await expect(capture).rejects.toMatchObject({ name: 'AbortError' });
		expect(vault.read.mock.calls.map(([file]) => file.path)).toEqual(['first.md']);
	});

	it('adds a vault-qualified provider path only when path sharing is enabled', async () => {
		const vault = createVault({ 'folder/note.md': 'Content' });

		const notes = await captureAdditionalNotes(vault, {
			...captureOptions(['folder/note.md']),
			includeNotePath: true,
		});

		expect(notes[0]?.providerPath).toBe('Vault/folder/note.md');
	});
});

describe('formatAdditionalNotesPrompt', () => {
	it('returns an empty string for no notes', () => {
		expect(formatAdditionalNotesPrompt([])).toBe('');
	});

	it('uses separately numbered read-only sections without leaking local paths', () => {
		const notes: AdditionalNoteSnapshot[] = [
			{
				sourcePath: 'private/path.md',
				markdown: 'Alpha',
				sourceCharacters: 5,
				includedCharacters: 5,
			},
			{
				sourcePath: 'secret/other.md',
				markdown: 'Beta',
				sourceCharacters: 4,
				includedCharacters: 4,
			},
		];

		const prompt = formatAdditionalNotesPrompt(notes);

		expect(prompt).toBe([
			'## Additional note 1',
			'Additional notes are read-only context and are not edit targets.',
			'',
			'```markdown',
			'Alpha',
			'```',
			'',
			'## Additional note 2',
			'Additional notes are read-only context and are not edit targets.',
			'',
			'```markdown',
			'Beta',
			'```',
		].join('\n'));
		expect(prompt).not.toContain('private/path.md');
		expect(prompt).not.toContain('path.md');
		expect(prompt).not.toContain('secret/other.md');
		expect(prompt).not.toContain('other.md');
		expect(prompt).not.toContain('Vault');
	});

	it('adds a separate vault-qualified path line only when provided', () => {
		const notes: AdditionalNoteSnapshot[] = [{
			sourcePath: 'path.md',
			providerPath: 'Vault/path.md',
			markdown: 'Content',
			sourceCharacters: 7,
			includedCharacters: 7,
		}];

		expect(formatAdditionalNotesPrompt(notes)).toBe([
			'## Additional note 1',
			'Additional notes are read-only context and are not edit targets.',
			'Path: Vault/path.md',
			'',
			'```markdown',
			'Content',
			'```',
		].join('\n'));
	});
});
