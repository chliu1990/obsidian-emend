export const STALE_NOTE_ERROR =
	'The note changed while Emend was responding. No edits were applied.';

export interface EditFreshnessSource {
	readonly capturedText: string;
	readDiskText(): Promise<string>;
	readEditorTexts(): readonly string[] | undefined;
	isTargetCurrent(): boolean;
}

export async function assertEditFreshness(
	source: EditFreshnessSource,
	signal?: AbortSignal,
): Promise<void> {
	signal?.throwIfAborted();
	const diskText = await source.readDiskText();
	const editorTexts = source.readEditorTexts();
	signal?.throwIfAborted();
	const capturedText = source.capturedText;
	if (
		diskText !== capturedText ||
		(editorTexts !== undefined &&
			editorTexts.some((text) => text !== capturedText)) ||
		!source.isTargetCurrent()
	) {
		throw new Error(STALE_NOTE_ERROR);
	}
}
