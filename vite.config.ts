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
		},
		optimizeDeps: {
			// Include Firebase modules to ensure proper bundling of side effects
			include: [
				'firebase/app',
				'firebase/auth',
				'firebase/firestore'
			]
		},
		ssr: {
			// Don't externalize Firebase - bundle it for consistent behavior
			noExternal: ['firebase']
		}
	};
});
