import type { RequestHandler } from './$types';
import type Stripe from 'stripe';
import { getStripeClient, getPlanKeyByPrice } from '$lib/server/stripe';
import { env } from '$env/dynamic/private';
import {
	addonDocRef,
	checkoutSessionDocRef,
	firestore,
	stripeCustomerDocRef,
	subscriptionDocRef,
	userDocRef,
	webhookEventDocRef
} from '$lib/server/firestore';

const timestamp = () => Date.now();

type PlanKey = ReturnType<typeof getPlanKeyByPrice>;

function extractUid(metadata?: Stripe.Metadata | null): string | null {
	if (!metadata) return null;
	if (typeof metadata.firebaseUid === 'string' && metadata.firebaseUid.trim().length > 0) {
		return metadata.firebaseUid.trim();
	}
	return null;
}

function buildEntitlements(planKey: PlanKey) {
	if (planKey === 'starter') {
		return {
			maxProfiles: 300,
			connectedInboxes: 1,
			monthlyOutreachEmails: 200,
			maxActiveCampaigns: 1,
			csvExportEnabled: false
		};
	}
	if (planKey === 'growth') {
		return {
			maxProfiles: 1000,
			connectedInboxes: 3,
			monthlyOutreachEmails: 700,
			maxActiveCampaigns: 10,
			csvExportEnabled: true
		};
	}
	return undefined;
}

function resolvePlanKey(metadata: Stripe.Metadata | null | undefined, priceId: string | null): PlanKey {
	if (metadata?.plan) {
		const raw = String(metadata.plan).toLowerCase();
		if (raw === 'starter' || raw === 'growth') {
			return raw;
		}
	}
	return getPlanKeyByPrice(priceId) ?? null;
}

async function findUidByCustomerId(customerId: string | null): Promise<string | null> {
	if (!customerId) return null;
	try {
		const snap = await stripeCustomerDocRef(customerId).get();
		const data = snap.data() as { uid?: string } | undefined;
		if (data?.uid && typeof data.uid === 'string') {
			return data.uid;
		}
	} catch (error) {
		console.warn('[stripe] failed to resolve uid for customer', customerId, error);
	}
	return null;
}

async function recordSubscription(
	uid: string,
	subscription: Stripe.Subscription,
	options: { planKey: PlanKey; source: string }
) {
	const now = timestamp();
	const price = subscription.items.data[0]?.price || null;
	const planKey = options.planKey ?? resolvePlanKey(subscription.metadata ?? null, price?.id ?? null);
	const entitlements = buildEntitlements(planKey);
	const subRef = subscriptionDocRef(uid, subscription.id);
	const userRef = userDocRef(uid);
	const raw = subscription as Record<string, any>;
	const currentPeriodStart = typeof raw.current_period_start === 'number' ? raw.current_period_start : null;
	const currentPeriodEnd = typeof raw.current_period_end === 'number' ? raw.current_period_end : null;
	const trialStart = typeof raw.trial_start === 'number' ? raw.trial_start : null;
	const trialEnd = typeof raw.trial_end === 'number' ? raw.trial_end : null;
	const cancelAt = typeof raw.cancel_at === 'number' ? raw.cancel_at : null;
	const canceledAt = typeof raw.canceled_at === 'number' ? raw.canceled_at : null;
	const cancelAtPeriodEnd = raw.cancel_at_period_end === true || cancelAt !== null;
	const customerEmail = typeof raw.customer_email === 'string' ? raw.customer_email : null;

	const subscriptionSnapshot = {
		stripeSubscriptionId: subscription.id,
		planKey,
		priceId: price?.id ?? null,
		productId: price?.product && typeof price.product === 'string' ? price.product : null,
		status: subscription.status,
		stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null,
		currentPeriodStart,
		currentPeriodEnd,
		trialStart,
		trialEnd,
		cancelAtPeriodEnd,
		cancelAt,
		canceledAt,
		latestInvoiceId: typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : null,
		defaultPaymentMethodId:
			subscription.default_payment_method && typeof subscription.default_payment_method === 'string'
				? subscription.default_payment_method
				: null,
		items: subscription.items.data.map((item) => ({
			id: item.id,
			priceId: item.price.id,
			productId: typeof item.price.product === 'string' ? item.price.product : null,
			quantity: item.quantity ?? null,
			planNickname: item.plan?.nickname ?? item.price.nickname ?? null
		})),
		updatedAt: now,
		source: options.source
	};

	await firestore.runTransaction(async (tx) => {
		tx.set(subRef, subscriptionSnapshot, { merge: true });

		const userUpdate: Record<string, unknown> = {
			stripeCustomerId: subscriptionSnapshot.stripeCustomerId,
			email: customerEmail,
			currentPlan: {
				planKey,
				priceId: subscriptionSnapshot.priceId,
				status: subscription.status,
				currentPeriodEnd: subscriptionSnapshot.currentPeriodEnd,
				trialEnd: subscriptionSnapshot.trialEnd,
				cancelAtPeriodEnd: subscriptionSnapshot.cancelAtPeriodEnd
			},
			updatedAt: now
		};

		if (entitlements) {
			userUpdate.entitlements = entitlements;
		}

		tx.set(userRef, userUpdate, { merge: true });

		if (subscriptionSnapshot.stripeCustomerId) {
			tx.set(
				stripeCustomerDocRef(subscriptionSnapshot.stripeCustomerId),
				{ uid, updatedAt: now },
				{ merge: true }
			);
		}

		tx.set(
			userRef.collection('subscriptionHistory').doc(subscription.id + '-' + now),
			{
				subscriptionId: subscription.id,
				status: subscription.status,
				planKey,
				source: options.source,
				recordedAt: now
			},
			{ merge: true }
		);
	});
}

