import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	return {
		profile: {
			full_name: 'Avery Demo',
			locale: 'en'
		},
		subscription: {
			type: 'starter',
			status: 'active',
			currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()
		},
		userEmail: 'demo@penny.ai'
	};
};
