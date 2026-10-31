import { describe, expect, it } from 'vitest';
import { canWriteToNote } from '../src/permissions';
import type { Mode } from '../src/types';

describe('canWriteToNote', () => {
	it.each<Mode>(['ask', 'discuss', 'brainstorm'])(
		'denies note writes in %s mode',
		(mode) => {
			expect(canWriteToNote(mode)).toBe(false);
		},
	);

	it('allows note writes only in edit mode', () => {
		expect(canWriteToNote('edit')).toBe(true);
	});
});
