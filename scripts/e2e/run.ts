import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';

const DEFAULT_PROJECT_ID = 'penni-ai-platform';
const DEFAULT_AUTH_EMULATOR = '127.0.0.1:9100';
const DEFAULT_FIRESTORE_EMULATOR = '127.0.0.1:6201';
const DEFAULT_STORAGE_EMULATOR = '127.0.0.1:9199';
const DEFAULT_FUNCTIONS_EMULATOR_ORIGIN = 'http://127.0.0.1:5001';

const startupTimeoutMs = 60_000;

function getEnvValue(key: string, fallback?: string) {
	const value = process.env[key];
	return value && value.trim().length > 0 ? value : fallback;
}

function normalizeEmulatorHost(value: string | undefined, fallback: string) {
	const host = value && value.trim().length > 0 ? value.trim() : fallback;
	return host.replace(/^http:\/\//, '');
}

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

async function waitForUrl(url: string, label: string, timeoutMs = startupTimeoutMs) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const response = await fetch(url, { method: 'GET' });
			if (response.ok || response.status === 404 || response.status === 503) {
				return;
			}
		} catch {
			// Keep retrying
		}
		await delay(250);
	}
	throw new Error(`Timed out waiting for ${label} at ${url}`);
}

function spawnProcess(label: string, command: string, args: string[], env: NodeJS.ProcessEnv) {
	const child = spawn(command, args, {
		env,
		stdio: 'inherit'
	});
	child.on('exit', (code, signal) => {
		if (!shuttingDown) {
			console.error(`[e2e] ${label} exited`, { code, signal });
			void shutdown(1);
		}
	});
	children.add(child);
	return child;
}

async function runCommand(label: string, command: string, args: string[], env: NodeJS.ProcessEnv) {
	const child = spawn(command, args, { env, stdio: 'inherit' });
	children.add(child);
	return new Promise<void>((resolve, reject) => {
		child.on('exit', (code) => {
			children.delete(child);
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`[e2e] ${label} failed with exit code ${code ?? 'unknown'}`));
			}
		});
	});
}

const children = new Set<ChildProcess>();
let shuttingDown = false;

async function shutdown(exitCode: number) {
	if (shuttingDown) return;
	shuttingDown = true;
	for (const child of children) {
		child.kill('SIGTERM');
	}
	await delay(500);
	for (const child of children) {
		if (!child.killed) {
			child.kill('SIGKILL');
		}
	}
	process.exit(exitCode);
}

process.on('SIGINT', () => void shutdown(1));
process.on('SIGTERM', () => void shutdown(1));
process.on('uncaughtException', (error) => {
	console.error('[e2e] Uncaught exception', error);
	void shutdown(1);
});
process.on('unhandledRejection', (error) => {
	console.error('[e2e] Unhandled rejection', error);
	void shutdown(1);
});

async function run() {
	const projectId = getEnvValue('FIREBASE_PROJECT_ID')
		|| getEnvValue('PUBLIC_FIREBASE_PROJECT_ID')
		|| DEFAULT_PROJECT_ID;

	const authEmulator = normalizeEmulatorHost(process.env.FIREBASE_AUTH_EMULATOR_HOST, DEFAULT_AUTH_EMULATOR);
	const firestoreEmulator = normalizeEmulatorHost(process.env.FIRESTORE_EMULATOR_HOST, DEFAULT_FIRESTORE_EMULATOR);
	const storageEmulator = normalizeEmulatorHost(process.env.FIREBASE_STORAGE_EMULATOR_HOST, DEFAULT_STORAGE_EMULATOR);

	const webPort = await getAvailablePort();
	let pipelinePort = await getAvailablePort();
	if (pipelinePort === webPort) {
		pipelinePort = await getAvailablePort();
	}

	const baseURL = `http://127.0.0.1:${webPort}`;
	const pipelineURL = `http://127.0.0.1:${pipelinePort}`;

	const storageBucket = `${projectId}.firebasestorage.app`;
	const appId = process.env.PUBLIC_FIREBASE_APP_ID || '1:000000000000:web:e2e-test';

	const commonEnv: NodeJS.ProcessEnv = {
		...process.env,
		NODE_ENV: 'test',
		E2E_TESTING: 'true',
		PLAYWRIGHT_BASE_URL: baseURL,
		PUBLIC_SITE_URL: baseURL,
		PUBLIC_FIREBASE_API_KEY: process.env.PUBLIC_FIREBASE_API_KEY || 'demo-api-key',
		PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.PUBLIC_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
		PUBLIC_FIREBASE_PROJECT_ID: projectId,
		PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.PUBLIC_FIREBASE_STORAGE_BUCKET || storageBucket,
		PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
		PUBLIC_FIREBASE_APP_ID: appId,
		PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: process.env.PUBLIC_FIREBASE_AUTH_EMULATOR_HOST || authEmulator,
		PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST: process.env.PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST || firestoreEmulator,
		FIREBASE_PROJECT_ID: projectId,
		GOOGLE_CLOUD_PROJECT: projectId,
		FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST || authEmulator,
		FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || firestoreEmulator,
		FIREBASE_STORAGE_EMULATOR_HOST: process.env.FIREBASE_STORAGE_EMULATOR_HOST || storageEmulator,
		STORAGE_EMULATOR_HOST: process.env.STORAGE_EMULATOR_HOST || `http://${storageEmulator}`,
		FIREBASE_FUNCTIONS_EMULATOR_ORIGIN:
			process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN || DEFAULT_FUNCTIONS_EMULATOR_ORIGIN,
		CLOUD_RUN_PIPELINE_SERVICE_URL: pipelineURL
	};

	console.log('[e2e] Starting services', {
		baseURL,
		pipelineURL,
		projectId,
		authEmulator,
		firestoreEmulator,
		storageEmulator
	});

	await runCommand(
		'pipeline build',
		'npm',
		['--prefix', 'services/pipeline-service', 'run', 'build'],
		commonEnv
	);

	spawnProcess(
		'pipeline-service',
		'node',
		['services/pipeline-service/dist/index.js'],
		{
			...commonEnv,
			PORT: String(pipelinePort),
			PIPELINE_MOCK_MODE: 'fixtures',
			PIPELINE_MOCK_DELAY_MS: process.env.PIPELINE_MOCK_DELAY_MS || '1500',
			MAX_CONCURRENT_LLM_REQUESTS: process.env.MAX_CONCURRENT_LLM_REQUESTS || '100',
			MAX_CONCURRENT_LLM_ANALYSES: process.env.MAX_CONCURRENT_LLM_ANALYSES || '100',
			STORAGE_BUCKET: process.env.STORAGE_BUCKET || storageBucket,
			FIREBASE_STORAGE_BUCKET: process.env.FIREBASE_STORAGE_BUCKET || storageBucket
		}
	);

	spawnProcess('web', 'npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(webPort)], commonEnv);

	await waitForUrl(`${pipelineURL}/health`, 'pipeline service');
	await waitForUrl(baseURL, 'web app');

	const testRunner = spawnProcess('playwright', 'npm', ['run', 'test:e2e:playwright'], commonEnv);
	const exitCode = await new Promise<number>((resolve) => {
		testRunner.on('exit', (code) => resolve(code ?? 1));
	});

	await shutdown(exitCode);
}

void run();
