import type { PageServerLoad } from './$types';
import { userDocRef } from '$lib/server/firestore';
import type { UserStripeState } from '$lib/server/firestore';

export const load: PageServerLoad = async ({ locals }) => {
	const uid = locals.user?.uid ?? null;

	if (!uid) {
		return {
			currentPlan: null
		};
	}

	const userSnap = await userDocRef(uid).get();
	const userData = userSnap.data() as UserStripeState | undefined;

	return {
		currentPlan: userData?.currentPlan ?? null
	};
};
