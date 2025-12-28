import { describe, expect, it, vi } from 'vitest';

describe('firebase/client (unit)', () => {
	it('reuses existing Firebase app when already initialized', async () => {
		vi.resetModules();

		const existingApp = { name: 'existing' };
		const initializeApp = vi.fn();
		const getApps = vi.fn(() => [existingApp]);
		const getApp = vi.fn(() => existingApp);

		vi.doMock('$app/environment', () => ({ browser: false }));
		vi.doMock('$env/dynamic/public', () => ({
			env: {
				PUBLIC_FIREBASE_API_KEY: 'k',
				PUBLIC_FIREBASE_AUTH_DOMAIN: 'd',
				PUBLIC_FIREBASE_PROJECT_ID: 'p',
				PUBLIC_FIREBASE_STORAGE_BUCKET: 'b',
				PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 's',
				PUBLIC_FIREBASE_APP_ID: 'a'
			}
		}));
		vi.doMock('firebase/app', () => ({ initializeApp, getApps, getApp }));
		vi.doMock('firebase/auth', () => ({ getAuth: vi.fn(() => ({})), connectAuthEmulator: vi.fn() }));
		vi.doMock('firebase/firestore', () => ({
			getFirestore: vi.fn(() => ({})),
			connectFirestoreEmulator: vi.fn()
		}));

		const mod = await import('../../src/lib/firebase/client');
		expect(mod.firebaseApp).toBe(existingApp);
		expect(initializeApp).not.toHaveBeenCalled();
	});

	it('connects Auth emulator in browser/dev when configured', async () => {
		vi.resetModules();

		const connectAuthEmulator = vi.fn();
		const app = { name: 'new' };

		vi.doMock('$app/environment', () => ({ browser: true }));
		vi.doMock('$env/dynamic/public', () => ({
			env: {
				PUBLIC_FIREBASE_API_KEY: 'k',
				PUBLIC_FIREBASE_AUTH_DOMAIN: 'd',
				PUBLIC_FIREBASE_PROJECT_ID: 'p',
				PUBLIC_FIREBASE_STORAGE_BUCKET: 'b',
				PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 's',
				PUBLIC_FIREBASE_APP_ID: 'a',
				PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: 'http://localhost:9099'
			}
		}));
		vi.doMock('firebase/app', () => ({
			initializeApp: vi.fn(() => app),
			getApps: vi.fn(() => []),
			getApp: vi.fn()
		}));
		vi.doMock('firebase/auth', () => ({
			getAuth: vi.fn(() => ({ kind: 'auth' })),
			connectAuthEmulator
		}));
		vi.doMock('firebase/firestore', () => ({
			getFirestore: vi.fn(() => ({ kind: 'firestore' })),
			connectFirestoreEmulator: vi.fn()
		}));

		await import('../../src/lib/firebase/client');
		expect(connectAuthEmulator).toHaveBeenCalledTimes(1);
	});

	it('connects Firestore emulator and tolerates already-connected errors', async () => {
		vi.resetModules();

		const connectFirestoreEmulator = vi.fn(() => {
			throw new Error('connectFirestoreEmulator has already been called');
		});

		vi.doMock('$app/environment', () => ({ browser: true }));
		vi.doMock('$env/dynamic/public', () => ({
			env: {
				PUBLIC_FIREBASE_API_KEY: 'k',
				PUBLIC_FIREBASE_AUTH_DOMAIN: 'd',
				PUBLIC_FIREBASE_PROJECT_ID: 'p',
				PUBLIC_FIREBASE_STORAGE_BUCKET: 'b',
				PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 's',
				PUBLIC_FIREBASE_APP_ID: 'a',
				PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST: 'localhost:8080'
			}
		}));
		vi.doMock('firebase/app', () => ({
			initializeApp: vi.fn(() => ({ name: 'new' })),
			getApps: vi.fn(() => []),
			getApp: vi.fn()
		}));
		vi.doMock('firebase/auth', () => ({ getAuth: vi.fn(() => ({})), connectAuthEmulator: vi.fn() }));
		vi.doMock('firebase/firestore', () => ({ getFirestore: vi.fn(() => ({})), connectFirestoreEmulator }));

		await import('../../src/lib/firebase/client');
		expect(connectFirestoreEmulator).toHaveBeenCalledTimes(1);
	});

	it('connects Firestore emulator with parsed host/port', async () => {
		vi.resetModules();

		const connectFirestoreEmulator = vi.fn();

		vi.doMock('$app/environment', () => ({ browser: true }));
		vi.doMock('$env/dynamic/public', () => ({
			env: {
				PUBLIC_FIREBASE_API_KEY: 'k',
				PUBLIC_FIREBASE_AUTH_DOMAIN: 'd',
				PUBLIC_FIREBASE_PROJECT_ID: 'p',
				PUBLIC_FIREBASE_STORAGE_BUCKET: 'b',
				PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 's',
				PUBLIC_FIREBASE_APP_ID: 'a',
				PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085'
			}
		}));
		vi.doMock('firebase/app', () => ({
			initializeApp: vi.fn(() => ({ name: 'new' })),
			getApps: vi.fn(() => []),
			getApp: vi.fn()
		}));
		vi.doMock('firebase/auth', () => ({ getAuth: vi.fn(() => ({})), connectAuthEmulator: vi.fn() }));
		vi.doMock('firebase/firestore', () => ({ getFirestore: vi.fn(() => ({})), connectFirestoreEmulator }));

		await import('../../src/lib/firebase/client');
		expect(connectFirestoreEmulator).toHaveBeenCalledWith(expect.anything(), '127.0.0.1', 8085);
	});

	it('warns (SSR) when PUBLIC_FIREBASE_API_KEY is missing and still initializes', async () => {
		vi.resetModules();

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const initializeApp = vi.fn(() => ({ name: 'new' }));

		vi.doMock('$app/environment', () => ({ browser: false }));
		vi.doMock('$env/dynamic/public', () => ({
			env: {
				PUBLIC_FIREBASE_API_KEY: '',
				PUBLIC_FIREBASE_AUTH_DOMAIN: 'd',
				PUBLIC_FIREBASE_PROJECT_ID: 'p',
				PUBLIC_FIREBASE_STORAGE_BUCKET: 'b',
				PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 's',
				PUBLIC_FIREBASE_APP_ID: 'a'
			}
		}));
		vi.doMock('firebase/app', () => ({
			initializeApp,
			getApps: vi.fn(() => []),
			getApp: vi.fn()
		}));
		vi.doMock('firebase/auth', () => ({ getAuth: vi.fn(() => ({})), connectAuthEmulator: vi.fn() }));
		vi.doMock('firebase/firestore', () => ({ getFirestore: vi.fn(() => ({})), connectFirestoreEmulator: vi.fn() }));

		const mod = await import('../../src/lib/firebase/client');
		expect(mod.firebaseApp).toEqual({ name: 'new' });
		expect(initializeApp).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Missing PUBLIC_FIREBASE_API_KEY'));

		warnSpy.mockRestore();
	});

	it('throws in the browser when PUBLIC_FIREBASE_API_KEY is missing', async () => {
		vi.resetModules();

		vi.stubGlobal('window', {} as any);

		vi.doMock('$app/environment', () => ({ browser: true }));
		vi.doMock('$env/dynamic/public', () => ({
			env: {
				PUBLIC_FIREBASE_API_KEY: '',
				PUBLIC_FIREBASE_AUTH_DOMAIN: 'd',
				PUBLIC_FIREBASE_PROJECT_ID: 'p',
				PUBLIC_FIREBASE_STORAGE_BUCKET: 'b',
				PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 's',
				PUBLIC_FIREBASE_APP_ID: 'a'
			}
		}));
		vi.doMock('firebase/app', () => ({
			initializeApp: vi.fn(() => ({ name: 'new' })),
			getApps: vi.fn(() => []),
			getApp: vi.fn()
		}));
		vi.doMock('firebase/auth', () => ({ getAuth: vi.fn(() => ({})), connectAuthEmulator: vi.fn() }));
		vi.doMock('firebase/firestore', () => ({ getFirestore: vi.fn(() => ({})), connectFirestoreEmulator: vi.fn() }));

		await expect(import('../../src/lib/firebase/client')).rejects.toThrow(/Missing Firebase configuration/);

		vi.unstubAllGlobals();
	});

	it('skips Auth emulator connection when host is not configured', async () => {
		vi.resetModules();

		const connectAuthEmulator = vi.fn();

		vi.doMock('$app/environment', () => ({ browser: true }));
		vi.doMock('$env/dynamic/public', () => ({
			env: {
				PUBLIC_FIREBASE_API_KEY: 'k',
				PUBLIC_FIREBASE_AUTH_DOMAIN: 'd',
				PUBLIC_FIREBASE_PROJECT_ID: 'p',
				PUBLIC_FIREBASE_STORAGE_BUCKET: 'b',
				PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 's',
				PUBLIC_FIREBASE_APP_ID: 'a'
			}
		}));
		vi.doMock('firebase/app', () => ({
			initializeApp: vi.fn(() => ({ name: 'new' })),
			getApps: vi.fn(() => []),
			getApp: vi.fn()
		}));
		vi.doMock('firebase/auth', () => ({
			getAuth: vi.fn(() => ({ kind: 'auth' })),
			connectAuthEmulator
		}));
		vi.doMock('firebase/firestore', () => ({
			getFirestore: vi.fn(() => ({ kind: 'firestore' })),
			connectFirestoreEmulator: vi.fn()
		}));

		await import('../../src/lib/firebase/client');
		expect(connectAuthEmulator).not.toHaveBeenCalled();
	});

	it('warns when Firestore emulator host is not set and logs errors for unexpected connect failures', async () => {
		vi.resetModules();

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		vi.doMock('$app/environment', () => ({ browser: true }));
		vi.doMock('$env/dynamic/public', () => ({
			env: {
				PUBLIC_FIREBASE_API_KEY: 'k',
				PUBLIC_FIREBASE_AUTH_DOMAIN: 'd',
				PUBLIC_FIREBASE_PROJECT_ID: 'p',
				PUBLIC_FIREBASE_STORAGE_BUCKET: 'b',
				PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 's',
				PUBLIC_FIREBASE_APP_ID: 'a'
			}
		}));
		vi.doMock('firebase/app', () => ({
			initializeApp: vi.fn(() => ({ name: 'new' })),
			getApps: vi.fn(() => []),
			getApp: vi.fn()
		}));
		vi.doMock('firebase/auth', () => ({ getAuth: vi.fn(() => ({})), connectAuthEmulator: vi.fn() }));
		vi.doMock('firebase/firestore', () => ({
			getFirestore: vi.fn(() => ({})),
			connectFirestoreEmulator: vi.fn(() => {
				throw new Error('some other failure');
			})
		}));

		await import('../../src/lib/firebase/client');
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST not set'));

		// Now with emulator host set but connect throws a non-idempotency error.
		vi.resetModules();
		vi.doMock('$app/environment', () => ({ browser: true }));
		vi.doMock('$env/dynamic/public', () => ({
			env: {
				PUBLIC_FIREBASE_API_KEY: 'k',
				PUBLIC_FIREBASE_AUTH_DOMAIN: 'd',
				PUBLIC_FIREBASE_PROJECT_ID: 'p',
				PUBLIC_FIREBASE_STORAGE_BUCKET: 'b',
				PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 's',
				PUBLIC_FIREBASE_APP_ID: 'a',
				PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST: 'localhost'
			}
		}));
		vi.doMock('firebase/app', () => ({
			initializeApp: vi.fn(() => ({ name: 'new' })),
			getApps: vi.fn(() => []),
			getApp: vi.fn()
		}));
		vi.doMock('firebase/auth', () => ({ getAuth: vi.fn(() => ({})), connectAuthEmulator: vi.fn() }));
		vi.doMock('firebase/firestore', () => ({
			getFirestore: vi.fn(() => ({})),
			connectFirestoreEmulator: vi.fn(() => {
				throw new Error('some other failure');
			})
		}));

		await import('../../src/lib/firebase/client');
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to connect Firestore emulator'), expect.anything());

		warnSpy.mockRestore();
		errorSpy.mockRestore();
	});
});
