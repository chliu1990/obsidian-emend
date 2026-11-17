import { Notice, TFile, type Vault } from 'obsidian';
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
	extractSkillPaths,
	loadAllInstructions,
	MAX_INSTRUCTION_CHARACTERS,
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
	unreadable: Set<string> = new Set(),
) {
	return {
		getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
		read: vi.fn(async (file: TFile) => {
			events.push(`start:${file.path}`);
			await Promise.resolve();
			events.push(`end:${file.path}`);
			if (unreadable.has(file.path)) {
				throw new Error(`Unreadable file: ${file.path}`);
			}
			return contents.get(file.path) ?? '';
		}),
	};
}

function noticeMessages(): string[] {
	return (Notice as unknown as { messages: string[] }).messages;
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
	beforeEach(() => {
		noticeMessages().length = 0;
	});

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

	it('skips a skill whose read rejects and keeps the rest', async () => {
		const files = new Map<string, TFile>([
			['AGENTS.md', markdownFile('AGENTS.md')],
			['skills/broken/SKILL.md', markdownFile('skills/broken/SKILL.md')],
			['skills/valid/SKILL.md', markdownFile('skills/valid/SKILL.md')],
		]);
		const contents = new Map<string, string>([
			['AGENTS.md', '`skills/broken`\n`skills/valid`'],
			['skills/broken/SKILL.md', 'Broken skill.'],
			['skills/valid/SKILL.md', 'Valid skill.'],
		]);
		const vault = vaultWith(
			files,
			contents,
			[],
			new Set(['skills/broken/SKILL.md']),
		);

		const result = await loadAllInstructions(vault as unknown as Vault);

		expect(result.agentText).toBe('`skills/broken`\n`skills/valid`');
		expect(result.skillTexts).toEqual(new Map([
			['skills/valid/SKILL.md', 'Valid skill.'],
		]));
		expect(noticeMessages()).toEqual([
			'Emend: Could not read the instruction file skills/broken/SKILL.md.',
		]);
	});

	it('bounds total instruction characters', async () => {
		const largeSkill = 'S'.repeat(15000);
		const largeAgentText = 'A'.repeat(15000);
		const files = new Map<string, TFile>([
			['AGENTS.md', markdownFile('AGENTS.md')],
			['skills/large/SKILL.md', markdownFile('skills/large/SKILL.md')],
		]);
		const contents = new Map<string, string>([
			['AGENTS.md', `\`skills/large\`\n${largeAgentText}`],
			['skills/large/SKILL.md', largeSkill],
		]);
		const vault = vaultWith(files, contents);

		const result = await loadAllInstructions(vault as unknown as Vault);

		const total = (result.agentText?.length ?? 0) +
			Array.from(result.skillTexts.values()).reduce(
				(sum, text) => sum + text.length,
				0,
			);
		expect(result.skillTexts.get('skills/large/SKILL.md')).toBe(largeSkill);
		expect(result.agentText).toHaveLength(
			MAX_INSTRUCTION_CHARACTERS - largeSkill.length,
		);
		expect(result.agentText?.endsWith('[...]')).toBe(true);
		expect(total).toBe(MAX_INSTRUCTION_CHARACTERS);
		expect(total).toBeLessThanOrEqual(MAX_INSTRUCTION_CHARACTERS);
		expect(noticeMessages()).toEqual([
			'Emend: Instructions were truncated at 20000 characters.',
		]);
	});
	it.each([5, 3])(
		'omits the agent text when only %i characters of budget remain',
		async (remainingBudget) => {
			const fillSkill = 'S'.repeat(MAX_INSTRUCTION_CHARACTERS - remainingBudget);
			const files = new Map<string, TFile>([
				['AGENTS.md', markdownFile('AGENTS.md')],
				['skills/fill/SKILL.md', markdownFile('skills/fill/SKILL.md')],
			]);
			const contents = new Map<string, string>([
				['AGENTS.md', `\`skills/fill\`\n${'A'.repeat(100)}`],
				['skills/fill/SKILL.md', fillSkill],
			]);
			const vault = vaultWith(files, contents);

			const result = await loadAllInstructions(vault as unknown as Vault);

			expect(result.skillTexts.get('skills/fill/SKILL.md')).toBe(fillSkill);
			expect(result.agentText).toBeUndefined();
			expect(noticeMessages()).toEqual([
				'Emend: Instructions were truncated at 20000 characters.',
			]);
		},
	);

	it('skips an unreadable AGENTS.md and still loads skills', async () => {
		const files = new Map<string, TFile>([
			['AGENTS.md', markdownFile('AGENTS.md')],
			['skills/valid/SKILL.md', markdownFile('skills/valid/SKILL.md')],
		]);
		const contents = new Map<string, string>([
			['AGENTS.md', '`skills/valid`'],
			['skills/valid/SKILL.md', 'Valid skill.'],
		]);
		let rootReads = 0;
		const vault = {
			getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
			read: vi.fn(async (file: TFile) => {
				if (file.path === 'AGENTS.md') {
					rootReads += 1;
					if (rootReads === 1) {
						throw new Error('Unreadable root');
					}
				}
				return contents.get(file.path) ?? '';
			}),
		};

		const skipped = await loadAllInstructions(vault as unknown as Vault);

		expect(skipped.agentText).toBeUndefined();
		expect(skipped.skillTexts).toEqual(new Map());
		expect(noticeMessages()).toEqual([
			'Emend: Could not read the instruction file AGENTS.md.',
		]);

		const retried = await loadAllInstructions(vault as unknown as Vault);

		expect(retried.agentText).toBe('`skills/valid`');
		expect(retried.skillTexts).toEqual(new Map([
			['skills/valid/SKILL.md', 'Valid skill.'],
		]));
		expect(noticeMessages()).toHaveLength(1);
	});
});
