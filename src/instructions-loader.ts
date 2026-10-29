import { TFile, type Vault } from 'obsidian';

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

export async function loadAllInstructions(vault: Vault): Promise<LoadedInstructions> {
	const skillTexts = new Map<string, string>();
	const agentFile = vault.getAbstractFileByPath('AGENTS.md');
	if (!(agentFile instanceof TFile)) {
		return { skillTexts };
	}

	const agentText = await vault.read(agentFile);
	for (const path of extractSkillPaths(agentText)) {
		const skillFile = vault.getAbstractFileByPath(path);
		if (!(skillFile instanceof TFile)) {
			continue;
		}
		skillTexts.set(path, (await vault.read(skillFile)).trim());
	}

	return { agentText, skillTexts };
}
