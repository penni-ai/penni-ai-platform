import { createHash } from 'crypto';
import { env as publicEnv } from '$env/dynamic/public';
import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/core';
import { checkoutSessionDocRef, userDocRef } from '$lib/server/core';
import { getPlanConfig, getOrCreateStripeCustomer, getStripeClient } from '$lib/server/billing';

type CheckoutBody = {
	plan?: string;
	idempotencyKey?: string;
	returnUrl?: string;
};

const redirectOrigin = (url: URL) => publicEnv.PUBLIC_SITE_URL?.trim() || `${url.protocol}//${url.host}`;

const deriveKey = (body: CheckoutBody, userId: string, planKey: string, suffix: string) => {
	if (typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()) {
		return `${body.idempotencyKey.trim()}::${suffix}`;
	}
	return createHash('sha256').update(`${userId}:${planKey}:${suffix}`).digest('hex');
};

const titleCase = (value: string | null) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : null);

export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	assertSameOrigin(event);

	let body: CheckoutBody;
	try {
		body = await event.request.json();
	} catch (error) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_JSON',
			message: 'Request body must be valid JSON.',
			hint: 'Send a JSON payload with a "plan" field.',
			cause: error
		});
	}

	const plan = getPlanConfig(typeof body.plan === 'string' ? body.plan : null);
	if (!plan) {
		throw new ApiProblem({
			status: 400,
			code: 'PLAN_NOT_FOUND',
			message: 'Requested plan was not found.'
		});
	}

	const logger = event.locals.logger.child({
		component: 'billing',
		action: 'start_checkout',
		plan: plan.plan
	});

	try {
		const stripe = getStripeClient();
		const customer = await getOrCreateStripeCustomer(user.uid, user.email ?? '');
		const origin = redirectOrigin(event.url);
		
		// Helper to convert relative URLs to absolute URLs
		const toAbsoluteUrl = (url: string): string => {
			if (url.startsWith('http://') || url.startsWith('https://')) {
				return url; // Already absolute
			}
			// Relative URL - prepend origin
			const path = url.startsWith('/') ? url : `/${url}`;
			return `${origin}${path}`;
		};
		
		// Use returnUrl if provided, otherwise default to billing page
		const returnUrlRaw = typeof body.returnUrl === 'string' && body.returnUrl.trim()
			? body.returnUrl.trim()
			: `${origin}/my-account/billing?session_id={CHECKOUT_SESSION_ID}`;
		
		// Convert to absolute URL if needed
		const returnUrl = toAbsoluteUrl(returnUrlRaw);
		
		// For cancel URL, try to preserve the return URL context, otherwise default to pricing
		const cancelUrlRaw = typeof body.returnUrl === 'string' && body.returnUrl.trim()
			? body.returnUrl.trim()
			: `${origin}/pricing?plan=${plan.plan}&cancelled=1`;
		
		const cancelUrl = toAbsoluteUrl(cancelUrlRaw);
		
		const successUrl = returnUrl.includes('{CHECKOUT_SESSION_ID}') 
			? returnUrl 
			: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`;

		const metadata: Record<string, string> = {
			plan: plan.plan,
			firebaseUid: user.uid
		};

		const accountSnapshot = await userDocRef(user.uid).get();
		const currentPlan = accountSnapshot.data()?.currentPlan as { planKey?: string } | undefined;
		const currentPlanKey = currentPlan?.planKey ?? null;

		const subscriptionSnapshot = await userDocRef(user.uid)
			.collection('subscriptions')
			.orderBy('updatedAt', 'desc')
			.limit(1)
			.get();
		const subscriptionDoc = subscriptionSnapshot.docs[0]?.data() as { stripeSubscriptionId?: string } | undefined;
		const activeSubscriptionId = subscriptionDoc?.stripeSubscriptionId ?? null;
		const isSubscription = plan.mode === 'subscription';
		const isPlanChange = isSubscription && currentPlanKey && currentPlanKey !== plan.plan;

		if (isPlanChange && currentPlanKey) {
			metadata.changeType = plan.plan === 'growth' ? 'upgrade' : 'change';
			metadata.previousPlan = currentPlanKey;
		}

		if (isPlanChange && activeSubscriptionId) {
			try {
				const subscription = await stripe.subscriptions.retrieve(activeSubscriptionId, {
					expand: ['items.data.price']
				});

				const primaryItem = subscription.items.data[0];
				if (!primaryItem) {
					throw new Error('Subscription has no items to update.');
				}

				const subscriptionIdempotencyKey = deriveKey(body, user.uid, plan.plan, 'subscription-update');
				const updatedSubscription = await stripe.subscriptions.update(
					subscription.id,
					{
						items: [
							{
								id: primaryItem.id,
								price: plan.priceId,
								quantity: primaryItem.quantity ?? 1
							}
						],
						proration_behavior: 'create_prorations',
						metadata
					},
					{ idempotencyKey: subscriptionIdempotencyKey }
				);

				let upcomingInvoiceSummary: {
					amount_due: number;
					currency: string;
					amount_remaining: number | null;
					total: number | null;
					invoice_pdf: string | null;
				} | null = null;

				try {
					const retrieveUpcoming = (stripe.invoices as unknown as {
						retrieveUpcoming?: (params: Record<string, unknown>) => Promise<{
							amount_due: number;
							currency: string;
							amount_remaining: number | null;
							total: number | null;
							invoice_pdf?: string | null;
						}>;
					}).retrieveUpcoming;

					if (retrieveUpcoming) {
						const upcomingInvoice = await retrieveUpcoming({
							customer: subscription.customer as string,
							subscription: subscription.id
						});
						upcomingInvoiceSummary = {
							amount_due: upcomingInvoice.amount_due,
							currency: upcomingInvoice.currency,
							amount_remaining: upcomingInvoice.amount_remaining,
							total: upcomingInvoice.total,
							invoice_pdf: upcomingInvoice.invoice_pdf ?? null
						};
					}
				} catch (invoiceError) {
					logger.warn('retrieveUpcoming invoice failed', { invoiceError });
				}

				logger.info('Subscription upgraded without checkout', {
					subscriptionId: subscription.id
				});

				return apiOk({
					status: 'updated',
					subscriptionId: updatedSubscription.id,
					currentPlan: plan.plan,
					upcomingInvoice: upcomingInvoiceSummary
				});
			} catch (error) {
				logger.warn('Subscription upgrade via API failed, falling back to checkout', { error });
			}
		}

		const changeKind = metadata.changeType ?? null;
		const changeVerb = changeKind === 'upgrade' ? 'upgrading' : changeKind ? 'changing' : null;
		const changeTitle = changeKind === 'upgrade' ? 'Upgrade' : changeKind ? 'Change' : null;

		// Include parameters that affect the checkout session in the idempotency key
		// This ensures the key matches the actual session parameters
		const keyComponents = [
			user.uid,
			plan.plan,
			plan.mode,
			isPlanChange ? 'change' : 'new',
			currentPlanKey || 'none',
			'checkout-session'
		];
		const sessionIdempotencyKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
			? `${body.idempotencyKey.trim()}::checkout-session`
			: createHash('sha256').update(keyComponents.join(':')).digest('hex');
		const session = await stripe.checkout.sessions.create(
			{
				mode: plan.mode,
				customer: customer.id,
				line_items: [
					{
						price: plan.priceId,
						quantity: 1
					}
				],
				success_url: successUrl,
				cancel_url: cancelUrl,
				allow_promotion_codes: plan.mode === 'subscription',
				customer_update: {
					address: 'auto'
				},
				automatic_tax: { enabled: false },
				metadata,
				custom_text:
					changeKind && currentPlanKey && changeVerb
						? {
							submit: {
								message: `You're ${changeVerb} from ${titleCase(currentPlanKey)} to ${titleCase(plan.plan)}. Any remaining balance is prorated automatically.`
							}
						}
						: undefined,
				subscription_data:
					isSubscription
						? {
							metadata,
							description:
								changeTitle && currentPlanKey
									? `${changeTitle} from ${titleCase(currentPlanKey)} to ${titleCase(plan.plan)}`
								: undefined
						}
						: undefined,
				payment_intent_data:
					plan.mode === 'payment'
						? {
							metadata
						}
						: undefined
			},
			{ idempotencyKey: sessionIdempotencyKey }
		);

		if (!session.url) {
			throw new ApiProblem({
				status: 502,
				code: 'STRIPE_SESSION_URL_MISSING',
				message: 'Stripe did not return a checkout URL.',
				hint: 'Retry in a moment or contact support if the issue persists.'
			});
		}

		await checkoutSessionDocRef(session.id).set(
			{
				firebaseUid: user.uid,
				plan: plan.plan,
				mode: plan.mode,
				stripeCustomerId: customer.id,
				status: 'pending',
				createdAt: Date.now()
			},
			{ merge: true }
		);

		logger.info('Checkout session created', { checkoutSessionId: session.id });
		return apiOk({ url: session.url });
	} catch (error) {
		if (error instanceof ApiProblem) {
			throw error;
		}
		logger.error('Failed to initiate checkout', { error });
		throw new ApiProblem({
			status: 502,
			code: 'CHECKOUT_START_FAILED',
			message: 'Unable to start checkout with Stripe.',
			hint: 'Retry shortly. If the problem persists, contact support.',
			cause: error
		});
	}
}, { component: 'billing' });
