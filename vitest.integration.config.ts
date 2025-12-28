import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		environment: 'node',
		include: ['test/**/*.integration.test.ts'],
		setupFiles: ['test/integration/setup.ts'],
		testTimeout: 60_000
	}
});

