import { spawnSync } from 'node:child_process';
import { defineConfig } from '@playwright/test';

const port = 49152 + Math.floor(Math.random() * 16384);
const baseURLFromEnv = process.env.PLAYWRIGHT_BASE_URL;

function canBindLocalhost(): boolean {
	const probe = spawnSync(
		process.execPath,
		[
			'-e',
			`const net=require('net');const s=net.createServer();s.on('error',()=>process.exit(1));s.listen(0,'127.0.0.1',()=>s.close(()=>process.exit(0)));`
		],
		{ stdio: 'ignore' }
	);
	return probe.status === 0;
}

const canStartServer = canBindLocalhost();
const shouldStartServer = !baseURLFromEnv && canStartServer;
const localBaseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: false,
	workers: 1,
	timeout: 60_000,
	expect: {
		timeout: 15_000
	},
	use: {
		baseURL: baseURLFromEnv ?? localBaseURL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	},
	globalSetup: 'e2e/global-setup.ts',
	webServer: shouldStartServer
		? {
				command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${port}`,
				port
			}
		: undefined,
});
