import { redirect } from '@sveltejs/kit';
import { serializeCampaignSnapshot, type SerializedCampaign } from '$lib/server/campaigns';
import { userDocRef } from '$lib/server/firestore';
import type { LayoutServerLoad } from './$types';

const SIDEBAR_CAMPAIGN_LIMIT = 25;

function sortCampaignsByRecency(campaigns: SerializedCampaign[]) {
	return campaigns.sort((a, b) => {
		const aTime = a.updatedAt ?? a.createdAt ?? 0;
		const bTime = b.updatedAt ?? b.createdAt ?? 0;
		return bTime - aTime;
	});
}

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(303, '/sign-in');
	}

	let campaigns: SerializedCampaign[] = [];

	try {
		const snapshot = await userDocRef(locals.user.uid)
			.collection('campaigns')
			.orderBy('createdAtMs', 'desc')
			.limit(SIDEBAR_CAMPAIGN_LIMIT)
			.get();

		campaigns = sortCampaignsByRecency(snapshot.docs.map((doc) => serializeCampaignSnapshot(doc)));
	} catch (error) {
		locals.logger?.warn('Failed to load sidebar campaigns', { error });
	}

	return {
		user: {
			uid: locals.user.uid,
			email: locals.user.email ?? null
		},
		campaigns
	};
};
