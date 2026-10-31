import { TFile, type Vault } from 'obsidian';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
	extractSkillPaths,
	loadAllInstructions,
	type LoadedInstructions,
} from '../src/instructions-loader';
import type { InstructionPromptParts } from '../src/types';

function markdownFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	return file;
}

function vaultWith(
	files: Map<string, TFile | { path: string }>,
	contents: Map<string, string>,
	events: string[] = [],
) {
	return {
		getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
		read: vi.fn(async (file: TFile) => {
			events.push(`start:${file.path}`);
			await Promise.resolve();
			events.push(`end:${file.path}`);
			return contents.get(file.path) ?? '';
		}),
	};
}

describe('extractSkillPaths', () => {
	it('extracts directory and explicit Markdown references from inline code and links', () => {
		const agentText = [
			'`skills/track-changes-review`',
			'`skills/trailing/`',
			'`skills/explicit/SKILL.md`',
			'[Linked directory](skills/linked)',
			'[Linked file](skills/linked-file/SKILL.md)',
		].join('\n');

		expect(extractSkillPaths(agentText)).toEqual([
			'skills/track-changes-review/SKILL.md',
			'skills/trailing/SKILL.md',
			'skills/explicit/SKILL.md',
			'skills/linked/SKILL.md',
			'skills/linked-file/SKILL.md',
		]);
	});

	it('normalizes repeated slashes and one trailing slash', () => {
		expect(extractSkillPaths('`skills//review///`')).toEqual([
			'skills/review/SKILL.md',
		]);
	});

	it('preserves discovery order and deduplicates normalized references', () => {
		const agentText = [
			'`skills/first`',
			'[Second](skills/second/SKILL.md)',
			'`skills//first/`',
			'[Third](skills/third)',
			'[Second again](skills/second/)',
		].join('\n');

		expect(extractSkillPaths(agentText)).toEqual([
			'skills/first/SKILL.md',
			'skills/second/SKILL.md',
			'skills/third/SKILL.md',
		]);
	});

	it.each([
		'`skills\\review`',
		'`/skills/review`',
		'`../skills/review`',
		'`skills/../review`',
		'`https://example.test/skills/review`',
		'[Remote](https://example.test/skills/review/SKILL.md)',
		'`skills/review/README.txt`',
		'[Image](skills/review/image.png)',
		'`other/review`',
	])('rejects unsafe or non-skill reference %s', (reference) => {
		expect(extractSkillPaths(reference)).toEqual([]);
	});
});

