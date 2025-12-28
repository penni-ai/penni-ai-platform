import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		environment: 'node',
		clearMocks: true,
		restoreMocks: true,
		mockReset: true,
		setupFiles: ['test/setup.ts'],
		include: ['test/**/*.test.ts'],
		exclude: ['test/**/*.integration.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html', 'json-summary'],
			include: ['src/**/*.ts'],
			exclude: ['**/*.d.ts', '**/*.svelte', '**/node_modules/**'],
			thresholds: {
				statements: 100,
				branches: 85,
				functions: 100,
				lines: 100
			}
		}
	}
});
