import type { InstructionPromptParts, Mode } from './types';

export const MODES: Array<{
	id: Mode;
	label: string;
	icon: string;
	canWrite: boolean;
}> = [
	{ id: 'ask', label: 'Ask', icon: 'message-circle', canWrite: false },
	{ id: 'edit', label: 'Edit', icon: 'pen-line', canWrite: true },
	{ id: 'discuss', label: 'Discuss', icon: 'messages-square', canWrite: false },
	{ id: 'brainstorm', label: 'Brainstorm', icon: 'lightbulb', canWrite: false },
];

const BASE_PROMPTS: Record<Exclude<Mode, 'edit'>, string> = {
	ask: 'You are Emend, an AI assistant answering questions about an Obsidian note. Be concise, accurate, and grounded in the note. Do not edit, modify, or write to the note. Respond only in chat.',
	discuss: 'You are Emend, a critical discussion partner for an Obsidian note. Evaluate ideas, challenge assumptions, and quote relevant passages. Do not edit, modify, or write to the note. Respond only in chat.',
	brainstorm: 'You are Emend, a brainstorming partner for an Obsidian note. Generate creative options, alternative structures, and new angles as lists or outlines. Do not edit, modify, or write to the note. Respond only in chat.',
};

export function getSystemPrompt(
	mode: Exclude<Mode, 'edit'>,
	instructions?: InstructionPromptParts,
): string {
	return appendInstructions(BASE_PROMPTS[mode], instructions);
}

export function appendInstructions(
	prompt: string,
	instructions?: InstructionPromptParts,
): string {
	if (!instructions) {
		return prompt;
	}

	const sections = [prompt];
	const skills = Array.from(instructions.skillTexts, ([path, text]) => ({
		path,
		text: text.trim(),
	})).filter((skill) => skill.text.length > 0);

	if (skills.length > 0) {
		sections.push('=== Loaded Skills ===');
		for (const skill of skills) {
			const skillName = skill.path.split('/').slice(-2, -1)[0] || skill.path;
			sections.push(`--- Skill: ${skillName} ---\n${skill.text}`);
		}
	}

	const agentText = instructions.agentText?.trim();
	if (agentText) {
		sections.push(`=== Agent Instructions ===\n${agentText}`);
	}

	return sections.join('\n\n');
}
