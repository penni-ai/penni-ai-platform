import { apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/core';
import { userDocRef } from '$lib/server/core';
import { getRefreshDate, updateUserFeatureCapabilities } from '$lib/server/billing';

export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	assertSameOrigin(event);

	const logger = event.locals.logger.child({ component: 'billing', action: 'set_free_plan' });

	try {
		const userRef = userDocRef(user.uid);
		const userSnap = await userRef.get();
		const userData = userSnap.data();

		// Update feature capabilities (single source of truth for features/limits)
		await updateUserFeatureCapabilities(user.uid, 'free');

		await userRef.set(
			{
				...userData,
				currentPlan: {
					planKey: 'free',
					status: 'active',
					refreshDate: getRefreshDate()
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

