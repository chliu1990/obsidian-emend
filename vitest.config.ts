import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	define: {
		__EMEND_BUILD_ID__: JSON.stringify('test-build'),
	},
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL('./tests/mocks/obsidian.ts', import.meta.url)),
		},
	},
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		clearMocks: true,
	},
});
