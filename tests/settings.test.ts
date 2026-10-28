import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SETTINGS,
	normalizeSettings,
} from '../src/settings';

describe('normalizeSettings', () => {
	it('returns the defaults for missing persisted data', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
	});

	it('preserves a persisted numeric context limit', () => {
		expect(normalizeSettings({ maxContextCharacters: 24000 })).toEqual({
			...DEFAULT_SETTINGS,
			maxContextCharacters: 24000,
		});
	});
});
