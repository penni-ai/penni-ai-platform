import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isProduction = process.env.NODE_ENV === 'production';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		csp: isProduction
			? {
					mode: 'auto',
					directives: {
						'default-src': ['self'],
						'base-uri': ['self'],
						'frame-ancestors': ['none'],
						'object-src': ['none'],
						'form-action': ['self'],
						'img-src': ['self', 'data:', 'https:'],
						'script-src': ['self'],
						'style-src': ['self', 'unsafe-inline'],
						'connect-src': ['self', 'https:', 'wss:'],
						'font-src': ['self', 'data:', 'https:'],
						'upgrade-insecure-requests': true
					}
				}
			: undefined,
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter()
	}
};

export default config;
