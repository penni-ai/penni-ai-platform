import type { PageServerLoad } from './$types';
import type { LayoutData } from '../$types';
import { userDocRef } from '$lib/server/firestore';
import type { UserStripeState } from '$lib/server/firestore';

export const load: PageServerLoad = async ({ parent, locals }) => {
	// Use campaigns from layout
	const layoutData = await parent() as LayoutData;
	
	// Check subscription status
	const uid = locals.user?.uid ?? null;
	let hasSubscription = false;
	
	if (uid) {
		try {
			const userSnap = await userDocRef(uid).get();
			const userData = userSnap.data() as UserStripeState | undefined;
			const currentPlan = userData?.currentPlan;
			
			// Check if user has an active subscription
			if (currentPlan?.planKey && currentPlan.status !== 'canceled') {
				hasSubscription = true;
			}
			
			// Also check subscriptions collection
			if (!hasSubscription) {
				const subsSnap = await userDocRef(uid)
					.collection('subscriptions')
					.orderBy('updatedAt', 'desc')
					.limit(1)
					.get();
				
				const subscriptionData = subsSnap.docs[0]?.data();
				if (subscriptionData?.status && subscriptionData.status !== 'canceled') {
					hasSubscription = true;
				}
			}
		} catch (error) {
			locals.logger?.warn('Failed to check subscription status', { error });
		}
	}
	
	return {
		campaigns: layoutData.campaigns ?? [],
		hasSubscription
	};
};

