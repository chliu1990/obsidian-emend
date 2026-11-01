import { describe, expect, it } from 'vitest';
import { EMEND_BUILD_ID } from '../src/build-info';

describe('build identity', () => {
	it('exposes the deterministic value injected by the test build', () => {
		expect(EMEND_BUILD_ID).toBe('test-build');
	});
});
