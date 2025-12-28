import { describe, expect, it, vi } from 'vitest';

function clearEnv(keys: string[]) {
	for (const key of keys) {
		delete process.env[key];
	}
}

describe('firebase/admin (unit)', () => {
	it('reuses existing admin app when already initialized', async () => {
		vi.resetModules();
		clearEnv([
			'FIREBASE_CONFIG',
			'FIREBASE_PROJECT_ID',
			'GOOGLE_CLOUD_PROJECT',
			'FIREBASE_CLIENT_EMAIL',
			'FIREBASE_PRIVATE_KEY',
			'STORAGE_BUCKET',
			'FIREBASE_STORAGE_BUCKET'
		]);

		const existingApp = { options: { projectId: 'p1', storageBucket: 'b1' } };
		const initializeApp = vi.fn(() => existingApp);
		const getApp = vi.fn(() => existingApp);
		const getApps = vi.fn(() => [existingApp]);
		const cert = vi.fn();

		vi.doMock('firebase-admin/app', () => ({ initializeApp, getApp, getApps, cert }));
		vi.doMock('firebase-admin/auth', () => ({ getAuth: vi.fn(() => ({ kind: 'auth' })) }));
		vi.doMock('firebase-admin/firestore', () => ({ getFirestore: vi.fn(() => ({ kind: 'db' })) }));
		vi.doMock('firebase-admin/storage', () => ({ getStorage: vi.fn(() => ({ kind: 'storage' })) }));

		const mod = await import('../../src/lib/firebase/admin');
		expect(mod.adminApp).toBe(existingApp);
		expect(getApp).toHaveBeenCalledTimes(1);
		expect(initializeApp).not.toHaveBeenCalled();
	});

	it('initializes with cert() when FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY are provided', async () => {
		vi.resetModules();
		clearEnv(['FIREBASE_CONFIG', 'STORAGE_BUCKET', 'FIREBASE_STORAGE_BUCKET', 'STORAGE_EMULATOR_HOST']);
		process.env.FIREBASE_PROJECT_ID = 'p2';
		process.env.FIREBASE_CLIENT_EMAIL = 'test@example.com';
		process.env.FIREBASE_PRIVATE_KEY = 'line1\\nline2';

		const initializeApp = vi.fn((options: any) => ({ options }));
		const getApp = vi.fn();
		const getApps = vi.fn(() => []);
		const cert = vi.fn((c: any) => ({ ...c, __cert: true }));

		vi.doMock('firebase-admin/app', () => ({ initializeApp, getApp, getApps, cert }));
		vi.doMock('firebase-admin/auth', () => ({ getAuth: vi.fn(() => ({})) }));
		vi.doMock('firebase-admin/firestore', () => ({ getFirestore: vi.fn(() => ({})) }));
		vi.doMock('firebase-admin/storage', () => ({ getStorage: vi.fn(() => ({})) }));

		await import('../../src/lib/firebase/admin');
		expect(cert).toHaveBeenCalledTimes(1);
		expect(initializeApp).toHaveBeenCalledTimes(1);
		const initArgs = initializeApp.mock.calls[0]?.[0];
		expect(initArgs.credential.__cert).toBe(true);
		expect(initArgs.credential.privateKey).toContain('\n');
		expect(process.env.STORAGE_BUCKET).toContain('firebasestorage');
	});

	it('sets STORAGE_EMULATOR_HOST when FIREBASE_STORAGE_EMULATOR_HOST is present', async () => {
		vi.resetModules();
		clearEnv(['FIREBASE_CONFIG', 'STORAGE_EMULATOR_HOST']);
		process.env.FIREBASE_PROJECT_ID = 'p3';
		process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';

		vi.doMock('firebase-admin/app', () => ({
			initializeApp: vi.fn((options: any) => ({ options })),
			getApp: vi.fn(),
			getApps: vi.fn(() => []),
			cert: vi.fn()
		}));
		vi.doMock('firebase-admin/auth', () => ({ getAuth: vi.fn(() => ({})) }));
		vi.doMock('firebase-admin/firestore', () => ({ getFirestore: vi.fn(() => ({})) }));
		vi.doMock('firebase-admin/storage', () => ({ getStorage: vi.fn(() => ({})) }));

		await import('../../src/lib/firebase/admin');
		expect(process.env.STORAGE_EMULATOR_HOST).toBe('http://127.0.0.1:9199');
	});

	it('falls back to FIREBASE_CONFIG parsing when FIREBASE_PROJECT_ID is absent', async () => {
		vi.resetModules();
		clearEnv(['FIREBASE_PROJECT_ID', 'GOOGLE_CLOUD_PROJECT', 'STORAGE_BUCKET', 'FIREBASE_STORAGE_BUCKET']);
		process.env.FIREBASE_CONFIG = '{not-json';

		vi.doMock('firebase-admin/app', () => ({
			initializeApp: vi.fn((options: any) => ({ options })),
			getApp: vi.fn(),
			getApps: vi.fn(() => []),
			cert: vi.fn()
		}));
		vi.doMock('firebase-admin/auth', () => ({ getAuth: vi.fn(() => ({})) }));
		vi.doMock('firebase-admin/firestore', () => ({ getFirestore: vi.fn(() => ({})) }));
		vi.doMock('firebase-admin/storage', () => ({ getStorage: vi.fn(() => ({})) }));

		await import('../../src/lib/firebase/admin');
		expect(process.env.STORAGE_BUCKET).toBeTruthy();
		expect(process.env.FIREBASE_STORAGE_BUCKET).toBeTruthy();
	});

	it('normalizes STORAGE_EMULATOR_HOST and initializes without explicit projectId', async () => {
		vi.resetModules();
		clearEnv([
			'FIREBASE_CONFIG',
			'FIREBASE_PROJECT_ID',
			'GOOGLE_CLOUD_PROJECT',
			'FIREBASE_CLIENT_EMAIL',
			'FIREBASE_PRIVATE_KEY',
			'STORAGE_BUCKET',
			'FIREBASE_STORAGE_BUCKET',
			'FIREBASE_STORAGE_EMULATOR_HOST'
		]);
		process.env.STORAGE_EMULATOR_HOST = '127.0.0.1:9199';

		const initializeApp = vi.fn((options: any) => ({ options }));
		vi.doMock('firebase-admin/app', () => ({
			initializeApp,
			getApp: vi.fn(),
			getApps: vi.fn(() => []),
			cert: vi.fn()
		}));
		vi.doMock('firebase-admin/auth', () => ({ getAuth: vi.fn(() => ({})) }));
		vi.doMock('firebase-admin/firestore', () => ({ getFirestore: vi.fn(() => ({})) }));
		vi.doMock('firebase-admin/storage', () => ({ getStorage: vi.fn(() => ({})) }));

		await import('../../src/lib/firebase/admin');
		expect(process.env.STORAGE_EMULATOR_HOST).toBe('http://127.0.0.1:9199');
		expect(initializeApp).toHaveBeenCalledWith(expect.objectContaining({ storageBucket: expect.any(String) }));
	});
});
