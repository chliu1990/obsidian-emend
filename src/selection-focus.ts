import type { SelectionSnapshot } from './types';

export type ChatTarget = 'note' | 'selection';
export type SelectionContextPolicy = 'default' | 'full-note';
export type SelectionFocusRole = 'chat-focus' | 'edit-target';

export function buildFullNoteSelectionSections(
	snapshot: Pick<SelectionSnapshot, 'fullText' | 'selectedText'>,
	role: SelectionFocusRole,
): string {
	const heading = role === 'chat-focus'
		? 'Selected text (read-only conversational focus)'
		: 'Selected text (the only edit target)';
	return `Full note (supporting context):\n${snapshot.fullText}\n\n${heading}:\n${snapshot.selectedText}`;
}
