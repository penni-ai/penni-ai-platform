import { ApiProblem, apiOk, handleApiRoute, requireUser } from '$lib/server/core';
import { serializeCampaignRecord } from '$lib/server/campaigns';
import { campaignDocRef, chatCollectedDocRef, serverTimestamp } from '$lib/server/core';

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

export const PUT = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const campaignId = event.params.id;
	if (!campaignId) {
		throw new ApiProblem({
			status: 400,
			code: 'CAMPAIGN_ID_REQUIRED',
			message: 'Campaign ID is required.'
		});
	}

	let body: Record<string, unknown>;
	try {
		body = await event.request.json();
	} catch (error) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_JSON',
			message: 'Request body must be valid JSON.',
			cause: error
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

	// Update campaign document fields
	const updateData: Record<string, unknown> = {
		updatedAt: serverTimestamp()
	};

	// Allow updating these fields
	const allowedFields = [
		'title',
		'website',
		'business_name',
		'business_location',
		'businessSummary',
		'locations',
		'type_of_influencer',
		'platform',
		'followersMin',
		'followersMax'
	];

	for (const field of allowedFields) {
		if (field in body) {
			updateData[field] = body[field];
		}
	}

	// Also update the collected data subcollection if it exists
	const collectedRef = chatCollectedDocRef(user.uid, campaignId);
	const collectedDoc = await collectedRef.get();
	
	if (collectedDoc.exists) {
		const collectedUpdate: Record<string, unknown> = {
			updatedAt: Date.now()
		};

		// Map field names to collected data structure
		if ('website' in body) collectedUpdate.website = body.website;
		if ('business_name' in body) collectedUpdate.business_name = body.business_name;
		if ('business_location' in body) collectedUpdate.business_location = body.business_location;
		if ('businessSummary' in body) collectedUpdate.business_about = body.businessSummary;
		if ('locations' in body) collectedUpdate.influencer_location = body.locations;
		if ('type_of_influencer' in body) collectedUpdate.type_of_influencer = body.type_of_influencer;
		if ('platform' in body) collectedUpdate.platform = body.platform;
		if ('followersMin' in body) collectedUpdate.min_followers = body.followersMin;
		if ('followersMax' in body) collectedUpdate.max_followers = body.followersMax;

		await collectedRef.set(collectedUpdate, { merge: true });
	}

	await docRef.set(updateData, { merge: true });

	// Return updated campaign
	const updatedDoc = await docRef.get();
	const updatedData = updatedDoc.data() ?? {};
	return apiOk(await serializeCampaignRecord(updatedData, updatedDoc.id, user.uid));
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