async function handleSubscriptionDeleted(uid: string, subscription: Stripe.Subscription) {
	const now = timestamp();
	const raw = subscription as Record<string, any>;
	const cancelAt = typeof raw.cancel_at === 'number' ? raw.cancel_at : null;
	const cancelAtPeriodEnd = raw.cancel_at_period_end === true || cancelAt !== null;
	const canceledAt = typeof raw.canceled_at === 'number' ? raw.canceled_at : now;
	await firestore.runTransaction(async (tx) => {
		tx.set(
			subscriptionDocRef(uid, subscription.id),
			{
				status: subscription.status,
				cancelAtPeriodEnd,
				cancelAt,
				canceledAt,
				updatedAt: now
			},
			{ merge: true }
		);

		tx.set(
			userDocRef(uid),
			{
				currentPlan: null,
				entitlements: {},
				updatedAt: now
			},
			{ merge: true }
		);

		tx.set(
			userDocRef(uid).collection('subscriptionHistory').doc(subscription.id + '-' + now),
			{
				subscriptionId: subscription.id,
				status: subscription.status,
				source: 'subscription.deleted',
				recordedAt: now
			},
			{ merge: true }
		);
	});
}

async function recordAddon(uid: string, params: {
	addonKey: string;
	stripeCustomerId: string | null;
	priceId: string | null;
	productId: string | null;
	paymentIntentId: string | null;
	invoiceId: string | null;
	status: 'purchased' | 'fulfilled';
}) {
	const now = timestamp();
	const addonId = params.paymentIntentId ?? params.addonKey;
	const payload: Record<string, unknown> = {
		addonId,
		status: params.status,
		updatedAt: now
	};
	if (params.stripeCustomerId) payload.stripeCustomerId = params.stripeCustomerId;
	if (params.paymentIntentId) payload.paymentIntentId = params.paymentIntentId;
	if (params.invoiceId) payload.invoiceId = params.invoiceId;
	if (params.priceId) payload.priceId = params.priceId;
	if (params.productId) payload.productId = params.productId;
	if (params.status === 'purchased') payload.purchasedAt = now;
	if (params.status === 'fulfilled') payload.fulfilledAt = now;

	await addonDocRef(uid, addonId).set(payload, { merge: true });

	await userDocRef(uid).set(
		{
			addons: {
				eventAccess: true
			},
			updatedAt: now
		},
		{ merge: true }
	);
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
	const stripe = getStripeClient();
  const uid = extractUid(session.metadata) ?? (await findUidByCustomerId(typeof session.customer === 'string' ? session.customer : null));
	if (!uid) {
		console.warn('[stripe] checkout session missing firebaseUid', session.id);
		return;
	}

	const completedAt = timestamp();
	const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
	const paymentIntentId =
		typeof session.payment_intent === 'string'
			? session.payment_intent
			: session.payment_intent && 'id' in session.payment_intent
				? session.payment_intent.id
				: null;

	await checkoutSessionDocRef(session.id).set(
		{
			status: 'completed',
			completedAt,
			subscriptionId,
			paymentIntentId
		},
		{ merge: true }
	);

	if (session.mode === 'subscription' && subscriptionId) {
		const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
			expand: ['items.data.price.product', 'default_payment_method']
		});
		const firstPriceId = subscription.items.data[0]?.price?.id ?? null;
		const planKey = resolvePlanKey(session.metadata ?? null, firstPriceId);
		await recordSubscription(uid, subscription, {
			planKey,
			source: 'checkout.session.completed'
		});
	} else if (session.mode === 'payment') {
		const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5 });
		const primary = lineItems.data[0];
		const priceId = primary?.price?.id ?? null;
		const productId =
			primary?.price?.product && typeof primary.price.product === 'string'
				? (primary.price.product as string)
				: null;
		await recordAddon(uid, {
			addonKey: session.id,
			stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
			priceId,
			productId,
			paymentIntentId,
			invoiceId: typeof session.invoice === 'string' ? session.invoice : null,
			status: 'purchased'
		});
	}
}

