import fs from 'node:fs';
import process from 'node:process';

const buildEntry = new URL('./build/index.js', import.meta.url);

if (!fs.existsSync(buildEntry)) {
	console.error(`[startup] Missing SvelteKit build entry: ${buildEntry.pathname}`);
	console.error(`[startup] cwd: ${process.cwd()}`);
	try {
		console.error(`[startup] cwd entries: ${fs.readdirSync(process.cwd()).join(', ')}`);
	} catch (error) {
		console.error('[startup] Failed to read cwd entries', error);
	}
	process.exit(1);
}

await import(buildEntry.href);
