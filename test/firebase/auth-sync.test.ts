import { describe, expect, it, vi } from 'vitest';

describe('firebase/auth-sync (unit)', () => {
	it('no-ops when already authenticated with valid ID token', async () => {
		vi.resetModules();

		const user = { uid: 'u1', getIdToken: vi.fn(async () => 'token') };
		const firebaseAuth = { currentUser: user };

		vi.doMock('../../src/lib/firebase/client', () => ({ firebaseAuth }));
		vi.doMock('firebase/auth', () => ({
			onAuthStateChanged: vi.fn(),
			onIdTokenChanged: vi.fn(),
			signInWithCustomToken: vi.fn()
		}));

		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy as any);

		const mod = await import('../../src/lib/firebase/auth-sync');
		await mod.ensureFirebaseAuthSession('u1');

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('fetches custom token and waits for auth + id token readiness', async () => {
		vi.resetModules();

		const user = {
			uid: 'u2',
			getIdToken: vi.fn().mockRejectedValueOnce(new Error('not ready')).mockResolvedValue('idtoken')
		};
		const firebaseAuth: any = { currentUser: null };

		const signInWithCustomToken = vi.fn(async () => {});
		const onAuthStateChanged = vi.fn((_: any, cb: any) => {
			firebaseAuth.currentUser = user;
			cb(user);
			return () => {};
		});
		const onIdTokenChanged = vi.fn((_: any, cb: any) => {
			cb(user);
			return () => {};
		});

		vi.doMock('../../src/lib/firebase/client', () => ({ firebaseAuth }));
		vi.doMock('firebase/auth', () => ({
			onAuthStateChanged,
			onIdTokenChanged,
			signInWithCustomToken
		}));

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ token: 'custom', uid: 'u2' }), { status: 200 }))
		);

		const mod = await import('../../src/lib/firebase/auth-sync');
		await mod.ensureFirebaseAuthSession('u2');

		expect(signInWithCustomToken).toHaveBeenCalledWith(firebaseAuth, 'custom');
		expect(onAuthStateChanged).toHaveBeenCalledTimes(1);
		expect(onIdTokenChanged).toHaveBeenCalledTimes(1);
		expect(user.getIdToken).toHaveBeenCalled();
	});

	it('surfaces token endpoint errors', async () => {
		vi.resetModules();

		const firebaseAuth = { currentUser: null };
		vi.doMock('../../src/lib/firebase/client', () => ({ firebaseAuth }));
		vi.doMock('firebase/auth', () => ({
			onAuthStateChanged: vi.fn(),
			onIdTokenChanged: vi.fn(),
			signInWithCustomToken: vi.fn()
		}));

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 500 }))
		);

		const mod = await import('../../src/lib/firebase/auth-sync');
		await expect(mod.ensureFirebaseAuthSession('u3')).rejects.toThrow('nope');
	});

	it('rejects on auth state timeout', async () => {
		vi.useFakeTimers();
		vi.resetModules();

		const firebaseAuth = { currentUser: null };
		const onAuthStateChanged = vi.fn((_: any, _cb: any) => () => {});
		const onIdTokenChanged = vi.fn();

		vi.doMock('../../src/lib/firebase/client', () => ({ firebaseAuth }));
		vi.doMock('firebase/auth', () => ({
			onAuthStateChanged,
			onIdTokenChanged,
			signInWithCustomToken: vi.fn(async () => {})
		}));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ token: 'custom', uid: 'u4' }), { status: 200 }))
		);

		const mod = await import('../../src/lib/firebase/auth-sync');
		const promise = mod.ensureFirebaseAuthSession('u4');
		const expectation = expect(promise).rejects.toThrow(/Timed out waiting for Firebase auth state/);

		await vi.advanceTimersByTimeAsync(5001);
		await expectation;
		vi.useRealTimers();
	});

	it('rejects on ID token timeout', async () => {
		vi.useFakeTimers();
		vi.resetModules();

		const user = { uid: 'u1', getIdToken: vi.fn(async () => { throw new Error('not ready'); }) };
		const firebaseAuth: any = { currentUser: null };

		const onAuthStateChanged = vi.fn((_: any, cb: any) => {
			firebaseAuth.currentUser = user;
			cb(user);
			return () => {};
		});
		const onIdTokenChanged = vi.fn((_: any, cb: any) => {
			cb(user);
			return () => {};
		});

		vi.doMock('../../src/lib/firebase/client', () => ({ firebaseAuth }));
		vi.doMock('firebase/auth', () => ({
			onAuthStateChanged,
			onIdTokenChanged,
			signInWithCustomToken: vi.fn(async () => {})
		}));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ token: 'custom', uid: 'u1' }), { status: 200 }))
		);

		const mod = await import('../../src/lib/firebase/auth-sync');
		const promise = mod.ensureFirebaseAuthSession('u1');
		const expectation = expect(promise).rejects.toThrow(/Timed out waiting for Firebase ID token/);

		await vi.advanceTimersByTimeAsync(5001);
		await expectation;
		vi.useRealTimers();
	});

	it('rejects when auth state emits an error', async () => {
		vi.resetModules();

		const firebaseAuth = { currentUser: null };
		const onAuthStateChanged = vi.fn((_auth: any, _cb: any, err: any) => {
			err?.(new Error('auth err'));
			return () => {};
		});

		vi.doMock('../../src/lib/firebase/client', () => ({ firebaseAuth }));
		vi.doMock('firebase/auth', () => ({
			onAuthStateChanged,
			onIdTokenChanged: vi.fn(),
			signInWithCustomToken: vi.fn(async () => {})
		}));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ token: 'custom', uid: 'u1' }), { status: 200 }))
		);

		const mod = await import('../../src/lib/firebase/auth-sync');
		await expect(mod.ensureFirebaseAuthSession('u1')).rejects.toThrow('auth err');
	});

	it('rejects when token payload is invalid or UID mismatched', async () => {
		vi.resetModules();

		const firebaseAuth = { currentUser: null };
		vi.doMock('../../src/lib/firebase/client', () => ({ firebaseAuth }));
		vi.doMock('firebase/auth', () => ({
			onAuthStateChanged: vi.fn(),
			onIdTokenChanged: vi.fn(),
			signInWithCustomToken: vi.fn(async () => {})
		}));

		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(new Response(JSON.stringify({ uid: 'u1' }), { status: 200 }))
				.mockResolvedValueOnce(new Response(JSON.stringify({ token: 'custom', uid: 'other' }), { status: 200 }))
		);

		const mod = await import('../../src/lib/firebase/auth-sync');
		await expect(mod.ensureFirebaseAuthSession('u1')).rejects.toThrow(/missing required fields/i);
		await expect(mod.ensureFirebaseAuthSession('u1')).rejects.toThrow(/UID mismatch/);
	});

	it('deduplicates concurrent sync calls', async () => {
		vi.resetModules();

		const user = { uid: 'u1', getIdToken: vi.fn(async () => 'idtoken') };
		const firebaseAuth: any = { currentUser: null };

		const signInWithCustomToken = vi.fn(async () => {});
		const onAuthStateChanged = vi.fn((_: any, cb: any) => {
			firebaseAuth.currentUser = user;
			cb(user);
			return () => {};
		});
		const onIdTokenChanged = vi.fn((_: any, cb: any) => {
			cb(user);
			return () => {};
		});

		const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ token: 'custom', uid: 'u1' }), { status: 200 }));

		vi.doMock('../../src/lib/firebase/client', () => ({ firebaseAuth }));
		vi.doMock('firebase/auth', () => ({ onAuthStateChanged, onIdTokenChanged, signInWithCustomToken }));
		vi.stubGlobal('fetch', fetchSpy as any);

		const mod = await import('../../src/lib/firebase/auth-sync');
		await Promise.all([mod.ensureFirebaseAuthSession('u1'), mod.ensureFirebaseAuthSession('u1')]);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('exposes auth waiters for reuse and covers authStateReadyPromise branch', async () => {
		vi.resetModules();

		const firebaseAuth: any = { currentUser: null };

		let onAuthCb: any = null;
		const onAuthStateChanged = vi.fn((_auth: any, cb: any) => {
			onAuthCb = cb;
			return () => {};
		});

		vi.doMock('../../src/lib/firebase/client', () => ({ firebaseAuth }));
		vi.doMock('firebase/auth', () => ({
			onAuthStateChanged,
			onIdTokenChanged: vi.fn(),
			signInWithCustomToken: vi.fn()
		}));

		const mod = await import('../../src/lib/firebase/auth-sync');
		const p1 = mod.__test.waitForAuthUser('u1');
		const p2 = mod.__test.waitForAuthUser('u1');
		expect(p2).toBe(p1);

		firebaseAuth.currentUser = { uid: 'u1' };
		onAuthCb?.(firebaseAuth.currentUser);
		await p1;
	});

	it('waitForIdToken resolves immediately when current user token is available', async () => {
		vi.resetModules();

		const firebaseAuth: any = { currentUser: { uid: 'u1', getIdToken: vi.fn(async () => 'idtoken') } };
		const onIdTokenChanged = vi.fn();

		vi.doMock('../../src/lib/firebase/client', () => ({ firebaseAuth }));
		vi.doMock('firebase/auth', () => ({
			onAuthStateChanged: vi.fn(),
			onIdTokenChanged,
			signInWithCustomToken: vi.fn()
		}));

		const mod = await import('../../src/lib/firebase/auth-sync');
		await mod.__test.waitForIdToken('u1');
		expect(onIdTokenChanged).not.toHaveBeenCalled();
	});

	it('waitForIdToken rejects when onIdTokenChanged emits an error', async () => {
		vi.resetModules();

		const firebaseAuth: any = { currentUser: null };
		const onIdTokenChanged = vi.fn((_auth: any, _cb: any, err: any) => {
			err?.(new Error('id err'));
			return () => {};
		});

		vi.doMock('../../src/lib/firebase/client', () => ({ firebaseAuth }));
		vi.doMock('firebase/auth', () => ({
			onAuthStateChanged: vi.fn(),
			onIdTokenChanged,
			signInWithCustomToken: vi.fn()
		}));

		const mod = await import('../../src/lib/firebase/auth-sync');
		await expect(mod.__test.waitForIdToken('u1')).rejects.toThrow('id err');
	});

	it('reauthenticates when an existing user token is unavailable and exposes current user helpers', async () => {
		vi.resetModules();

		const user = { uid: 'u1', getIdToken: vi.fn().mockRejectedValueOnce(new Error('bad')).mockResolvedValue('idtoken') };
		const firebaseAuth: any = { currentUser: user };

		const signInWithCustomToken = vi.fn(async () => {});
		const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ token: 'custom', uid: 'u1' }), { status: 200 }));

		vi.doMock('../../src/lib/firebase/client', () => ({ firebaseAuth }));
		vi.doMock('firebase/auth', () => ({
			onAuthStateChanged: vi.fn(),
			onIdTokenChanged: vi.fn(),
			signInWithCustomToken
		}));
		vi.stubGlobal('fetch', fetchSpy as any);

		const mod = await import('../../src/lib/firebase/auth-sync');
		await mod.ensureFirebaseAuthSession('u1');

		expect(signInWithCustomToken).toHaveBeenCalledWith(firebaseAuth, 'custom');
		expect(mod.getCurrentFirebaseUser()).toBe(user);
		expect(mod.isAuthenticatedWith('u1')).toBe(true);
		expect(mod.isAuthenticatedWith('other')).toBe(false);
	});
});
