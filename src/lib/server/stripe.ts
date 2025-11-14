import Stripe from 'stripe';
import { env } from '$env/dynamic/private';

export type PlanKey = 'free' | 'starter' | 'growth' | 'event';

type PlanConfig = {
	plan: PlanKey;
	productId: string;
	priceId: string;
	mode: 'subscription' | 'payment';
	trialPeriodDays?: number;
};

type StripeState = {
	stripe: Stripe;
	planCatalog: Partial<Record<PlanKey, PlanConfig>>;
	priceToPlan: Record<string, PlanKey>;
};

let cachedState: StripeState | null = null;

function readEnv(key: string) {
	return env[key] ?? process.env[key];
}

function ensureConfig(): StripeState {
	if (cachedState) return cachedState;

	const requireEnv = (key: string) => {
		const value = readEnv(key);
		if (!value) {
			throw new Error(`Missing required environment variable: ${key}`);
		}
		return value;
	};

	const secret = requireEnv('STRIPE_SECRET_KEY');
	const planCatalog: Partial<Record<PlanKey, PlanConfig>> = {
		// Note: 'free' plan doesn't need Stripe configuration
		starter: {
			plan: 'starter',
			productId: requireEnv('STRIPE_PRODUCT_STARTER'),
			priceId: requireEnv('STRIPE_PRICE_STARTER'),
			mode: 'subscription',
			trialPeriodDays: 3
		},
		growth: {
			plan: 'growth',
			productId: requireEnv('STRIPE_PRODUCT_GROWTH'),
			priceId: requireEnv('STRIPE_PRICE_GROWTH'),
			mode: 'subscription'
		},
		event: {
			plan: 'event',
			productId: requireEnv('STRIPE_PRODUCT_EVENT'),
			priceId: requireEnv('STRIPE_PRICE_EVENT'),
			mode: 'payment'
		}
	};

	const priceToPlan = Object.values(planCatalog).reduce<Record<string, PlanKey>>((map, config) => {
		map[config.priceId] = config.plan;
		return map;
	}, {});

	const stripe = new Stripe(secret, {
		appInfo: {
			name: 'Penny Platform',
			version: '0.1.0'
		}
	});

	cachedState = { stripe, planCatalog, priceToPlan };
	return cachedState;
}

export function getStripeClient(): Stripe {
	return ensureConfig().stripe;
}

export function getPlanConfig(key: string | null | undefined): PlanConfig | null {
	if (!key) return null;
	const normalized = key.toLowerCase() as PlanKey;
	return ensureConfig().planCatalog[normalized] ?? null;
}

export function getPlanKeyByPrice(priceId: string | null | undefined): PlanKey | null {
	if (!priceId) return null;
	return ensureConfig().priceToPlan[priceId] ?? null;
}

const escapeQuery = (input: string) => input.replace(/'/g, "\\'");

export async function getOrCreateStripeCustomer(firebaseUid: string, email: string) {
	const stripe = getStripeClient();
	const query = `metadata['firebaseUid']:'${escapeQuery(firebaseUid)}'`;
	try {
		const existing = await stripe.customers.search({ query, limit: 1 });
		if (existing.data.length > 0) {
			const customer = existing.data[0];
			if (email && customer.email !== email) {
				return await stripe.customers.update(customer.id, { email });
			}
			return customer;
		}
	} catch (error) {
		console.warn('[stripe] customer search failed, creating new customer', error);
	}

	return stripe.customers.create({
		email: email || undefined,
		metadata: {
			firebaseUid
		}
	});
}
