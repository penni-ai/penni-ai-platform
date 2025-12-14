import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/core';
import { userDocRef, subscriptionDocRef, firestore } from '$lib/server/core';
import { getOrCreateStripeCustomer, getStripeClient } from '$lib/server/billing';

/**
 * Cancel subscription endpoint
 *
 * POST /api/billing/cancel
 *
 * Request body:
 *   - immediate?: boolean - If true, cancel immediately. Default is cancel at period end.
 *
 * Returns:
 *   - status: 'scheduled' | 'canceled'
 *   - cancelAt: number (timestamp when subscription ends)
 *   - message: string
 */
export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	assertSameOrigin(event);

	const logger = event.locals.logger.child({ component: 'billing', action: 'cancel_subscription' });

	try {
		const body = await event.request.json().catch(() => ({}));
		const immediate = body.immediate === true;

		const stripe = getStripeClient();

		// Get user's current subscription
		const userRef = userDocRef(user.uid);
		const userSnap = await userRef.get();
		const userData = userSnap.data();

		const currentPlan = userData?.currentPlan;
		if (!currentPlan || currentPlan.planKey === 'free') {
			throw new ApiProblem({
				status: 400,
				code: 'NO_ACTIVE_SUBSCRIPTION',
				message: 'No active subscription to cancel.'
			});
		}

		// Find the active Stripe subscription
		const customer = await getOrCreateStripeCustomer(user.uid, user.email || '');
		const subscriptions = await stripe.subscriptions.list({
			customer: customer.id,
			status: 'active',
			limit: 1
		});

		if (subscriptions.data.length === 0) {
			// No active Stripe subscription, just update local state
			await userRef.set(
				{
					currentPlan: {
						...currentPlan,
						status: 'canceled',
						canceledAt: Date.now()
					},
					updatedAt: Date.now()
				},
				{ merge: true }
			);

			logger.info('No Stripe subscription found, updated local state to canceled');
			return apiOk({
				status: 'canceled',
				message: 'Subscription canceled.'
			});
		}

		const subscription = subscriptions.data[0];
		const now = Date.now();

		if (immediate) {
			// Immediate cancellation
			const canceled = await stripe.subscriptions.cancel(subscription.id, {
				cancellation_details: {
					comment: 'User requested immediate cancellation'
				}
			});

			// Update local state
			await firestore.runTransaction(async (tx) => {
				const subRef = subscriptionDocRef(user.uid, subscription.id);
				tx.update(subRef, {
					status: 'canceled',
					canceledAt: now,
					updatedAt: now
				});

				tx.update(userRef, {
					currentPlan: {
						planKey: 'free',
						status: 'active',
						refreshDate: getFirstOfNextMonth()
					},
					updatedAt: now
				});
			});

			logger.info('Subscription canceled immediately', { subscriptionId: subscription.id });
			return apiOk({
				status: 'canceled',
				canceledAt: now,
				message: 'Subscription canceled. You have been moved to the free plan.'
			});
		} else {
			// Cancel at period end (preferred)
			const updated = await stripe.subscriptions.update(subscription.id, {
				cancel_at_period_end: true,
				cancellation_details: {
					comment: 'User scheduled cancellation at period end'
				}
			});

			const periodEnd = (updated as any).current_period_end as number;
			const cancelAt = periodEnd * 1000; // Convert to ms

			// Update local state
			await firestore.runTransaction(async (tx) => {
				const subRef = subscriptionDocRef(user.uid, subscription.id);
				tx.update(subRef, {
					cancelAtPeriodEnd: true,
					cancelAt: cancelAt,
					updatedAt: now
				});

				tx.update(userRef, {
					currentPlan: {
						...currentPlan,
						cancelAtPeriodEnd: true,
						cancelAt: cancelAt
					},
					updatedAt: now
				});
			});

			logger.info('Subscription scheduled for cancellation at period end', {
				subscriptionId: subscription.id,
				cancelAt: new Date(cancelAt).toISOString()
			});

			return apiOk({
				status: 'scheduled',
				cancelAt,
				message: `Your subscription will be canceled on ${new Date(cancelAt).toLocaleDateString()}. You can continue using your plan until then.`
			});
		}
	} catch (error) {
		if (error instanceof ApiProblem) {
			throw error;
		}
		logger.error('Failed to cancel subscription', { error });
		throw new ApiProblem({
			status: 500,
			code: 'CANCEL_FAILED',
			message: 'Unable to cancel subscription. Please try again.',
			cause: error
		});
	}
}, { component: 'billing' });

/**
 * Reactivate a subscription that was scheduled for cancellation
 */
export const DELETE = handleApiRoute(async (event) => {
	const user = requireUser(event);
	assertSameOrigin(event);

	const logger = event.locals.logger.child({ component: 'billing', action: 'reactivate_subscription' });

	try {
		const stripe = getStripeClient();

		// Get user's current subscription
		const userRef = userDocRef(user.uid);
		const userSnap = await userRef.get();
		const userData = userSnap.data();

		const currentPlan = userData?.currentPlan;
		if (!currentPlan?.cancelAtPeriodEnd) {
			throw new ApiProblem({
				status: 400,
				code: 'NOT_SCHEDULED_FOR_CANCELLATION',
				message: 'Subscription is not scheduled for cancellation.'
			});
		}

		// Find the subscription in Stripe
		const customer = await getOrCreateStripeCustomer(user.uid, user.email || '');
		const subscriptions = await stripe.subscriptions.list({
			customer: customer.id,
			limit: 1
		});

		if (subscriptions.data.length === 0) {
			throw new ApiProblem({
				status: 400,
				code: 'NO_SUBSCRIPTION_FOUND',
				message: 'No subscription found to reactivate.'
			});
		}

		const subscription = subscriptions.data[0];
		const now = Date.now();

		// Reactivate subscription
		await stripe.subscriptions.update(subscription.id, {
			cancel_at_period_end: false
		});

		// Update local state
		await firestore.runTransaction(async (tx) => {
			const subRef = subscriptionDocRef(user.uid, subscription.id);
			tx.update(subRef, {
				cancelAtPeriodEnd: false,
				cancelAt: null,
				updatedAt: now
			});

			tx.update(userRef, {
				currentPlan: {
					...currentPlan,
					cancelAtPeriodEnd: false,
					cancelAt: null
				},
				updatedAt: now
			});
		});

		logger.info('Subscription reactivated', { subscriptionId: subscription.id });
		return apiOk({
			status: 'reactivated',
			message: 'Your subscription has been reactivated.'
		});
	} catch (error) {
		if (error instanceof ApiProblem) {
			throw error;
		}
		logger.error('Failed to reactivate subscription', { error });
		throw new ApiProblem({
			status: 500,
			code: 'REACTIVATE_FAILED',
			message: 'Unable to reactivate subscription. Please try again.',
			cause: error
		});
	}
}, { component: 'billing' });

function getFirstOfNextMonth(): number {
	const now = new Date();
	const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
	return nextMonth.getTime();
}
