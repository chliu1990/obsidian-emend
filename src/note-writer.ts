import type { TFile, Vault } from 'obsidian';
import type { RequestContext } from './context';
import type { EditPreparation } from './edit-strategy';
import { canWriteToNote } from './permissions';
import type { Mode } from './types';

export interface NoteWriter {
	readCurrentText: (file: TFile) => Promise<string>;
	write: (file: TFile, markdown: string) => Promise<void>;
	isTargetCurrent: (file: TFile) => boolean;
}

export interface EditResult {
	applied: boolean;
	changeCount: number;
}

const STALE_NOTE_ERROR =
	'The note changed while Emend was responding. No edits were applied.';

export function createVaultNoteWriter(
	vault: Vault,
	isTargetCurrent: (file: TFile) => boolean,
): NoteWriter {
	return {
		readCurrentText: (file) => vault.read(file),
		write: (file, markdown) => vault.modify(file, markdown),
		isTargetCurrent,
	};
}

export async function applyPreparedEdit(
	mode: Mode,
	snapshot: RequestContext,
	prepared: EditPreparation,
	writer: NoteWriter,
): Promise<EditResult> {
	if (!canWriteToNote(mode) || prepared.annotatedMarkdown === snapshot.sourceText) {
		return { applied: false, changeCount: 0 };
	}

	const currentText = await writer.readCurrentText(snapshot.file);
	if (
		currentText !== snapshot.sourceText ||
		!writer.isTargetCurrent(snapshot.file)
	) {
		throw new Error(STALE_NOTE_ERROR);
	}

	if (!canWriteToNote(mode)) {
		return { applied: false, changeCount: 0 };
	}
	await writer.write(snapshot.file, prepared.annotatedMarkdown);
	return { applied: true, changeCount: prepared.changeCount };
}
