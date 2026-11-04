import { TFile, type Vault } from 'obsidian';
import { getBoundedContext } from './context';

export interface AdditionalNoteSnapshot {
	sourcePath: string;
	providerPath?: string;
	markdown: string;
	sourceCharacters: number;
	includedCharacters: number;
}

export interface CaptureAdditionalNotesOptions {
	activeNotePath: string;
	paths: readonly string[];
	includeNotePath: boolean;
	maxCharacters: number;
	signal: AbortSignal;
}

type AdditionalNotesVault = Pick<
	Vault,
	'getAbstractFileByPath' | 'read' | 'getName'
>;

export async function captureAdditionalNotes(
	vault: AdditionalNotesVault,
	options: CaptureAdditionalNotesOptions,
): Promise<AdditionalNoteSnapshot[]> {
	const seen = new Set([options.activeNotePath]);
	const selectedPaths = options.paths.filter((path) => {
		if (seen.has(path)) {
			return false;
		}
		seen.add(path);
		return true;
	});
	if (selectedPaths.length === 0) {
		return [];
	}

	options.signal.throwIfAborted();
	const files = selectedPaths.map((path) => {
		const file = vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			throw new Error(`Additional note not found: ${path}. Remove it and retry.`);
		}
		if (!file.path.toLowerCase().endsWith('.md')) {
			throw new Error(
				`Additional note is not a Markdown file: ${path}. Remove it and retry.`,
			);
		}
		return file;
	});

	const snapshots: AdditionalNoteSnapshot[] = [];
	let remainingBudget = options.maxCharacters;
	let remainingNotes = files.length;
	for (const file of files) {
		const noteBudget = Math.floor(remainingBudget / remainingNotes);
		if (noteBudget < 1) {
			throw new Error('Too many additional notes for the configured context budget.');
		}

		options.signal.throwIfAborted();
		const source = await vault.read(file);
		options.signal.throwIfAborted();

		const includedCharacters = Math.min(source.length, noteBudget);
		snapshots.push({
			sourcePath: file.path,
			providerPath: options.includeNotePath
				? `${vault.getName()}/${file.path}`
				: undefined,
			markdown: getBoundedContext(source, 0, 0, noteBudget),
			sourceCharacters: source.length,
			includedCharacters,
		});
		remainingBudget -= includedCharacters;
		remainingNotes--;
	}
	return snapshots;
}

export function formatAdditionalNotesPrompt(
	notes: readonly AdditionalNoteSnapshot[],
): string {
	const sections = notes.map((note, index) => {
		const lines = [
			`## Additional note ${index + 1}`,
			'Additional notes are read-only context and are not edit targets.',
		];
		if (note.providerPath) {
			lines.push(`Path: ${note.providerPath}`);
		}
		lines.push('', '```markdown', note.markdown, '```');
		return lines.join('\n');
	});
	return sections.join('\n\n');
}