async function handleSubscriptionEvent(subscription: Stripe.Subscription, source: string) {
	const stripe = getStripeClient();
  const uid =
		extractUid(subscription.metadata) ??
		(await findUidByCustomerId(typeof subscription.customer === 'string' ? subscription.customer : null));
	if (!uid) {
		console.warn('[stripe] subscription event without uid', subscription.id);
		return;
	}
	const priceId = subscription.items.data[0]?.price?.id ?? null;
	const planKey = resolvePlanKey(subscription.metadata ?? null, priceId);
	await recordSubscription(uid, subscription, { planKey, source });
}

async function handleInvoiceEvent(invoice: Stripe.Invoice, source: string) {
  const raw = invoice as Record<string, any>;
	const subscriptionId = typeof raw.subscription === 'string' ? (raw.subscription as string) : null;
	const customerId = typeof raw.customer === 'string' ? (raw.customer as string) : null;
	const uid = extractUid(invoice.metadata) ?? (await findUidByCustomerId(customerId));
	if (!uid) {
		console.warn('[stripe] invoice event without uid', invoice.id);
		return;
	}
	const now = timestamp();
	if (subscriptionId) {
		await subscriptionDocRef(uid, subscriptionId).set(
			{
				latestInvoiceId: invoice.id,
				invoiceStatus: invoice.status,
				amountDue: invoice.amount_due,
				amountPaid: invoice.amount_paid,
				hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
				updatedAt: now
			},
			{ merge: true }
		);
	}

	await userDocRef(uid).set(
		{
			lastInvoiceId: invoice.id,
			lastInvoiceStatus: invoice.status,
			updatedAt: now
		},
		{ merge: true }
	);

	if (source === 'invoice.payment_failed' && subscriptionId) {
		await subscriptionDocRef(uid, subscriptionId).set(
			{
				status: 'past_due',
				updatedAt: now
			},
			{ merge: true }
		);
	}
}

