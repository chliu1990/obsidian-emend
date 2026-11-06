export type EditTargetChoice = 'auto' | 'full-note' | 'selection';
export type ResolvedEditTarget = Exclude<EditTargetChoice, 'auto'>;

export function resolveEditTarget(
	choice: EditTargetChoice,
	hasUsableSelection: boolean,
): ResolvedEditTarget {
	if (choice !== 'auto') {
		return choice;
	}
	return hasUsableSelection ? 'selection' : 'full-note';
}
