import { json } from '@sveltejs/kit';
import { getPlanConfig, getOrCreateStripeCustomer, getStripeClient } from '$lib/server/stripe';
import { PUBLIC_SITE_URL } from '$env/static/public';
import { checkoutSessionDocRef, userDocRef } from '$lib/server/firestore';

const redirectOrigin = (url: URL) => {
	return PUBLIC_SITE_URL?.trim() || `${url.protocol}//${url.host}`;
};

export const POST = async ({ request, locals, url }) => {
	const { user } = locals;

	if (!user?.uid || !user.email) {
		return json({ error: 'You must be signed in before starting checkout.' }, { status: 401 });
	}

	let planKey: string | null = null;
	try {
		const body = await request.json();
		planKey = typeof body.plan === 'string' ? body.plan : null;
	} catch (error) {
		return json({ error: 'Invalid request body.' }, { status: 400 });
	}

	const plan = getPlanConfig(planKey);
	if (!plan) {
		return json({ error: 'Plan not found.' }, { status: 400 });
	}

	try {
		const stripe = getStripeClient();
		const customer = await getOrCreateStripeCustomer(user.uid, user.email);
		const origin = redirectOrigin(url);
		const successUrl = `${origin}/billing/success?plan=${plan.plan}&session_id={CHECKOUT_SESSION_ID}`;
		const cancelUrl = `${origin}/pricing?plan=${plan.plan}&cancelled=1`;

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

				const updatedSubscription = await stripe.subscriptions.update(subscription.id, {
					items: [
						{
							id: primaryItem.id,
							price: plan.priceId,
							quantity: primaryItem.quantity ?? 1
						}
					],
					proration_behavior: 'create_prorations',
					metadata
				});

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
					console.warn('[stripe] retrieveUpcoming invoice failed', invoiceError);
				}

				return json({
					status: 'updated',
					subscriptionId: updatedSubscription.id,
					currentPlan: plan.plan,
					upcomingInvoice: upcomingInvoiceSummary
				});
			} catch (error) {
				console.error('[stripe] subscription upgrade failed, falling back to checkout', error);
			}
		}

		const titleCase = (value: string | null) =>
			value ? value.charAt(0).toUpperCase() + value.slice(1) : null;
		const changeKind = metadata.changeType ?? null;
		const changeVerb = changeKind === 'upgrade' ? 'upgrading' : changeKind ? 'changing' : null;
		const changeTitle = changeKind === 'upgrade' ? 'Upgrade' : changeKind ? 'Change' : null;

		const session = await stripe.checkout.sessions.create({
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
						trial_period_days: !isPlanChange ? plan.trialPeriodDays : undefined,
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
		});

		if (!session.url) {
			return json({ error: 'Stripe session did not return a redirect URL.' }, { status: 500 });
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

		return json({ url: session.url });
	} catch (error) {
		console.error('[stripe] checkout session error', error);
		const message = error instanceof Error ? error.message : 'Unable to start checkout.';
		return json({ error: message }, { status: 500 });
	}
};
