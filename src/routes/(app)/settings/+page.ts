import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	return {
		subscription: {
			type: 'starter',
			status: 'active',
			currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString()
		},
		usage: [
			{ metric: 'Emails sent', quantity: 92, recorded_at: new Date().toISOString() },
			{ metric: 'Creators invited', quantity: 28, recorded_at: new Date(Date.now() - 86400000).toISOString() }
		]
	};
};
