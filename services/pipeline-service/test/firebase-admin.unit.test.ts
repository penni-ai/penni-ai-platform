import { beforeEach, describe, expect, it, vi } from 'vitest';

function parseStructuredLogCall(call: unknown[]): Record<string, any> | null {
	const first = call[0];
	if (typeof first !== 'string') return null;
	try {
		const parsed = JSON.parse(first);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
	} catch {
		return null;
	}
}

function findStructuredLogs(spy: ReturnType<typeof vi.spyOn>) {
	return spy.mock.calls.map((call) => parseStructuredLogCall(call as unknown[])).filter(Boolean) as Record<string, any>[];
}

function expectStructuredLogMessage(spy: ReturnType<typeof vi.spyOn>, message: string) {
	const matched = spy.mock.calls.some((call) => parseStructuredLogCall(call as unknown[])?.message === message);
	expect(matched).toBe(true);
}

const apps: any[] = [];
const initializeApp = vi.fn((options: any) => {
	const app = { options };
	apps.push(app);
	return app as any;
});
const getApps = vi.fn(() => apps);
const getApp = vi.fn(() => apps[0]);
const applicationDefault = vi.fn(() => ({ kind: 'adc' }));
const cert = vi.fn((sa: any) => ({ kind: 'cert', sa }));

const getFirestore = vi.fn((app: any) => ({ app }));
const getAuth = vi.fn((app: any) => ({ app }));
const getStorage = vi.fn((app: any) => ({ app }));

vi.mock('firebase-admin/app', () => ({
	initializeApp,
	getApps,
	getApp,
	applicationDefault,
	cert
}));

vi.mock('firebase-admin/firestore', () => ({ getFirestore }));
vi.mock('firebase-admin/auth', () => ({ getAuth }));
vi.mock('firebase-admin/storage', () => ({ getStorage }));

