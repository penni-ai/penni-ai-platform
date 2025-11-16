import type { LayoutServerLoad } from './$types';
import { userDocRef } from '$lib/server/core';
import type { UserStripeState } from '$lib/server/core';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	// Mark this load function as dependent on user data
	depends('app:user');
	
	const user = locals.user;
	
	if (!user) {
		return {
			firebaseUser: null,
			profile: null
		};
	}

	// Load profile data for Navbar
	const userSnap = await userDocRef(user.uid).get();
	const userData = userSnap.data() as (UserStripeState & { profile?: { fullName?: string; locale?: string } }) | undefined;

	return {
		firebaseUser: {
			email: user.email ?? null
		},
		profile: userData?.profile
			? {
				full_name: userData.profile.fullName ?? null
			}
			: null
	};
};

