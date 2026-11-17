import { Notice, TFile, type Vault } from 'obsidian';

export const MAX_INSTRUCTION_CHARACTERS = 20000;

const INSTRUCTION_TRUNCATION_MARKER = '[...]';

export interface LoadedInstructions {
	agentText?: string;
	skillTexts: Map<string, string>;
}

function normalizeSkillPath(reference: string): string | null {
	const candidate = reference.trim();
	if (
		candidate.length === 0 ||
		candidate.startsWith('/') ||
		candidate.includes('\\') ||
		/^[a-z][a-z\d+.-]*:/i.test(candidate)
	) {
		return null;
	}

	const normalized = candidate.replace(/\/{2,}/g, '/').replace(/\/$/, '');
	const segments = normalized.split('/');
	if (
		segments.some((segment) => segment === '.' || segment === '..') ||
		(normalized !== 'skills' && !normalized.startsWith('skills/'))
	) {
		return null;
	}

	const fileName = segments[segments.length - 1];
	if (fileName === undefined || fileName.length === 0) {
		return null;
	}
	if (fileName.endsWith('.md')) {
		return normalized;
	}
	if (fileName.includes('.')) {
		return null;
	}
	return `${normalized}/SKILL.md`;
}

export function extractSkillPaths(agentText: string): string[] {
	const paths: string[] = [];
	const seen = new Set<string>();
	const referencePattern = /`([^`\r\n]+)`|\[[^\]\r\n]*\]\(([^)\r\n]+)\)/g;

	for (const match of agentText.matchAll(referencePattern)) {
		const reference = match[1] ?? match[2];
		if (reference === undefined) {
			continue;
		}
		const path = normalizeSkillPath(reference);
		if (path !== null && !seen.has(path)) {
			seen.add(path);
			paths.push(path);
		}
	}

	return paths;
}

function truncateInstructions(text: string, budget: number): string | undefined {
	if (budget <= 0) {
		return undefined;
	}
	if (text.length <= budget) {
		return text;
	}
	if (budget <= INSTRUCTION_TRUNCATION_MARKER.length) {
		return INSTRUCTION_TRUNCATION_MARKER.slice(0, budget);
	}
	return `${text.slice(0, budget - INSTRUCTION_TRUNCATION_MARKER.length)}${INSTRUCTION_TRUNCATION_MARKER}`;
}

export async function loadAllInstructions(vault: Vault): Promise<LoadedInstructions> {
	const skillTexts = new Map<string, string>();
	const agentFile = vault.getAbstractFileByPath('AGENTS.md');
	if (!(agentFile instanceof TFile)) {
		return { skillTexts };
	}

	const rawAgentText = await vault.read(agentFile);
	let remaining = MAX_INSTRUCTION_CHARACTERS;
	let truncated = false;
	for (const path of extractSkillPaths(rawAgentText)) {
		const skillFile = vault.getAbstractFileByPath(path);
		if (!(skillFile instanceof TFile)) {
			continue;
		}
		let skillContent: string;
		try {
			skillContent = (await vault.read(skillFile)).trim();
		} catch {
			new Notice(`Emend: Could not read the instruction file ${path}.`);
			continue;
		}
		const skillText = truncateInstructions(skillContent, remaining);
		if (skillText === undefined) {
			truncated = true;
			continue;
		}
		if (skillText.length < skillContent.length) {
			truncated = true;
		}
		remaining -= skillText.length;
		skillTexts.set(path, skillText);
	}

	const agentText = truncateInstructions(rawAgentText, remaining);
	if (agentText === undefined || agentText.length < rawAgentText.length) {
		truncated = true;
	}
	if (truncated) {
		new Notice(`Emend: Instructions were truncated at ${MAX_INSTRUCTION_CHARACTERS} characters.`);
	}

	return agentText === undefined ? { skillTexts } : { agentText, skillTexts };
}
