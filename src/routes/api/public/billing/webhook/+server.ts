import type { RequestHandler } from './$types';
import type Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import { ApiProblem, apiOk, handleApiRoute } from '$lib/server/core';
import type { Logger } from '$lib/server/core';
import { getStripeClient, getPlanKeyByPrice, type PlanKey } from '$lib/server/billing';
import { buildFeatureCapabilities, getRefreshDate } from '$lib/server/billing';
import { updateUserFeatureCapabilities } from '$lib/server/billing';
import {
	addonDocRef,
	checkoutSessionDocRef,
	firestore,
	stripeCustomerDocRef,
	subscriptionDocRef,
	userDocRef,
	webhookEventDocRef
} from '$lib/server/core';

const timestamp = () => Date.now();

const toMillis = (value: unknown): number | null =>
	typeof value === 'number' ? Math.round(value * 1000) : null;

// PlanKey is imported from stripe.ts

function extractUid(metadata?: Stripe.Metadata | null): string | null {
	if (!metadata) return null;
	if (typeof metadata.firebaseUid === 'string' && metadata.firebaseUid.trim().length > 0) {
		return metadata.firebaseUid.trim();
	}
	return null;
}

// buildEntitlements is now imported from billing-utils

function resolvePlanKey(metadata: Stripe.Metadata | null | undefined, priceId: string | null): PlanKey | null {
	if (metadata?.plan) {
		const raw = String(metadata.plan).toLowerCase();
		if (raw === 'free' || raw === 'starter' || raw === 'growth' || raw === 'event') {
			return raw as PlanKey;
		}
	}
	return getPlanKeyByPrice(priceId);
}

