import { describe, expect, it } from 'vitest';
import { measureWebContent } from '../src/web-content-measurement';

describe('measureWebContent', () => {
	it('measures empty content as zero characters', () => {
		expect(measureWebContent('')).toEqual({ value: 0, unit: 'characters' });
	});

	it('measures ASCII content by its string length', () => {
		expect(measureWebContent('Web output')).toEqual({
			value: 10,
			unit: 'characters',
		});
	});

	it('counts UTF-16 code units rather than tokens or code points', () => {
		expect(measureWebContent('A🙂')).toEqual({ value: 3, unit: 'characters' });
	});
});
