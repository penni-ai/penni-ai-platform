import { describe, expect, it, vi } from 'vitest';

describe('routes/+layout.server load', () => {
	it('returns nulls when no user and registers dependency', async () => {
		vi.resetModules();

		const userDocRef = vi.fn();
		vi.doMock('$lib/server/core', () => ({ userDocRef }));

		const { load } = await import('../../src/routes/+layout.server');
		const depends = vi.fn();
		const result = await load({ locals: { user: null }, depends } as any);

		expect(depends).toHaveBeenCalledWith('app:user');
		expect(result).toEqual({ firebaseUser: null, profile: null });
		expect(userDocRef).not.toHaveBeenCalled();
	});

	it('loads profile name when user exists', async () => {
		vi.resetModules();

		const get = vi.fn(async () => ({
			data: () => ({ profile: { fullName: 'Ada Lovelace' } })
		}));
		const userDocRef = vi.fn(() => ({ get }));
		vi.doMock('$lib/server/core', () => ({ userDocRef }));

		const { load } = await import('../../src/routes/+layout.server');
		const depends = vi.fn();
		const result = await load(
			{
				locals: { user: { uid: 'u1', email: 'ada@example.com' } },
				depends
			} as any
		);

		expect(depends).toHaveBeenCalledWith('app:user');
		expect(userDocRef).toHaveBeenCalledWith('u1');
		expect(result).toEqual({
			firebaseUser: { email: 'ada@example.com' },
			profile: { full_name: 'Ada Lovelace' }
		});
	});

	it('returns null profile when user data has no profile field', async () => {
		vi.resetModules();

		const get = vi.fn(async () => ({ data: () => ({}) }));
		const userDocRef = vi.fn(() => ({ get }));
		vi.doMock('$lib/server/core', () => ({ userDocRef }));

		const { load } = await import('../../src/routes/+layout.server');
		const result = await load({ locals: { user: { uid: 'u1', email: null } }, depends: vi.fn() } as any);
		expect(result.profile).toBeNull();
	});
});
