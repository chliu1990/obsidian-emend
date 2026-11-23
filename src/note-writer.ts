import type { TFile, Vault } from 'obsidian';
import type { RequestContext } from './context';
import { assertEditFreshness } from './edit-freshness';
import type { EditPreparation, EditSummaryItem } from './edit-strategy';
import { canWriteToNote } from './permissions';
import type { Mode } from './types';

export interface NoteWriter {
	readCurrentText: (file: TFile) => Promise<string>;
	write: (file: TFile, markdown: string) => Promise<void>;
	isTargetCurrent: (file: TFile) => boolean;
	readEditorTexts?: (file: TFile) => readonly string[] | undefined;
}

export interface EditResult {
	applied: boolean;
	changeCount: number;
	summaryItems: readonly EditSummaryItem[];
	summary?: string;
}

export function createVaultNoteWriter(
	vault: Vault,
	isTargetCurrent: (file: TFile) => boolean,
	readEditorTexts?: (file: TFile) => readonly string[] | undefined,
): NoteWriter {
	return {
		readCurrentText: (file) => vault.read(file),
		write: (file, markdown) => vault.modify(file, markdown),
		isTargetCurrent,
		...(readEditorTexts ? { readEditorTexts } : {}),
	};
}

export async function applyPreparedEdit(
	mode: Mode,
	snapshot: RequestContext,
	prepared: EditPreparation,
	writer: NoteWriter,
	signal?: AbortSignal,
): Promise<EditResult> {
	if (!canWriteToNote(mode)) {
		return {
			applied: false,
			changeCount: 0,
			summaryItems: [],
			summary: undefined,
		};
	}
	if (prepared.annotatedMarkdown === snapshot.sourceText) {
		return {
			applied: false,
			changeCount: 0,
			summaryItems: [],
			summary: prepared.summary,
		};
	}

	await assertEditFreshness(
		{
			capturedText: snapshot.sourceText,
			readDiskText: () => writer.readCurrentText(snapshot.file),
			readEditorTexts: () => writer.readEditorTexts?.(snapshot.file),
			isTargetCurrent: () => writer.isTargetCurrent(snapshot.file),
		},
		signal,
	);

	if (!canWriteToNote(mode)) {
		return {
			applied: false,
			changeCount: 0,
			summaryItems: [],
			summary: undefined,
		};
	}
	signal?.throwIfAborted();
	await writer.write(snapshot.file, prepared.annotatedMarkdown);
	return {
		applied: true,
		changeCount: prepared.changeCount,
		summaryItems: prepared.summaryItems,
		summary: prepared.summary,
	};
}
