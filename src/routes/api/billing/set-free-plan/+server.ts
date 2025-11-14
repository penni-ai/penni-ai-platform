import { apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/api';
import { userDocRef } from '$lib/server/firestore';
import { buildEntitlements } from '$lib/server/billing-utils';

export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	assertSameOrigin(event);

	const logger = event.locals.logger.child({ component: 'billing', action: 'set_free_plan' });

	try {
		const userRef = userDocRef(user.uid);
		const userSnap = await userRef.get();
		const userData = userSnap.data();

		// Set free plan
		const entitlements = buildEntitlements('free');
		if (!entitlements) {
			throw new Error('Failed to build entitlements for free plan');
		}

		await userRef.set(
			{
				...userData,
				currentPlan: {
					planKey: 'free',
					status: 'active',
					...entitlements
				},
				updatedAt: Date.now()
			},
			{ merge: true }
		);

		logger.info('Free plan set for user');
		return apiOk({ status: 'updated', plan: 'free' });
	} catch (error) {
		logger.error('Failed to set free plan', { error });
		throw new Error('Unable to set free plan. Please try again.');
	}
}, { component: 'billing' });

