import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, params, fetch }) => {
	await parent();
	const res = await fetch(`/api/campaigns/${params.id}`);
	if (!res.ok) {
		return {
			campaign: null,
			error: await res.text()
		};
	}

	const campaign = await res.json();
	return {
		campaign
	};
};
