import { describe, expect, it } from 'vitest';
import { resolveEditTarget, type EditTargetChoice } from '../src/edit-target';

describe('resolveEditTarget', () => {
	it('resolves automatic targeting to Selection only when usable text is selected', () => {
		expect(resolveEditTarget('auto', true)).toBe('selection');
		expect(resolveEditTarget('auto', false)).toBe('full-note');
	});

	it.each([
		{ choice: 'full-note', hasUsableSelection: false, expected: 'full-note' },
		{ choice: 'full-note', hasUsableSelection: true, expected: 'full-note' },
		{ choice: 'selection', hasUsableSelection: false, expected: 'selection' },
		{ choice: 'selection', hasUsableSelection: true, expected: 'selection' },
	] as const)(
		'preserves explicit $choice targeting when selection availability is $hasUsableSelection',
		({ choice, hasUsableSelection, expected }) => {
			expect(resolveEditTarget(
				choice satisfies EditTargetChoice,
				hasUsableSelection,
			)).toBe(expected);
		},
	);
});
