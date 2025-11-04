import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig(() => {
	const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
	const port = Number(env.APPHOSTING_PORT ?? env.PORT ?? '') || 5173;
	return {
		plugins: [tailwindcss(), sveltekit()],
		server: {
			host: true,
			port
		}
	};
});
