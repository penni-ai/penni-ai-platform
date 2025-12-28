import { describe, expect, it, vi } from 'vitest';

describe('server/billing/stripe', () => {
	it('throws when required env is missing', async () => {
		vi.resetModules();
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));

		vi.doMock('stripe', () => ({
			default: class StripeMock {}
		}));

		delete process.env.STRIPE_SECRET_KEY;
		delete process.env.STRIPE_PRODUCT_STARTER;
		delete process.env.STRIPE_PRICE_STARTER;
		delete process.env.STRIPE_PRODUCT_GROWTH;
		delete process.env.STRIPE_PRICE_GROWTH;
		delete process.env.STRIPE_PRODUCT_EVENT;
		delete process.env.STRIPE_PRICE_EVENT;

		const { getStripeClient } = await import('../../../src/lib/server/billing/stripe');
		expect(() => getStripeClient()).toThrow(/Missing required environment variable/);
	});

	it('maps plan configs + price ids and reuses cached config', async () => {
		vi.resetModules();
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));

		let lastInstance: any;
		const customers = {
			search: vi.fn(async () => ({ data: [] })),
			update: vi.fn(async (_id: string, payload: any) => ({ id: 'cust_1', ...payload })),
			create: vi.fn(async (payload: any) => ({ id: 'cust_new', ...payload }))
		};

		vi.doMock('stripe', () => ({
			default: class StripeMock {
				public customers = customers;
				constructor(public secret: string) {
					lastInstance = this;
				}
			}
		}));

		process.env.STRIPE_SECRET_KEY = 'sk_test';
		process.env.STRIPE_PRODUCT_STARTER = 'prod_starter';
		process.env.STRIPE_PRICE_STARTER = 'price_starter';
		process.env.STRIPE_PRODUCT_GROWTH = 'prod_growth';
		process.env.STRIPE_PRICE_GROWTH = 'price_growth';
		process.env.STRIPE_PRODUCT_EVENT = 'prod_event';
		process.env.STRIPE_PRICE_EVENT = 'price_event';

		const { getStripeClient, getPlanConfig, getPlanKeyByPrice } = await import('../../../src/lib/server/billing/stripe');
		expect(getStripeClient()).toBe(lastInstance);
		expect(lastInstance.secret).toBe('sk_test');

		expect(getPlanConfig('STARTER')?.priceId).toBe('price_starter');
		expect(getPlanKeyByPrice('price_growth')).toBe('growth');
		expect(getPlanKeyByPrice('missing')).toBeNull();

		// Cached across calls.
		expect(getStripeClient()).toBe(lastInstance);
	});

	it('getOrCreateStripeCustomer updates email when customer exists', async () => {
		vi.resetModules();
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));

		const search = vi.fn(async () => ({ data: [{ id: 'cust_1', email: 'old@test.com' }] }));
		const update = vi.fn(async (id: string, payload: any) => ({ id, ...payload }));
		const create = vi.fn(async (payload: any) => ({ id: 'cust_new', ...payload }));

		vi.doMock('stripe', () => ({
			default: class StripeMock {
				public customers = { search, update, create };
				constructor() {}
			}
		}));

		process.env.STRIPE_SECRET_KEY = 'sk_test';
		process.env.STRIPE_PRODUCT_STARTER = 'prod_starter';
		process.env.STRIPE_PRICE_STARTER = 'price_starter';
		process.env.STRIPE_PRODUCT_GROWTH = 'prod_growth';
		process.env.STRIPE_PRICE_GROWTH = 'price_growth';
		process.env.STRIPE_PRODUCT_EVENT = 'prod_event';
		process.env.STRIPE_PRICE_EVENT = 'price_event';

		const { getOrCreateStripeCustomer } = await import('../../../src/lib/server/billing/stripe');
		const customer = await getOrCreateStripeCustomer("uid'1", 'new@test.com');
		expect(search).toHaveBeenCalledWith({ query: "metadata['firebaseUid']:'uid\\'1'", limit: 1 });
		expect(update).toHaveBeenCalledWith('cust_1', { email: 'new@test.com' });
		expect(create).not.toHaveBeenCalled();
		expect(customer.id).toBe('cust_1');
	});

	it('getOrCreateStripeCustomer returns existing customer when email matches', async () => {
		vi.resetModules();
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));

		const search = vi.fn(async () => ({ data: [{ id: 'cust_1', email: 'same@test.com' }] }));
		const update = vi.fn();
		const create = vi.fn();

		vi.doMock('stripe', () => ({
			default: class StripeMock {
				public customers = { search, update, create };
				constructor() {}
			}
		}));

		process.env.STRIPE_SECRET_KEY = 'sk_test';
		process.env.STRIPE_PRODUCT_STARTER = 'prod_starter';
		process.env.STRIPE_PRICE_STARTER = 'price_starter';
		process.env.STRIPE_PRODUCT_GROWTH = 'prod_growth';
		process.env.STRIPE_PRICE_GROWTH = 'price_growth';
		process.env.STRIPE_PRODUCT_EVENT = 'prod_event';
		process.env.STRIPE_PRICE_EVENT = 'price_event';

		const { getOrCreateStripeCustomer } = await import('../../../src/lib/server/billing/stripe');
		const customer = await getOrCreateStripeCustomer('uid1', 'same@test.com');
		expect(update).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
		expect(customer.id).toBe('cust_1');
	});

	it('getOrCreateStripeCustomer creates when search fails', async () => {
		vi.resetModules();
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));

		const search = vi.fn(async () => {
			throw new Error('down');
		});
		const update = vi.fn();
		const create = vi.fn(async (payload: any) => ({ id: 'cust_new', ...payload }));

		vi.doMock('stripe', () => ({
			default: class StripeMock {
				public customers = { search, update, create };
				constructor() {}
			}
		}));

		process.env.STRIPE_SECRET_KEY = 'sk_test';
		process.env.STRIPE_PRODUCT_STARTER = 'prod_starter';
		process.env.STRIPE_PRICE_STARTER = 'price_starter';
		process.env.STRIPE_PRODUCT_GROWTH = 'prod_growth';
		process.env.STRIPE_PRICE_GROWTH = 'price_growth';
		process.env.STRIPE_PRODUCT_EVENT = 'prod_event';
		process.env.STRIPE_PRICE_EVENT = 'price_event';

		const { getOrCreateStripeCustomer } = await import('../../../src/lib/server/billing/stripe');
		const customer = await getOrCreateStripeCustomer('uid1', 'email@test.com');
		expect(create).toHaveBeenCalledWith({ email: 'email@test.com', metadata: { firebaseUid: 'uid1' } });
		expect(customer.id).toBe('cust_new');
	});
});
