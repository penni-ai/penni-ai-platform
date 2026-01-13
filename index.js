import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const buildEntry = new URL('./build/index.js', import.meta.url);
const vitePackageJson = new URL('./node_modules/vite/package.json', import.meta.url);
const svelteKitPackageJson = new URL('./node_modules/@sveltejs/kit/package.json', import.meta.url);
const adapterNodeEntry = new URL('./.svelte-kit/adapter-node/index.js', import.meta.url);
const svelteKitOutputEntry = new URL('./.svelte-kit/output/server/index.js', import.meta.url);

if (!fs.existsSync(buildEntry)) {
	console.error(`[startup] Missing SvelteKit build entry: ${buildEntry.pathname}`);
	console.error(`[startup] cwd: ${process.cwd()}`);
	try {
		console.error(`[startup] cwd entries: ${fs.readdirSync(process.cwd()).join(', ')}`);
	} catch (error) {
		console.error('[startup] Failed to read cwd entries', error);
	}
	console.error(
		`[startup] viteInstalled=${fs.existsSync(vitePackageJson)} svelteKitInstalled=${fs.existsSync(svelteKitPackageJson)}`
	);
	console.error(
		`[startup] adapterNodeEntry=${fs.existsSync(adapterNodeEntry)} svelteKitOutputEntry=${fs.existsSync(svelteKitOutputEntry)}`
	);

	if (fs.existsSync(vitePackageJson) && fs.existsSync(svelteKitPackageJson)) {
		console.error('[startup] Attempting to build at runtime (missing build output in image)...');
		const result = spawnSync('npm', ['run', 'build'], {
			stdio: 'inherit',
			env: process.env
		});
		if (result.status !== 0) {
			process.exit(result.status ?? 1);
		}
	}

	if (!fs.existsSync(buildEntry)) {
		console.error(`[startup] Build output still missing after attempted runtime build: ${buildEntry.pathname}`);
		process.exit(1);
	}
}

await import(buildEntry.href);
