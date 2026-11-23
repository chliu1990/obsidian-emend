export type EditTargetChoice = 'auto' | 'full-note' | 'selection';
export type ResolvedEditTarget = Exclude<EditTargetChoice, 'auto'>;

export type EditTargetState =
	| { readonly choice: 'auto'; readonly resolved: ResolvedEditTarget }
	| { readonly choice: 'full-note'; readonly resolved: 'full-note' }
	| { readonly choice: 'selection'; readonly resolved: 'selection' };

export function resolveEditTarget(
	choice: EditTargetChoice,
	hasUsableSelection: boolean,
): ResolvedEditTarget {
	if (choice !== 'auto') {
		return choice;
	}
	return hasUsableSelection ? 'selection' : 'full-note';
}

export function resolveEditTargetState(
	choice: EditTargetChoice,
	hasUsableSelection: boolean,
): EditTargetState {
	if (choice === 'auto') {
		return {
			choice,
			resolved: hasUsableSelection ? 'selection' : 'full-note',
		};
	}
	if (choice === 'full-note') {
		return { choice, resolved: choice };
	}
	return { choice, resolved: choice };
}

export function refreshEditTargetState(
	state: EditTargetState,
	hasUsableSelection: boolean,
): EditTargetState {
	if (state.choice === 'auto') {
		return resolveEditTargetState(state.choice, hasUsableSelection);
	}
	return state;
}