async function handlePaymentIntentEvent(intent: Stripe.PaymentIntent, source: string) {
  const customerId = typeof intent.customer === 'string' ? intent.customer : null;
	const uid = extractUid(intent.metadata) ?? (await findUidByCustomerId(customerId));
	if (!uid) {
		return;
	}
	const plan = intent.metadata?.plan ? String(intent.metadata.plan).toLowerCase() : null;
	if (plan === 'event') {
		const invoiceId = (intent as Record<string, any>).invoice;
		await recordAddon(uid, {
			addonKey: intent.id,
			stripeCustomerId: customerId,
			priceId: intent.metadata?.priceId ? String(intent.metadata.priceId) : null,
			productId: intent.metadata?.productId ? String(intent.metadata.productId) : null,
			paymentIntentId: intent.id,
			invoiceId: typeof invoiceId === 'string' ? invoiceId : null,
			status: source === 'payment_intent.succeeded' ? 'fulfilled' : 'purchased'
		});
	}
}

export const POST: RequestHandler = async ({ request }) => {
	const signature = request.headers.get('stripe-signature');
	if (!signature) {
		return new Response('Missing Stripe signature.', { status: 400 });
	}

	const payload = await request.text();
	const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
	if (!webhookSecret) {
		console.error('[stripe] webhook secret missing in environment');
		return new Response('Webhook configuration error.', { status: 500 });
	}
	const stripe = getStripeClient();

	try {
		const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);

		const logRef = webhookEventDocRef(event.id);
		const existing = await logRef.get();
		if (existing.exists) {
			return new Response(JSON.stringify({ received: true, duplicate: true }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		await logRef.set(
			{
				type: event.type,
				receivedAt: timestamp(),
				status: 'processing'
			},
			{ merge: true }
		);

		let outcome: 'handled' | 'ignored' = 'handled';
		let notes: string | null = null;

		switch (event.type) {
			case 'checkout.session.completed': {
				const session = event.data.object as Stripe.Checkout.Session;
				await handleCheckoutSessionCompleted(session);
				break;
			}
			case 'customer.subscription.created':
			case 'customer.subscription.updated': {
				const subscription = event.data.object as Stripe.Subscription;
				await handleSubscriptionEvent(subscription, event.type);
				break;
			}
			case 'customer.subscription.deleted': {
				const subscription = event.data.object as Stripe.Subscription;
				const uid =
					extractUid(subscription.metadata) ||
					(await findUidByCustomerId(typeof subscription.customer === 'string' ? subscription.customer : null));
				if (uid) {
					await handleSubscriptionDeleted(uid, subscription);
				}
				break;
			}
			case 'invoice.paid':
			case 'invoice.payment_failed': {
				const invoice = event.data.object as Stripe.Invoice;
				await handleInvoiceEvent(invoice, event.type);
				break;
			}
			case 'customer.subscription.trial_will_end': {
				const subscription = event.data.object as Stripe.Subscription;
				const uid =
					extractUid(subscription.metadata) ||
					(await findUidByCustomerId(typeof subscription.customer === 'string' ? subscription.customer : null));
				if (uid) {
					await subscriptionDocRef(uid, subscription.id).set(
						{
							trialEndingSoon: true,
							trialEnd: subscription.trial_end ?? null,
							updatedAt: timestamp()
						},
						{ merge: true }
					);
				}
				break;
			}
			case 'payment_intent.succeeded':
			case 'payment_intent.payment_failed': {
				const intent = event.data.object as Stripe.PaymentIntent;
				await handlePaymentIntentEvent(intent, event.type);
				break;
			}
			case 'billing_portal.configuration.created':
			case 'billing_portal.configuration.updated':
			case 'billing_portal.session.created': {
				outcome = 'ignored';
				notes = 'Portal metadata event logged for audit but no action taken.';
				break;
			}
			default: {
				console.debug('[stripe] unhandled event', event.type);
				outcome = 'ignored';
			}
		}

		await logRef.set(
			{
				status: outcome,
				notes: notes ?? null,
				processedAt: timestamp()
			},
			{ merge: true }
		);

		return new Response(JSON.stringify({ received: true }), {
			status: 200,
			headers: {
				'content-type': 'application/json'
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.error('[stripe] webhook signature verification failed', message);
		return new Response(`Webhook Error: ${message}`, { status: 400 });
	}
};
