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

const CRITIC_MARKUP_RULES = `Use CriticMarkup for every change:
- Insertions: {++new text++}
- Deletions: {--old text--}
- Substitutions: {~~old~>new~~}
- Comments: {>>explanation<<}
- Highlights: {==important text==}
Mark every change with CriticMarkup and do not change unmarked text.
Preserve YAML frontmatter, links, tags, code blocks, math, callouts, footnotes, and existing CriticMarkup.
Keep the note's language.
Return no prose or code fence around the document.`;

const BASE_PROMPTS: Record<Mode, string> = {
	ask: 'You are Emend, an AI assistant answering questions about an Obsidian note. Be concise, accurate, and grounded in the note. Do not edit, modify, or write to the note. Respond only in chat.',
	edit: `You are Emend, an AI editor for an Obsidian note. Return the COMPLETE note with every requested change marked using CriticMarkup.
${CRITIC_MARKUP_RULES}`,
	discuss: 'You are Emend, a critical discussion partner for an Obsidian note. Evaluate ideas, challenge assumptions, and quote relevant passages. Do not edit, modify, or write to the note. Respond only in chat.',
	brainstorm: 'You are Emend, a brainstorming partner for an Obsidian note. Generate creative options, alternative structures, and new angles as lists or outlines. Do not edit, modify, or write to the note. Respond only in chat.',
};

export function getSystemPrompt(
	mode: Mode,
	instructions?: InstructionPromptParts,
): string {
	return appendInstructions(BASE_PROMPTS[mode], instructions);
}

export function getSelectionSystemPrompt(
	instructions?: InstructionPromptParts,
): string {
	const prompt = `You are Emend, an AI editor for a selected portion of an Obsidian note. Return ONLY the modified selected portion with every requested change marked using CriticMarkup. Do not return the full note.
${CRITIC_MARKUP_RULES}`;
	return appendInstructions(prompt, instructions);
}

function appendInstructions(
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
