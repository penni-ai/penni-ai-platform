import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const DEFAULT_PROJECT_ID = 'penni-ai-platform';

async function getAvailablePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.unref();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				server.close(() => reject(new Error('Unable to resolve an open port.')));
				return;
			}
			const port = address.port;
			server.close((error) => (error ? reject(error) : resolve(port)));
		});
	});
}

async function getUniquePorts(count: number): Promise<number[]> {
	const ports: number[] = [];
	while (ports.length < count) {
		const port = await getAvailablePort();
		if (!ports.includes(port)) {
			ports.push(port);
		}
	}
	return ports;
}

async function run() {
	const projectId = process.env.FIREBASE_PROJECT_ID
		|| process.env.PUBLIC_FIREBASE_PROJECT_ID
		|| DEFAULT_PROJECT_ID;

	const [authPort, firestorePort, storagePort, uiPort] = await getUniquePorts(4);

	const baseConfig = JSON.parse(readFileSync('firebase.json', 'utf-8')) as Record<string, any>;
	const configDir = mkdtempSync(join(tmpdir(), 'penny-emulators-'));
	const configPath = join(configDir, 'firebase.e2e.json');

	const emulators = { ...(baseConfig.emulators ?? {}) };
	emulators.auth = { ...(emulators.auth ?? {}), host: '127.0.0.1', port: authPort };
	emulators.firestore = { ...(emulators.firestore ?? {}), host: '127.0.0.1', port: firestorePort };
	emulators.storage = { ...(emulators.storage ?? {}), host: '127.0.0.1', port: storagePort };
	emulators.ui = { ...(emulators.ui ?? {}), host: '127.0.0.1', port: uiPort };

	const firestoreConfig = baseConfig.firestore
		? {
				...baseConfig.firestore,
				rules: baseConfig.firestore.rules ? resolve(baseConfig.firestore.rules) : undefined,
				indexes: baseConfig.firestore.indexes ? resolve(baseConfig.firestore.indexes) : undefined
			}
		: undefined;

	const storageConfig = baseConfig.storage
		? {
				...baseConfig.storage,
				rules: baseConfig.storage.rules ? resolve(baseConfig.storage.rules) : undefined
			}
		: undefined;

	const config = { ...baseConfig, emulators, firestore: firestoreConfig, storage: storageConfig };
	writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

	const command = [
		'npx firebase-tools emulators:exec',
		'--only firestore,auth,storage',
		`--config ${configPath}`,
		`--project ${projectId}`,
		'"tsx scripts/e2e/run.ts"'
	].join(' ');

	console.log('[e2e] Launching emulators', {
		projectId,
		authPort,
		firestorePort,
		storagePort,
		uiPort
	});

	const child = spawn(command, {
		stdio: 'inherit',
		shell: true,
		env: {
			...process.env,
			FIREBASE_PROJECT_ID: projectId,
			GOOGLE_CLOUD_PROJECT: projectId
		}
	});

	child.on('exit', (code) => {
		process.exit(code ?? 1);
	});
}

void run();
