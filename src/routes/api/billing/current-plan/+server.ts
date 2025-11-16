import { apiOk, handleApiRoute, requireUser } from '$lib/server/core';
import { userDocRef } from '$lib/server/core';
import type { UserStripeState } from '$lib/server/core';

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	
	const userSnap = await userDocRef(user.uid).get();
	const userData = userSnap.data() as UserStripeState | undefined;
	const currentPlan = userData?.currentPlan;
	const planKey = currentPlan?.planKey ?? null;
	
	return apiOk({ planKey });
}, { component: 'billing' });