async function findUidByCustomerId(customerId: string | null, logger: Logger): Promise<string | null> {
	if (!customerId) return null;
	try {
		const snap = await stripeCustomerDocRef(customerId).get();
		const data = snap.data() as { uid?: string } | undefined;
		if (data?.uid && typeof data.uid === 'string') {
			return data.uid;
		}
	} catch (error) {
		logger.warn('Failed to resolve Firebase UID for Stripe customer', { customerId, error });
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
	const subRef = subscriptionDocRef(uid, subscription.id);
	const userRef = userDocRef(uid);
	const raw = subscription as Record<string, any>;
	const currentPeriodStart = toMillis(raw.current_period_start);
	const currentPeriodEnd = toMillis(raw.current_period_end);
	const trialStart = toMillis(raw.trial_start);
	const trialEnd = toMillis(raw.trial_end);
	const cancelAt = toMillis(raw.cancel_at);
	const canceledAt = toMillis(raw.canceled_at);
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
				cancelAtPeriodEnd: subscriptionSnapshot.cancelAtPeriodEnd,
				refreshDate: getRefreshDate()
			},
			updatedAt: now
		};

		// Update feature capabilities (single source of truth for features/limits)
		const featureCapabilities = buildFeatureCapabilities(planKey);
		userUpdate.feature_capabilities = featureCapabilities;

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
	const cancelAt = toMillis(raw.cancel_at);
	const cancelAtPeriodEnd = raw.cancel_at_period_end === true || cancelAt !== null;
	const canceledAt = toMillis(raw.canceled_at) ?? now;
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

		// Update to free plan capabilities when subscription is deleted
		const freeCapabilities = buildFeatureCapabilities('free');

		tx.set(
			userDocRef(uid),
			{
				currentPlan: {
					planKey: 'free',
					status: 'active',
					refreshDate: getRefreshDate()
				},
				feature_capabilities: freeCapabilities,
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

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session, logger: Logger) {
	const stripe = getStripeClient();
	const uid =
		extractUid(session.metadata) ??
		(await findUidByCustomerId(
			typeof session.customer === 'string' ? session.customer : null,
			logger
		));
	if (!uid) {
		logger.warn('Checkout session missing firebaseUid metadata', { sessionId: session.id });
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
		if (!planKey) {
			logger.warn('Unable to resolve plan key for checkout session', { sessionId: session.id });
			return;
		}
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

async function handleSubscriptionEvent(subscription: Stripe.Subscription, source: string, logger: Logger) {
	const stripe = getStripeClient();
	const uid =
		extractUid(subscription.metadata) ??
		(await findUidByCustomerId(
			typeof subscription.customer === 'string' ? subscription.customer : null,
			logger
		));
	if (!uid) {
		logger.warn('Subscription event missing Firebase UID', { subscriptionId: subscription.id, source });
		return;
	}
	const priceId = subscription.items.data[0]?.price?.id ?? null;
	const planKey = resolvePlanKey(subscription.metadata ?? null, priceId);
	if (!planKey) {
		logger.warn('Unable to resolve plan key for subscription', { subscriptionId: subscription.id });
		return;
	}
	await recordSubscription(uid, subscription, { planKey, source });
}

async function handleInvoiceEvent(invoice: Stripe.Invoice, source: string, logger: Logger) {
	const raw = invoice as Record<string, any>;
	const subscriptionId = typeof raw.subscription === 'string' ? (raw.subscription as string) : null;
	const customerId = typeof raw.customer === 'string' ? (raw.customer as string) : null;
	const uid = extractUid(invoice.metadata) ?? (await findUidByCustomerId(customerId, logger));
	if (!uid) {
		logger.warn('Invoice event without Firebase UID', { invoiceId: invoice.id, source });
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

async function handlePaymentIntentEvent(intent: Stripe.PaymentIntent, source: string, logger: Logger) {
	const customerId = typeof intent.customer === 'string' ? intent.customer : null;
	const uid = extractUid(intent.metadata) ?? (await findUidByCustomerId(customerId, logger));
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

export const POST: RequestHandler = handleApiRoute(async (event) => {
	const signature = event.request.headers.get('stripe-signature');
	if (!signature) {
		throw new ApiProblem({
			status: 400,
			code: 'STRIPE_SIGNATURE_MISSING',
			message: 'Missing Stripe signature header.'
		});
	}

	const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
	if (!webhookSecret) {
		event.locals.logger.error('Stripe webhook secret missing from environment');
		throw new ApiProblem({
			status: 500,
			code: 'STRIPE_WEBHOOK_SECRET_MISSING',
			message: 'Stripe webhook secret is not configured.'
		});
	}

	const rawBody = Buffer.from(await event.request.arrayBuffer());
	const stripe = getStripeClient();

	let stripeEvent: Stripe.Event;
	try {
		stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
	} catch (error) {
		event.locals.logger.warn('Stripe signature verification failed', { error });
		throw new ApiProblem({
			status: 400,
			code: 'STRIPE_SIGNATURE_INVALID',
			message: 'Invalid Stripe signature.',
			hint: 'Verify the webhook secret in Stripe dashboard matches the configured secret.',
			cause: error
		});
	}

	const logger = event.locals.logger.child({
		component: 'billing/webhook',
		stripeEventId: stripeEvent.id,
		eventType: stripeEvent.type
	});

	const logRef = webhookEventDocRef(stripeEvent.id);
	const now = timestamp();
	const existing = await logRef.get();
	if (existing.exists) {
		await logRef.set(
			{
				lastReceivedAt: now,
				processedAt: now,
				status: 'duplicate',
				outcome: 'duplicate'
			},
			{ merge: true }
		);
		logger.info('Duplicate Stripe webhook received; ignoring.');
		return apiOk({ received: true, duplicate: true });
	}

	await logRef.set(
		{
			type: stripeEvent.type,
			receivedAt: now,
			status: 'processing',
			outcome: 'processing',
			requestId: event.locals.requestId
		},
		{ merge: true }
	);

	let outcome: 'handled' | 'ignored' | 'errored' = 'handled';
	let notes: string | null = null;

	try {
		switch (stripeEvent.type) {
			case 'checkout.session.completed': {
				const session = stripeEvent.data.object as Stripe.Checkout.Session;
				await handleCheckoutSessionCompleted(session, logger);
				break;
			}
			case 'customer.subscription.created':
			case 'customer.subscription.updated': {
				const subscription = stripeEvent.data.object as Stripe.Subscription;
				await handleSubscriptionEvent(subscription, stripeEvent.type, logger);
				break;
			}
			case 'customer.subscription.deleted': {
				const subscription = stripeEvent.data.object as Stripe.Subscription;
				const uid =
					extractUid(subscription.metadata) ||
					(await findUidByCustomerId(
						typeof subscription.customer === 'string' ? subscription.customer : null,
						logger
					));
				if (uid) {
					await handleSubscriptionDeleted(uid, subscription);
				} else {
					logger.warn('Subscription deletion webhook without Firebase UID', {
						subscriptionId: subscription.id
					});
				}
				break;
			}
			case 'invoice.paid':
			case 'invoice.payment_failed': {
				const invoice = stripeEvent.data.object as Stripe.Invoice;
				await handleInvoiceEvent(invoice, stripeEvent.type, logger);
				break;
			}
			case 'customer.subscription.trial_will_end': {
				const subscription = stripeEvent.data.object as Stripe.Subscription;
				const uid =
					extractUid(subscription.metadata) ||
					(await findUidByCustomerId(
						typeof subscription.customer === 'string' ? subscription.customer : null,
						logger
					));
				if (uid) {
					await subscriptionDocRef(uid, subscription.id).set(
						{
							trialEndingSoon: true,
							trialEnd: toMillis(subscription.trial_end),
							updatedAt: timestamp()
						},
						{ merge: true }
					);
				} else {
					logger.warn('Trial-ending webhook without Firebase UID', {
						subscriptionId: subscription.id
					});
				}
				break;
			}
			case 'payment_intent.succeeded':
			case 'payment_intent.payment_failed': {
				const intent = stripeEvent.data.object as Stripe.PaymentIntent;
				await handlePaymentIntentEvent(intent, stripeEvent.type, logger);
				break;
			}
			case 'billing_portal.configuration.created':
			case 'billing_portal.configuration.updated':
			case 'billing_portal.session.created': {
				outcome = 'ignored';
				notes = 'Portal metadata event logged for audit but no action taken.';
				logger.info('Ignoring billing portal event');
				break;
			}
			default: {
				outcome = 'ignored';
				notes = 'Event type not handled';
				logger.debug('Ignoring unhandled Stripe event type');
			}
		}
	} catch (error) {
		outcome = 'errored';
		notes = error instanceof Error ? error.message : 'Unknown error';
		logger.error('Error processing Stripe webhook', { error });
		throw new ApiProblem({
			status: 500,
			code: 'STRIPE_WEBHOOK_PROCESSING_FAILED',
			message: 'Failed to process Stripe webhook event.',
			hint: 'Retry delivery from the Stripe dashboard once the issue is resolved.',
			cause: error
		});
	} finally {
		await logRef.set(
			{
				status: outcome,
				outcome,
				notes: notes ?? null,
				processedAt: timestamp()
			},
			{ merge: true }
		);
	}

	return apiOk({ received: true });
}, { component: 'billing/webhook' });
