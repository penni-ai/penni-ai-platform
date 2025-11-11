import { createHash } from 'crypto';
import type Stripe from 'stripe';
import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/api';
import { getPlanConfig, getStripeClient } from '$lib/server/stripe';
import { userDocRef } from '$lib/server/firestore';

type UpgradeBody = {
	plan?: string;
	confirm?: boolean;
	idempotencyKey?: string;
};

const summarizeInvoice = (invoice: Stripe.Invoice) => ({
	amount_due: invoice.amount_due,
	amount_remaining: invoice.amount_remaining ?? null,
	currency: invoice.currency,
	total: invoice.total ?? null,
	subtotal: invoice.subtotal ?? null,
	invoice_pdf: invoice.invoice_pdf ?? null,
	lines: invoice.lines.data.map((line) => {
		const invoiceLine = line as Stripe.InvoiceLineItem & { proration?: boolean };
		return {
			description: invoiceLine.description,
			amount: invoiceLine.amount,
			proration: Boolean(invoiceLine.proration)
		};
	})
});

const PLAN_ORDER: Record<string, number> = {
	starter: 1,
	growth: 2
};

const deriveIdempotencyKey = (body: UpgradeBody, subscriptionId: string, planPriceId: string, quantity: number, changeType: string) => {
	if (typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()) {
		return body.idempotencyKey.trim();
	}
	return createHash('sha256')
		.update(`${subscriptionId}:${planPriceId}:${quantity}:${changeType}`)
		.digest('hex');
};

export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	assertSameOrigin(event);

	let payload: UpgradeBody;
	try {
		payload = await event.request.json();
	} catch (error) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_JSON',
			message: 'Request body must be valid JSON.',
			hint: 'Send a JSON payload with the desired plan and confirm flag.',
			cause: error
		});
	}

	const plan = getPlanConfig(payload.plan ?? null);
	if (!plan || plan.mode !== 'subscription') {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_PLAN',
			message: 'Only subscription plans can be changed through this endpoint.'
		});
	}

	const userSnapshot = await userDocRef(user.uid).get();
	const currentPlan = userSnapshot.data()?.currentPlan as { planKey?: string } | undefined;
	const currentPlanKey = currentPlan?.planKey ?? null;

	const targetOrder = PLAN_ORDER[plan.plan] ?? 0;
	const currentOrder = currentPlanKey ? PLAN_ORDER[currentPlanKey] ?? 0 : 0;
	let changeType: 'upgrade' | 'downgrade' | 'switch';
	if (!currentPlanKey) {
		changeType = 'upgrade';
	} else if (targetOrder > currentOrder) {
		changeType = 'upgrade';
	} else if (targetOrder < currentOrder) {
		changeType = 'downgrade';
	} else {
		changeType = 'switch';
	}

	const subscriptionSnapshot = await userDocRef(user.uid)
		.collection('subscriptions')
		.orderBy('updatedAt', 'desc')
		.limit(1)
		.get();

	const subscriptionDoc = subscriptionSnapshot.docs[0]?.data() as { stripeSubscriptionId?: string } | undefined;
	const activeSubscriptionId = subscriptionDoc?.stripeSubscriptionId ?? null;

	if (!activeSubscriptionId) {
		throw new ApiProblem({
			status: 400,
			code: 'NO_ACTIVE_SUBSCRIPTION',
			message: 'No active subscription found to update.'
		});
	}

	const stripe = getStripeClient();
	const subscription = await stripe.subscriptions.retrieve(activeSubscriptionId, {
		expand: ['items.data.price']
	});

	const primaryItem = subscription.items.data[0];
	if (!primaryItem) {
		throw new ApiProblem({
			status: 400,
			code: 'MISSING_SUBSCRIPTION_ITEM',
			message: 'Subscription has no items to update.'
		});
	}

	const quantity = primaryItem.quantity ?? 1;
	const logger = event.locals.logger.child({
		component: 'billing',
		action: payload.confirm ? 'confirm_plan_change' : 'preview_plan_change',
		subscriptionId: subscription.id,
		plan: plan.plan,
		changeType
	});

	if (!payload.confirm) {
		const invoicesClient = stripe.invoices as Stripe.InvoicesResource & {
			retrieveUpcoming?: (params: Record<string, unknown>) => Promise<Stripe.Invoice>;
		};
		if (!invoicesClient.retrieveUpcoming) {
			return apiOk({
				status: 'preview',
				previewUnavailable: true,
				currentPlan: currentPlanKey,
				newPlan: plan.plan,
				changeType,
				invoice: {
					amount_due: 0,
					amount_remaining: null,
					currency: 'usd',
					total: null,
					subtotal: null,
					invoice_pdf: null,
					lines: []
				}
			});
		}

		const previewInvoice = await invoicesClient.retrieveUpcoming({
			customer: subscription.customer as string,
			subscription: subscription.id,
			subscription_items: [
				{
					id: primaryItem.id,
					price: plan.priceId,
					quantity
				}
			],
			subscription_proration_behavior: changeType === 'downgrade' ? 'none' : 'create_prorations'
		});

		logger.info('Generated plan change preview');
		return apiOk({
			status: 'preview',
			currentPlan: currentPlanKey,
			newPlan: plan.plan,
			changeType,
			invoice: summarizeInvoice(previewInvoice)
		});
	}

	const metadata = {
		plan: plan.plan,
		previousPlan: currentPlanKey ?? '',
		firebaseUid: user.uid,
		changeType
	};

	const idempotencyKey = deriveIdempotencyKey(payload, subscription.id, plan.priceId, quantity, changeType);

	const updatedSubscription = await stripe.subscriptions.update(
		subscription.id,
		{
			items: [
				{
					id: primaryItem.id,
					price: plan.priceId,
					quantity
				}
			],
			proration_behavior: changeType === 'downgrade' ? 'none' : 'create_prorations',
			billing_cycle_anchor: changeType === 'downgrade' ? 'unchanged' : undefined,
			metadata
		},
		{ idempotencyKey }
	);

	let invoiceSummary = null;
	const latestInvoiceId = updatedSubscription.latest_invoice;
	if (typeof latestInvoiceId === 'string') {
		const latestInvoice = await stripe.invoices.retrieve(latestInvoiceId);
		invoiceSummary = summarizeInvoice(latestInvoice);
	}

	logger.info('Subscription updated', { idempotencyKey });

	return apiOk({
		status: 'updated',
		subscriptionId: updatedSubscription.id,
		invoice: invoiceSummary,
		newPlan: plan.plan,
		changeType
	});
}, { component: 'billing' });
