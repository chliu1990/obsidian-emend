import { describe, expect, it } from 'vitest';
import {
	refreshEditTargetState,
	resolveEditTargetState,
	type EditTargetChoice,
	type EditTargetState,
} from '../src/edit-target';

describe('resolveEditTargetState', () => {
	it.each([
		{ hasUsableSelection: true, resolved: 'selection' },
		{ hasUsableSelection: false, resolved: 'full-note' },
	] as const)(
		'resolves automatic targeting to $resolved when selection availability is $hasUsableSelection',
		({ hasUsableSelection, resolved }) => {
			expect(resolveEditTargetState('auto', hasUsableSelection)).toEqual({
				choice: 'auto',
				resolved,
			});
		},
	);

	it.each([
		{ choice: 'full-note', hasUsableSelection: false },
		{ choice: 'full-note', hasUsableSelection: true },
		{ choice: 'selection', hasUsableSelection: false },
		{ choice: 'selection', hasUsableSelection: true },
	] as const)(
		'preserves explicit $choice targeting when selection availability is $hasUsableSelection',
		({ choice, hasUsableSelection }) => {
			expect(resolveEditTargetState(
				choice satisfies EditTargetChoice,
				hasUsableSelection,
			)).toEqual({ choice, resolved: choice });
		},
	);
});

describe('refreshEditTargetState', () => {
	it.each([
		{
			state: { choice: 'auto', resolved: 'selection' },
			hasUsableSelection: false,
			expected: { choice: 'auto', resolved: 'full-note' },
			expectedPrior: { choice: 'auto', resolved: 'selection' },
		},
		{
			state: { choice: 'auto', resolved: 'full-note' },
			hasUsableSelection: true,
			expected: { choice: 'auto', resolved: 'selection' },
			expectedPrior: { choice: 'auto', resolved: 'full-note' },
		},
	] as const)(
		'refreshes automatic targeting from $state.resolved to $expected.resolved without mutating the prior state',
		({ state, hasUsableSelection, expected, expectedPrior }) => {
			const refreshed = refreshEditTargetState(state, hasUsableSelection);

			expect(refreshed).toEqual(expected);
			expect(refreshed).not.toBe(state);
			expect(state).toEqual(expectedPrior);
		},
	);

	it.each([
		{
			state: { choice: 'full-note', resolved: 'full-note' },
			hasUsableSelection: false,
			expected: { choice: 'full-note', resolved: 'full-note' },
		},
		{
			state: { choice: 'full-note', resolved: 'full-note' },
			hasUsableSelection: true,
			expected: { choice: 'full-note', resolved: 'full-note' },
		},
		{
			state: { choice: 'selection', resolved: 'selection' },
			hasUsableSelection: false,
			expected: { choice: 'selection', resolved: 'selection' },
		},
		{
			state: { choice: 'selection', resolved: 'selection' },
			hasUsableSelection: true,
			expected: { choice: 'selection', resolved: 'selection' },
		},
	] as const)(
		'returns explicit $state.choice state unchanged when selection availability is $hasUsableSelection',
		({ state, hasUsableSelection, expected }) => {
			const priorState: EditTargetState = state;

			expect(refreshEditTargetState(priorState, hasUsableSelection)).toBe(priorState);
			expect(priorState).toEqual(expected);
		},
	);
});