describe('firebase-admin utils (unit)', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		apps.splice(0, apps.length);

		delete process.env.FIREBASE_CONFIG;
		delete process.env.GOOGLE_CLOUD_PROJECT;
		delete process.env.FIREBASE_PROJECT_ID;
		delete process.env.STORAGE_BUCKET;
		delete process.env.FIREBASE_STORAGE_BUCKET;
		delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
		delete process.env.STORAGE_EMULATOR_HOST;
		delete process.env.FIRESTORE_EMULATOR_HOST;
		delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
		delete process.env.FIREBASE_SERVICE_ACCOUNT;
		delete process.env.FUNCTIONS_EMULATOR;
		delete process.env.NODE_ENV;
		delete process.env.OPENAI_API_KEY;
		delete process.env.DEEPINFRA_API_KEY;
		delete process.env.BRIGHTDATA_API_KEY;
		delete process.env.WEAVIATE_API_KEY;
		delete process.env.WEAVIATE_URL;
	});

	it('maps FIREBASE_STORAGE_EMULATOR_HOST to STORAGE_EMULATOR_HOST with protocol', async () => {
		process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';

		await import('../dist/utils/firebase-admin.js');

		expect(process.env.STORAGE_EMULATOR_HOST).toBe('http://127.0.0.1:9199');
	});

	it('prefixes STORAGE_EMULATOR_HOST when protocol is missing', async () => {
		process.env.STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
		await import('../dist/utils/firebase-admin.js');
		expect(process.env.STORAGE_EMULATOR_HOST).toBe('http://127.0.0.1:9199');
	});

	it('removes storage emulator vars in production (non-functions)', async () => {
		process.env.NODE_ENV = 'production';
		process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
		process.env.STORAGE_EMULATOR_HOST = 'http://127.0.0.1:9199';
		process.env.GCLOUD_STORAGE_EMULATOR_HOST = 'http://127.0.0.1:9199';

		await import('../dist/utils/firebase-admin.js');

		expect(process.env.FIREBASE_STORAGE_EMULATOR_HOST).toBeUndefined();
		expect(process.env.STORAGE_EMULATOR_HOST).toBeUndefined();
		expect(process.env.GCLOUD_STORAGE_EMULATOR_HOST).toBeUndefined();
	});

	it('parses FIREBASE_CONFIG and uses it for projectId/storageBucket', async () => {
		process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'proj_1', storageBucket: 'bucket_1' });

		const mod = await import('../dist/utils/firebase-admin.js');
		const app = mod.getOrInitAdminApp();

		expect(app.options.projectId).toBe('proj_1');
		expect(app.options.storageBucket).toBe('bucket_1');
		expect(process.env.STORAGE_BUCKET).toBe('bucket_1');
		expect(process.env.FIREBASE_STORAGE_BUCKET).toBe('bucket_1');
	});

	it('warns on invalid FIREBASE_CONFIG JSON', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		process.env.FIREBASE_CONFIG = 'not-json';

		await import('../dist/utils/firebase-admin.js');

		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('initializes app with project + bucket in emulator mode (no credentials)', async () => {
		process.env.GOOGLE_CLOUD_PROJECT = 'penni-ai-platform';
		process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

		const mod = await import('../dist/utils/firebase-admin.js');
		const app = mod.getOrInitAdminApp();

		expect(app).toBeTruthy();
		expect(initializeApp).toHaveBeenCalledTimes(1);
		expect(initializeApp).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: 'penni-ai-platform',
				storageBucket: expect.any(String)
			})
		);

		const db = mod.getFirestoreInstance();
		expect(getFirestore).toHaveBeenCalledTimes(1);
		expect(db.app).toBe(app);

		const auth = mod.getAuthInstance();
		expect(getAuth).toHaveBeenCalledTimes(1);
		expect(auth.app).toBe(app);

		const storage = mod.getStorageInstance();
		expect(getStorage).toHaveBeenCalledTimes(1);
		expect(storage.app).toBe(app);
	});

	it('logs when all API keys are configured (without logging secret values)', async () => {
		const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

		process.env.GOOGLE_CLOUD_PROJECT = 'penni-ai-platform';
		process.env.OPENAI_API_KEY = 'short';
		process.env.DEEPINFRA_API_KEY = 'di-key-long';
		process.env.BRIGHTDATA_API_KEY = 'bd-key-long';
		process.env.WEAVIATE_API_KEY = 'wv-key-long';
		process.env.WEAVIATE_URL = 'https://weaviate.example.test/path';

		const mod = await import('../dist/utils/firebase-admin.js');
		mod.getOrInitAdminApp();

		expectStructuredLogMessage(infoSpy, 'firebase_admin_api_keys_ok');

		const logs = findStructuredLogs(infoSpy);
		const status = logs.find((entry) => entry.message === 'firebase_admin_api_key_status');
		expect(status).toBeTruthy();
		expect(status).toMatchObject({
			openai_configured: true,
			deepinfra_configured: true,
			brightdata_configured: true,
			weaviate_api_configured: true,
			weaviate_url_host: 'weaviate.example.test'
		});

		infoSpy.mockRestore();
	});

	it('uses FIREBASE_SERVICE_ACCOUNT (cert) when not in emulator', async () => {
		process.env.GOOGLE_CLOUD_PROJECT = 'penni-ai-platform';
		process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'penni-ai-platform', client_email: 'x', private_key: 'y' });

		const mod = await import('../dist/utils/firebase-admin.js');
		mod.getOrInitAdminApp();

		expect(cert).toHaveBeenCalledTimes(1);
		expect(applicationDefault).not.toHaveBeenCalled();
		expect(initializeApp).toHaveBeenCalledWith(
			expect.objectContaining({
				credential: expect.objectContaining({ kind: 'cert' })
			})
		);
	});

	it('falls back when FIREBASE_SERVICE_ACCOUNT is invalid and when ADC lookup fails', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		process.env.GOOGLE_CLOUD_PROJECT = 'penni-ai-platform';
		process.env.FIREBASE_SERVICE_ACCOUNT = '{bad json';
		applicationDefault.mockImplementationOnce(() => {
			throw new Error('no adc');
		});

		const mod = await import('../dist/utils/firebase-admin.js');
		mod.getOrInitAdminApp();

		expect(cert).not.toHaveBeenCalled();
		expect(applicationDefault).toHaveBeenCalled();
		expect(initializeApp).toHaveBeenCalledWith(
			expect.not.objectContaining({
				credential: expect.anything()
			})
		);

		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('logs storage emulator configuration when FIREBASE_STORAGE_EMULATOR_HOST has no protocol', async () => {
		const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

		process.env.GOOGLE_CLOUD_PROJECT = 'penni-ai-platform';
		process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
		process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

		const mod = await import('../dist/utils/firebase-admin.js');
		mod.getStorageInstance();

		const logs = findStructuredLogs(infoSpy);
		const entry = logs.find((log) => log.message === 'firebase_admin_storage_emulator_configured');
		expect(entry).toBeTruthy();
		expect(entry).toMatchObject({ storageEmulatorHost: '127.0.0.1:9199' });

		infoSpy.mockRestore();
	});
});
