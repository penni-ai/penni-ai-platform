import { json } from '@sveltejs/kit';
import { getPlanConfig, getStripeClient } from '$lib/server/stripe';
import { userDocRef } from '$lib/server/firestore';
import type Stripe from 'stripe';

type UpgradeBody = {
	plan?: string;
	confirm?: boolean;
};

const summarizeInvoice = (invoice: Stripe.Invoice) => {
	return {
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
	};
};

export const POST = async ({ request, locals }) => {
	const { user } = locals;
	if (!user?.uid || !user.email) {
		return json({ error: 'You must be signed in.' }, { status: 401 });
	}

	let payload: UpgradeBody;
	try {
		payload = await request.json();
	} catch (error) {
		return json({ error: 'Invalid request body.' }, { status: 400 });
	}

	const plan = getPlanConfig(payload.plan ?? null);
	if (!plan || plan.mode !== 'subscription') {
		return json({ error: 'Only subscription plans can be changed.' }, { status: 400 });
}

	const userSnapshot = await userDocRef(user.uid).get();
	const currentPlan = userSnapshot.data()?.currentPlan as { planKey?: string } | undefined;
	const currentPlanKey = currentPlan?.planKey ?? null;

	const planOrder: Record<string, number> = {
		starter: 1,
		growth: 2
	};

	const normalizedCurrent = currentPlanKey ?? null;
	const targetOrder = planOrder[plan.plan] ?? 0;
	const currentOrder = normalizedCurrent ? planOrder[normalizedCurrent] ?? 0 : 0;
	let changeType: 'upgrade' | 'downgrade' | 'switch';
	if (!normalizedCurrent) {
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
		return json({ error: 'No active subscription to change.' }, { status: 400 });
}

	try {
	const stripe = getStripeClient();
	const subscription = await stripe.subscriptions.retrieve(activeSubscriptionId, {
			expand: ['items.data.price']
		});

		const primaryItem = subscription.items.data[0];
		if (!primaryItem) {
			return json({ error: 'Subscription has no items to update.' }, { status: 400 });
		}

		const quantity = primaryItem.quantity ?? 1;

		if (!payload.confirm) {
			const invoicesClient = stripe.invoices as Stripe.InvoicesResource & {
				retrieveUpcoming?: (params: Record<string, unknown>) => Promise<Stripe.Invoice>;
			};
			if (!invoicesClient.retrieveUpcoming) {
				return json({
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

			return json({
				status: 'preview',
				currentPlan: currentPlanKey,
				newPlan: plan.plan,
				changeType,
				invoice: summarizeInvoice(previewInvoice)
			});
		}

		const updatedSubscription = await stripe.subscriptions.update(subscription.id, {
			items: [
				{
					id: primaryItem.id,
					price: plan.priceId,
					quantity
				}
			],
			proration_behavior: changeType === 'downgrade' ? 'none' : 'create_prorations',
			billing_cycle_anchor: changeType === 'downgrade' ? 'unchanged' : undefined,
			metadata: {
				plan: plan.plan,
				previousPlan: currentPlanKey ?? '',
				firebaseUid: user.uid,
				changeType
			}
		});

		let invoiceSummary = null;
		const latestInvoiceId = updatedSubscription.latest_invoice;
		if (typeof latestInvoiceId === 'string') {
			const latestInvoice = await stripe.invoices.retrieve(latestInvoiceId);
			invoiceSummary = summarizeInvoice(latestInvoice);
		}

		return json({
			status: 'updated',
			subscriptionId: updatedSubscription.id,
			invoice: invoiceSummary,
			newPlan: plan.plan,
			changeType
		});
	} catch (error) {
		console.error('[stripe] upgrade endpoint error', error);
		const message = error instanceof Error ? error.message : 'Unable to update plan. Please try again or manage billing from your account.';
		return json({ error: message }, { status: 500 });
	}
};
