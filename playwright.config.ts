import { spawnSync } from 'node:child_process';
import { defineConfig } from '@playwright/test';

const port = 49152 + Math.floor(Math.random() * 16384);

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

export default defineConfig({
	webServer: canStartServer
		? {
				command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${port}`,
				port
			}
		: undefined,
	testDir: canStartServer ? 'e2e' : 'e2e-disabled',
});