describe('loadAllInstructions', () => {
	it('is structurally compatible with instruction prompt parts', () => {
		expectTypeOf<LoadedInstructions>().toExtend<InstructionPromptParts>();
	});

	it('returns no instructions when vault-root AGENTS.md is missing', async () => {
		const vault = vaultWith(new Map(), new Map());

		const result = await loadAllInstructions(vault as unknown as Vault);

		expect(result.agentText).toBeUndefined();
		expect(result.skillTexts).toEqual(new Map());
		expect(vault.getAbstractFileByPath).toHaveBeenCalledExactlyOnceWith('AGENTS.md');
		expect(vault.read).not.toHaveBeenCalled();
	});

	it('reads skills sequentially in reference order, trims content, and skips missing skills', async () => {
		const events: string[] = [];
		const files = new Map<string, TFile>([
			['AGENTS.md', markdownFile('AGENTS.md')],
			['skills/first/SKILL.md', markdownFile('skills/first/SKILL.md')],
			['skills/second/SKILL.md', markdownFile('skills/second/SKILL.md')],
		]);
		const contents = new Map<string, string>([
			[
				'AGENTS.md',
				'Agent text\n`skills/first`\n`skills/missing`\n[Second](skills/second/SKILL.md)',
			],
			['skills/first/SKILL.md', '  First skill.  '],
			['skills/second/SKILL.md', '\nSecond skill.\n'],
		]);
		const vault = vaultWith(files, contents, events);

		const result = await loadAllInstructions(vault as unknown as Vault);

		expect(result.agentText).toBe(contents.get('AGENTS.md'));
		expect(result.skillTexts).toEqual(new Map([
			['skills/first/SKILL.md', 'First skill.'],
			['skills/second/SKILL.md', 'Second skill.'],
		]));
		expect(vault.getAbstractFileByPath).toHaveBeenNthCalledWith(1, 'AGENTS.md');
		expect(vault.getAbstractFileByPath).toHaveBeenNthCalledWith(2, 'skills/first/SKILL.md');
		expect(vault.getAbstractFileByPath).toHaveBeenNthCalledWith(3, 'skills/missing/SKILL.md');
		expect(vault.getAbstractFileByPath).toHaveBeenNthCalledWith(4, 'skills/second/SKILL.md');
		expect(events).toEqual([
			'start:AGENTS.md',
			'end:AGENTS.md',
			'start:skills/first/SKILL.md',
			'end:skills/first/SKILL.md',
			'start:skills/second/SKILL.md',
			'end:skills/second/SKILL.md',
		]);
	});

	it('reads only Markdown TFiles and skips other vault entries', async () => {
		const files = new Map<string, TFile | { path: string }>([
			['AGENTS.md', markdownFile('AGENTS.md')],
			['skills/folder/SKILL.md', { path: 'skills/folder/SKILL.md' }],
			['skills/valid/SKILL.md', markdownFile('skills/valid/SKILL.md')],
		]);
		const contents = new Map<string, string>([
			['AGENTS.md', '`skills/folder`\n`skills/valid`'],
			['skills/valid/SKILL.md', 'Valid skill.'],
		]);
		const vault = vaultWith(files, contents);

		const result = await loadAllInstructions(vault as unknown as Vault);

		expect(result.skillTexts).toEqual(new Map([
			['skills/valid/SKILL.md', 'Valid skill.'],
		]));
		expect(vault.read).toHaveBeenCalledTimes(2);
		expect(vault.read).not.toHaveBeenCalledWith(files.get('skills/folder/SKILL.md'));
	});

	it('rereads current root and skill content on every call', async () => {
		const files = new Map<string, TFile>([
			['AGENTS.md', markdownFile('AGENTS.md')],
			['skills/first/SKILL.md', markdownFile('skills/first/SKILL.md')],
			['skills/second/SKILL.md', markdownFile('skills/second/SKILL.md')],
		]);
		const contents = new Map<string, string>([
			['AGENTS.md', 'First agent\n`skills/first`'],
			['skills/first/SKILL.md', 'Old first skill.'],
			['skills/second/SKILL.md', 'Current second skill.'],
		]);
		const vault = vaultWith(files, contents);

		const first = await loadAllInstructions(vault as unknown as Vault);
		contents.set('AGENTS.md', 'Updated agent\n`skills/second`');
		contents.set('skills/first/SKILL.md', 'Changed but no longer referenced.');
		const second = await loadAllInstructions(vault as unknown as Vault);

		expect(first.agentText).toBe('First agent\n`skills/first`');
		expect(first.skillTexts.get('skills/first/SKILL.md')).toBe('Old first skill.');
		expect(second.agentText).toBe('Updated agent\n`skills/second`');
		expect(second.skillTexts).toEqual(new Map([
			['skills/second/SKILL.md', 'Current second skill.'],
		]));
		expect(vault.read).toHaveBeenCalledTimes(4);
	});

	it('does not recursively follow references in skill content', async () => {
		const files = new Map<string, TFile>([
			['AGENTS.md', markdownFile('AGENTS.md')],
			['skills/first/SKILL.md', markdownFile('skills/first/SKILL.md')],
			['skills/nested/SKILL.md', markdownFile('skills/nested/SKILL.md')],
		]);
		const contents = new Map<string, string>([
			['AGENTS.md', '`skills/first`'],
			['skills/first/SKILL.md', 'First skill references `skills/nested`.'],
			['skills/nested/SKILL.md', 'Nested skill.'],
		]);
		const vault = vaultWith(files, contents);

		const result = await loadAllInstructions(vault as unknown as Vault);

		expect(result.skillTexts).toEqual(new Map([
			['skills/first/SKILL.md', 'First skill references `skills/nested`.'],
		]));
		expect(vault.getAbstractFileByPath).toHaveBeenCalledTimes(2);
		expect(vault.getAbstractFileByPath).not.toHaveBeenCalledWith('skills/nested/SKILL.md');
	});
});
