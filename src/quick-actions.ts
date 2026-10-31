export interface QuickAction {
	id: 'fix-grammar' | 'make-concise' | 'add-examples';
	label: string;
	prompt: string;
	mode: 'edit';
}

export const QUICK_ACTIONS = [
	{
		id: 'fix-grammar',
		label: 'Fix grammar',
		prompt: 'Fix grammar, spelling, and punctuation throughout the note while preserving its meaning, tone, structure, and existing CriticMarkup.',
		mode: 'edit',
	},
	{
		id: 'make-concise',
		label: 'Make concise',
		prompt: 'Make the note more concise while preserving its essential meaning, important details, structure, and existing CriticMarkup.',
		mode: 'edit',
	},
	{
		id: 'add-examples',
		label: 'Add examples',
		prompt: "Add concise, relevant examples where they clarify the note's ideas while preserving its meaning, structure, and existing CriticMarkup.",
		mode: 'edit',
	},
] as const satisfies readonly QuickAction[];

export interface QuickActionAvailability {
	notePath: string | null;
	isSending: boolean;
	isThreadLoading: boolean;
}

export function areQuickActionsDisabled(state: QuickActionAvailability) {
	return state.notePath === null || state.isSending || state.isThreadLoading;
}
