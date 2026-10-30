import type { Mode } from './types';

export interface ShortcutEvent {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

export interface ComposerShortcutState {
	isSending: boolean;
	isThreadLoading: boolean;
}

export function getComposerShortcut(
	event: ShortcutEvent,
	state: ComposerShortcutState = { isSending: false, isThreadLoading: false },
): 'send' | 'newline' | null {
	if (event.key !== 'Enter' || event.altKey || (event.metaKey && event.ctrlKey)) {
		return null;
	}
	if (event.shiftKey) {
		return event.metaKey || event.ctrlKey ? null : 'newline';
	}
	if (state.isSending || state.isThreadLoading) {
		return null;
	}
	return 'send';
}

export function getModeShortcut(event: ShortcutEvent): Mode | null {
	if (
		!event.shiftKey ||
		event.altKey ||
		event.metaKey === event.ctrlKey
	) {
		return null;
	}

	switch (event.key.toLowerCase()) {
		case 'a':
			return 'ask';
		case 'e':
			return 'edit';
		default:
			return null;
	}
}
