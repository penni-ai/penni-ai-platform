import type { SerializedCampaign } from '$lib/server/campaigns';
import type { PageLoad } from './$types';

type CampaignListResponse = {
	campaigns: SerializedCampaign[];
};

export const load: PageLoad = async ({ fetch }) => {
	try {
		const res = await fetch('/api/campaigns');
		if (!res.ok) {
			const errorPayload = await res.json().catch(() => ({}));
			const message =
				typeof errorPayload?.error?.message === 'string'
					? errorPayload.error.message
					: `Unable to load campaigns (${res.status})`;
			return {
				campaigns: [] as SerializedCampaign[],
				error: message
			};
		}

		const data = (await res.json()) as CampaignListResponse;
		return {
			campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
			error: null
		};
	} catch (error) {
		return {
			campaigns: [] as SerializedCampaign[],
			error: error instanceof Error ? error.message : 'Unable to load campaigns right now.'
		};
	}
};
