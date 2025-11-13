import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { campaignDocRef } from '$lib/server/firestore';
import { serializeCampaignRecord } from '$lib/server/campaigns';

export const load: PageServerLoad = async ({ params, locals }) => {
	const campaignId = params.id;
	if (!campaignId) {
		throw error(400, 'Campaign ID is required');
	}

	const user = locals.user;
	if (!user) {
		throw error(401, 'Unauthorized');
	}

	const doc = await campaignDocRef(user.uid, campaignId).get();
	if (!doc.exists) {
		redirect(302, '/dashboard');
	}

	const campaignData = doc.data() ?? {};
	const campaign = await serializeCampaignRecord(campaignData, doc.id, user.uid);

	return {
		campaign
	};
};

