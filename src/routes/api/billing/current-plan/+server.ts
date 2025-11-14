import { apiOk, handleApiRoute, requireUser } from '$lib/server/api';
import { userDocRef } from '$lib/server/firestore';
import type { UserStripeState } from '$lib/server/firestore';

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	
	const userSnap = await userDocRef(user.uid).get();
	const userData = userSnap.data() as UserStripeState | undefined;
	const currentPlan = userData?.currentPlan;
	const planKey = currentPlan?.planKey ?? null;
	
	return apiOk({ planKey });
}, { component: 'billing' });

