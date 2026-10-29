import { describe, expect, expectTypeOf, it } from 'vitest';
import { getSelectionSystemPrompt, getSystemPrompt, MODES } from '../src/mode';
import type {
	AiMessage,
	InstructionPromptParts,
	Mode,
	ProviderHistoryMessage,
} from '../src/types';

const criticMarkupExamples = [
	'{++new text++}',
	'{--old text--}',
	'{~~old~>new~~}',
	'{>>explanation<<}',
	'{==important text==}',
];

const preservedMarkdown = [
	'YAML frontmatter',
	'links',
	'tags',
	'code blocks',
	'math',
	'callouts',
	'footnotes',
	'existing CriticMarkup',
];

function expectCriticMarkupRules(prompt: string) {
	for (const example of criticMarkupExamples) {
		expect(prompt).toContain(example);
	}
	for (const markdown of preservedMarkdown) {
		expect(prompt).toContain(markdown);
	}
	expect(prompt).toContain("note's language");
	expect(prompt).toContain('no prose or code fence');
}

describe('mode definitions and message contracts', () => {
	it('defines exactly four modes with unique IDs, labels, and icons', () => {
		expect(MODES).toEqual([
			{ id: 'ask', label: 'Ask', icon: 'message-circle', canWrite: false },
			{ id: 'edit', label: 'Edit', icon: 'pen-line', canWrite: true },
			{ id: 'discuss', label: 'Discuss', icon: 'messages-square', canWrite: false },
			{ id: 'brainstorm', label: 'Brainstorm', icon: 'lightbulb', canWrite: false },
		]);
		expect(new Set(MODES.map((mode) => mode.id)).size).toBe(MODES.length);
		expect(new Set(MODES.map((mode) => mode.label)).size).toBe(MODES.length);
		expect(new Set(MODES.map((mode) => mode.icon)).size).toBe(MODES.length);
	});

	it('adds the selected mode to AI messages', () => {
		expectTypeOf<AiMessage>().toEqualTypeOf<{
			role: 'user' | 'assistant';
			content: string;
			mode: Mode;
		}>();
	});

	it('limits provider history to roles and content', () => {
		expectTypeOf<ProviderHistoryMessage>().toEqualTypeOf<{
			role: 'user' | 'assistant';
			content: string;
		}>();
	});
});

describe('system prompts', () => {
	it.each<Mode>(['ask', 'discuss', 'brainstorm'])(
		'forbids note writes in %s mode',
		(mode) => {
			const prompt = getSystemPrompt(mode);
			expect(prompt).toContain('Do not edit, modify, or write to the note.');
			expect(prompt).toContain('Respond only in chat.');
		},
	);

	it('requires a complete CriticMarkup document in edit mode', () => {
		const prompt = getSystemPrompt('edit');
		expect(prompt).toContain('Return the COMPLETE note');
		expect(prompt).toContain('Mark every change with CriticMarkup');
		expectCriticMarkupRules(prompt);
	});

	it('requires only the modified selection with the same editing rules', () => {
		const prompt = getSelectionSystemPrompt();
		expect(prompt).toContain('Return ONLY the modified selected portion');
		expect(prompt).toContain('Do not return the full note');
		expect(prompt).toContain('Mark every change with CriticMarkup');
		expectCriticMarkupRules(prompt);
	});

	it('appends skills in discovery order before agent instructions', () => {
		const instructions: InstructionPromptParts = {
			agentText: '  Agent instructions refine the skills.  ',
			skillTexts: new Map([
				['skills/first/SKILL.md', '  First skill instructions.  '],
				['skills/second/SKILL.md', '  Second skill instructions.  '],
			]),
		};

		const prompt = getSystemPrompt('ask', instructions);
		const first = prompt.indexOf('--- Skill: first ---\nFirst skill instructions.');
		const second = prompt.indexOf('--- Skill: second ---\nSecond skill instructions.');
		const agent = prompt.indexOf('=== Agent Instructions ===\nAgent instructions refine the skills.');

		expect(prompt).toContain('=== Loaded Skills ===');
		expect(first).toBeGreaterThan(-1);
		expect(second).toBeGreaterThan(first);
		expect(agent).toBeGreaterThan(second);
		expect(prompt.endsWith('Agent instructions refine the skills.')).toBe(true);
	});

	it('omits instruction headings when there is no instruction content', () => {
		const prompt = getSystemPrompt('discuss', {
			agentText: '   ',
			skillTexts: new Map([['skills/empty/SKILL.md', '   ']]),
		});

		expect(prompt).not.toContain('=== Loaded Skills ===');
		expect(prompt).not.toContain('=== Agent Instructions ===');
		expect(prompt).not.toContain('--- Skill:');
	});
});
