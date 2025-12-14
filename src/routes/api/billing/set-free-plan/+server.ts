import { apiOk, assertSameOrigin, handleApiRoute, requireUser, ApiProblem } from '$lib/server/core';
import { userDocRef, subscriptionDocRef, firestore } from '$lib/server/core';
import { getRefreshDate, updateUserFeatureCapabilities, getOrCreateStripeCustomer, getStripeClient } from '$lib/server/billing';

/**
 * Downgrade to free plan
 *
 * This endpoint handles downgrading to the free plan. By default, it schedules
 * the downgrade at the end of the current billing period (best practice).
 *
 * Request body:
 *   - immediate?: boolean - If true, cancel immediately (default: false)
 *
 * The user keeps their paid features until the period ends, then transitions to free.
 */
export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	assertSameOrigin(event);

	const logger = event.locals.logger.child({ component: 'billing', action: 'set_free_plan' });

	try {
		const body = await event.request.json().catch(() => ({}));
		const immediate = body.immediate === true;

		const userRef = userDocRef(user.uid);
		const userSnap = await userRef.get();
		const userData = userSnap.data();
		const currentPlan = userData?.currentPlan;
		const now = Date.now();

		// If already on free plan, just confirm
		if (!currentPlan || currentPlan.planKey === 'free') {
			logger.info('User already on free plan');
			return apiOk({ status: 'already_free', plan: 'free' });
		}

		const stripe = getStripeClient();

		// Find active Stripe subscription
		let stripeSubscription = null;
		try {
			const customer = await getOrCreateStripeCustomer(user.uid, user.email || '');
			const subscriptions = await stripe.subscriptions.list({
				customer: customer.id,
				status: 'active',
				limit: 1
			});
			stripeSubscription = subscriptions.data[0] || null;
		} catch (e) {
			logger.warn('Could not fetch Stripe subscription', { error: e });
		}

		if (stripeSubscription) {
			if (immediate) {
				// Immediate cancellation
				await stripe.subscriptions.cancel(stripeSubscription.id, {
					cancellation_details: {
						comment: 'User downgraded to free plan immediately'
					}
				});

				// Update feature capabilities immediately
				await updateUserFeatureCapabilities(user.uid, 'free');

				await firestore.runTransaction(async (tx) => {
					const subRef = subscriptionDocRef(user.uid, stripeSubscription!.id);
					tx.update(subRef, {
						status: 'canceled',
						canceledAt: now,
						updatedAt: now
					});

					tx.set(userRef, {
						currentPlan: {
							planKey: 'free',
							status: 'active',
							refreshDate: getRefreshDate()
						},
						updatedAt: now
					}, { merge: true });
				});

				logger.info('Immediate downgrade to free plan completed', { subscriptionId: stripeSubscription.id });
				return apiOk({
					status: 'updated',
					plan: 'free',
					message: 'You have been moved to the free plan.'
				});
			} else {
				// Schedule cancellation at period end (recommended)
				await stripe.subscriptions.update(stripeSubscription.id, {
					cancel_at_period_end: true,
					cancellation_details: {
						comment: 'User downgraded to free plan at period end'
					}
				});

				const periodEnd = (stripeSubscription as any).current_period_end as number;
				const cancelAt = periodEnd * 1000;

				await firestore.runTransaction(async (tx) => {
					const subRef = subscriptionDocRef(user.uid, stripeSubscription!.id);
					tx.update(subRef, {
						cancelAtPeriodEnd: true,
						cancelAt: cancelAt,
						updatedAt: now
					});

					tx.set(userRef, {
						currentPlan: {
							...currentPlan,
							cancelAtPeriodEnd: true,
							cancelAt: cancelAt,
							downgradeTo: 'free'
						},
						updatedAt: now
					}, { merge: true });
				});

				logger.info('Downgrade to free plan scheduled at period end', {
					subscriptionId: stripeSubscription.id,
					cancelAt: new Date(cancelAt).toISOString()
				});

				return apiOk({
					status: 'scheduled',
					plan: 'free',
					cancelAt,
					message: `Your plan will change to Free on ${new Date(cancelAt).toLocaleDateString()}. You can continue using your current plan until then.`
				});
			}
		}

		// No Stripe subscription found, just update local state
		await updateUserFeatureCapabilities(user.uid, 'free');

		await userRef.set(
			{
				currentPlan: {
					planKey: 'free',
					status: 'active',
					refreshDate: getRefreshDate()
				},
				updatedAt: now
			},
			{ merge: true }
		);

		logger.info('Free plan set for user (no Stripe subscription)');
		return apiOk({ status: 'updated', plan: 'free' });
	} catch (error) {
		if (error instanceof ApiProblem) {
			throw error;
		}
		logger.error('Failed to set free plan', { error });
		throw new ApiProblem({
			status: 500,
			code: 'DOWNGRADE_FAILED',
			message: 'Unable to downgrade to free plan. Please try again.',
			cause: error
		});
	}
}, { component: 'billing' });

