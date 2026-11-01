import { describe, expect, expectTypeOf, it } from 'vitest';
import * as modeModule from '../src/mode';
import { getSystemPrompt, MODES } from '../src/mode';
import type {
	AiMessage,
	InstructionPromptParts,
	Mode,
	ProviderHistoryMessage,
	ProviderHistoryOrigin,
	ProviderWireHistoryMessage,
} from '../src/types';

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

	it('adds mode and origin to internal provider history', () => {
		expectTypeOf<ProviderHistoryMessage>().toEqualTypeOf<{
			role: 'user' | 'assistant';
			content: string;
			mode: Mode;
			origin: ProviderHistoryOrigin;
		}>();
		expectTypeOf<ProviderHistoryOrigin>().toEqualTypeOf<
			'user' | 'model' | 'local-edit-status'
		>();
	});

	it('limits wire provider history to roles and content', () => {
		expectTypeOf<ProviderWireHistoryMessage>().toEqualTypeOf<{
			role: 'user' | 'assistant';
			content: string;
		}>();
	});
});

describe('system prompts', () => {
	it.each(['ask', 'discuss', 'brainstorm'] as const)(
		'forbids note writes in %s mode',
		(mode) => {
			const prompt = getSystemPrompt(mode);
			expect(prompt).toContain('Do not edit, modify, or write to the note.');
			expect(prompt).toContain('Respond only in chat.');
		},
	);

	it('exposes only read-only modes through the shared system prompt builder', () => {
		expectTypeOf(getSystemPrompt)
			.parameter(0)
			.toEqualTypeOf<'ask' | 'discuss' | 'brainstorm'>();
	});

	it('has no model-facing CriticMarkup selection prompt export', () => {
		expect(modeModule).not.toHaveProperty('getSelectionSystemPrompt');
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
