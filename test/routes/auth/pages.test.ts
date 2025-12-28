import { describe, expect, it, vi } from 'vitest';

describe('auth-related page loads', () => {
	it('maps verify mode + oobCode from URL', async () => {
		vi.resetModules();
		const { load } = await import('../../../src/routes/auth/verify/+page');
		const url = new URL('http://localhost/auth/verify?mode=verifyEmail&oobCode=abc');
		expect(load({ url } as any)).toEqual({ mode: 'verifyEmail', oobCode: 'abc' });
	});

	it('sign-in sets verifiedNotice from query string', async () => {
		vi.resetModules();
		const { load } = await import('../../../src/routes/sign-in/+page');
		expect(load({ url: new URL('http://localhost/sign-in?verified=1') } as any)).toEqual({ verifiedNotice: true });
		expect(load({ url: new URL('http://localhost/sign-in') } as any)).toEqual({ verifiedNotice: false });
	});

	it('sign-up confirm returns email parameter', async () => {
		vi.resetModules();
		const { load } = await import('../../../src/routes/sign-up/confirm/+page');
		expect(await load({ url: new URL('http://localhost/sign-up/confirm?email=a%40b.com') } as any)).toEqual({ email: 'a@b.com' });
	});

	it('logout revokes tokens when user present and always clears cookie', async () => {
		vi.resetModules();

		const revokeRefreshTokens = vi.fn(async () => {});
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { revokeRefreshTokens } }));

		const cookies = { delete: vi.fn() };
		const depends = vi.fn();

		const { load } = await import('../../../src/routes/logout/+page.server');
		await expect(
			load({
				cookies,
				depends,
				locals: { user: { uid: 'u1' } }
			} as any)
		).rejects.toMatchObject({ status: 307, location: '/' });

		expect(depends).toHaveBeenCalledWith('app:user');
		expect(revokeRefreshTokens).toHaveBeenCalledWith('u1');
		expect(cookies.delete).toHaveBeenCalledWith('__session', { path: '/' });
	});

	it('logout ignores revoke errors', async () => {
		vi.resetModules();

		const revokeRefreshTokens = vi.fn(async () => {
			throw new Error('nope');
		});
		vi.doMock('$lib/firebase/admin', () => ({ adminAuth: { revokeRefreshTokens } }));

		const cookies = { delete: vi.fn() };
		const { load } = await import('../../../src/routes/logout/+page.server');

		await expect(
			load({
				cookies,
				depends: vi.fn(),
				locals: { user: { uid: 'u1' } }
			} as any)
		).rejects.toMatchObject({ status: 307 });
		expect(cookies.delete).toHaveBeenCalled();
	});
});

