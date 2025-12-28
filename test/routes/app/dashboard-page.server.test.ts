import { describe, expect, it, vi } from 'vitest';

function makeLogger() {
	return {
		warn: vi.fn(),
		child: vi.fn(function child() {
			return makeLogger();
		})
	};
}

describe('routes/(app)/dashboard load', () => {
	it('returns campaigns with zero stats when unauthenticated', async () => {
		vi.resetModules();

		vi.doMock('$lib/server/core', () => ({
			userDocRef: vi.fn(),
			outreachContactsCollectionRef: vi.fn(),
			firestore: { collection: vi.fn() }
		}));

		const { load } = await import('../../../src/routes/(app)/dashboard/+page.server');
		const result = await load({
			parent: async () => ({ campaigns: [{ id: 'c1', pipeline_id: 'p1' }] }),
			locals: { user: null, logger: makeLogger() }
		} as any);

		expect(result.campaigns[0].stats).toEqual({ outreachSent: 0, influencersFound: 0 });
		expect(result.hasSubscription).toBe(false);
	});

	it('uses currentPlan when active and computes stats', async () => {
		vi.resetModules();

		const contactsDocs = [
			{ data: () => ({ sendStatus: 'sent' }) },
			{ data: () => ({ sendStatus: 'pending' }) },
			{ data: () => ({ sendStatus: 'failed' }) }
		];

		const outreachContactsCollectionRef = vi.fn(() => ({
			get: vi.fn(async () => ({
				forEach: (fn: (doc: any) => void) => contactsDocs.forEach(fn)
			}))
		}));

		const firestore = {
			collection: vi.fn(() => ({
				doc: vi.fn(() => ({
					get: vi.fn(async () => ({ exists: true, data: () => ({ profiles_count: 7 }) }))
				}))
			}))
		};

		const userDocRef = vi.fn(() => ({
			get: vi.fn(async () => ({
				data: () => ({
					currentPlan: { planKey: 'starter', status: 'active', currentPeriodEnd: 123 },
					onboarding: { tutorialSkipped: true }
				})
			})),
			collection: vi.fn(() => ({
				orderBy: vi.fn(() => ({
					limit: vi.fn(() => ({
						get: vi.fn(async () => ({ docs: [] }))
					}))
				}))
			}))
		}));

		vi.doMock('$lib/server/core', () => ({ userDocRef, outreachContactsCollectionRef, firestore }));

		const { load } = await import('../../../src/routes/(app)/dashboard/+page.server');
		const result = await load({
			parent: async () => ({ campaigns: [{ id: 'c1', pipeline_id: 'p1' }] }),
			locals: { user: { uid: 'u1' }, logger: makeLogger() }
		} as any);

		expect(result.hasSubscription).toBe(true);
		expect(result.currentPlan?.planKey).toBe('starter');
		expect(result.onboardingCompleted).toBe(true);
		expect(result.campaigns[0].stats).toEqual({ outreachSent: 2, influencersFound: 7 });
	});

	it('falls back to subscriptions collection when currentPlan missing', async () => {
		vi.resetModules();

		const userDocRef = vi.fn(() => ({
			get: vi.fn(async () => ({ data: () => ({ currentPlan: { planKey: 'starter', status: 'canceled' } }) })),
			collection: vi.fn(() => ({
				orderBy: vi.fn(() => ({
					limit: vi.fn(() => ({
						get: vi.fn(async () => ({
							docs: [{ data: () => ({ planKey: 'growth', status: 'active', currentPeriodEnd: 456 }) }]
						}))
					}))
				}))
			}))
		}));

		vi.doMock('$lib/server/core', () => ({
			userDocRef,
			outreachContactsCollectionRef: vi.fn(),
			firestore: { collection: vi.fn() }
		}));

		const { load } = await import('../../../src/routes/(app)/dashboard/+page.server');
		const result = await load({
			parent: async () => ({ campaigns: [] }),
			locals: { user: { uid: 'u1' }, logger: makeLogger() }
		} as any);

		expect(result.hasSubscription).toBe(true);
		expect(result.currentPlan?.planKey).toBe('growth');
	});

	it('swallows stats errors and warns when subscription check throws', async () => {
		vi.resetModules();

		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const outreachContactsCollectionRef = vi.fn(() => ({
			get: vi.fn(async () => {
				throw new Error('contacts down');
			})
		}));

		const firestore = {
			collection: vi.fn(() => ({
				doc: vi.fn(() => ({
					get: vi.fn(async () => {
						throw new Error('pipeline down');
					})
				}))
			}))
		};

		const userDocRef = vi.fn(() => ({
			get: vi.fn(async () => {
				throw new Error('user down');
			})
		}));

		vi.doMock('$lib/server/core', () => ({ userDocRef, outreachContactsCollectionRef, firestore }));

		const { load } = await import('../../../src/routes/(app)/dashboard/+page.server');
		const logger = makeLogger();
		const result = await load({
			parent: async () => ({ campaigns: [{ id: 'c1', pipeline_id: 'p1' }] }),
			locals: { user: { uid: 'u1' }, logger }
		} as any);

		expect(logger.warn).toHaveBeenCalledWith('Failed to check subscription status', expect.any(Object));
		expect(result.campaigns[0].stats).toEqual({ outreachSent: 0, influencersFound: 0 });
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to get outreach stats'), expect.anything());
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to get pipeline stats'), expect.anything());

		errorSpy.mockRestore();
	});
});
