import { ApiProblem, apiOk, handleApiRoute, requireUser } from '$lib/server/api';
import { serializeCampaignRecord } from '$lib/server/campaigns';
import { campaignDocRef } from '$lib/server/firestore';

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const campaignId = event.params.id;
	if (!campaignId) {
		throw new ApiProblem({
			status: 400,
			code: 'CAMPAIGN_ID_REQUIRED',
			message: 'Campaign ID is required.'
		});
	}

	const doc = await campaignDocRef(user.uid, campaignId).get();
	if (!doc.exists) {
		throw new ApiProblem({
			status: 404,
			code: 'CAMPAIGN_NOT_FOUND',
			message: 'Campaign not found.'
		});
	}

	const campaignData = doc.data() ?? {};
	return apiOk(await serializeCampaignRecord(campaignData, doc.id, user.uid));
}, { component: 'campaigns' });

export const DELETE = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const campaignId = event.params.id;
	if (!campaignId) {
		throw new ApiProblem({
			status: 400,
			code: 'CAMPAIGN_ID_REQUIRED',
			message: 'Campaign ID is required.'
		});
	}

	const docRef = campaignDocRef(user.uid, campaignId);
	const doc = await docRef.get();
	if (!doc.exists) {
		throw new ApiProblem({
			status: 404,
			code: 'CAMPAIGN_NOT_FOUND',
			message: 'Campaign not found.'
		});
	}

	await docRef.delete();

	return apiOk({ success: true });
}, { component: 'campaigns' });
