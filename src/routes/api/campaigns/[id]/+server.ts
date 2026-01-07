import { adminStorage } from '$lib/firebase/admin';
import {
	ApiProblem,
	apiOk,
	assertSameOrigin,
	campaignCollectedDocRef,
	campaignDocRef,
	emailQueueCollectionRef,
	firestore,
	handleApiRoute,
	requireUser,
	serverTimestamp
} from '$lib/server/core';
import { serializeCampaignRecord } from '$lib/server/campaigns';

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
	assertSameOrigin(event);
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
	const collectedRef = campaignCollectedDocRef(user.uid, campaignId);
	const collectedDoc = await collectedRef.get();
	
	if (collectedDoc.exists) {
		const collectedUpdate: Record<string, unknown> = {
			updatedAt: Date.now()
		};

		// Map field names to collected data structure
		if ('website' in body) collectedUpdate.website = body.website;
		if ('business_name' in body) collectedUpdate.business_name = body.business_name;
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
	assertSameOrigin(event);
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

	const logger = event.locals.logger.child({ component: 'campaigns', action: 'delete_campaign', campaignId });

	// Delete any queued email items tied to this campaign (stored outside the campaign subtree).
	let deletedQueueItems = 0;
	while (true) {
		const snapshot = await emailQueueCollectionRef(user.uid)
			.where('campaignId', '==', campaignId)
			.limit(500)
			.get();

		if (snapshot.empty) break;

		const batch = firestore.batch();
		snapshot.docs.forEach((doc) => batch.delete(doc.ref));
		await batch.commit();
		deletedQueueItems += snapshot.size;

		if (snapshot.size < 500) break;
	}

	// Delete pipeline job docs + Storage outputs tied to this campaign.
	const pipelineJobIds: string[] = [];
	while (true) {
		const snapshot = await firestore
			.collection('pipeline_jobs')
			.where('campaign_id', '==', campaignId)
			.limit(500)
			.get();

		if (snapshot.empty) break;

		const owned = snapshot.docs.filter((doc) => {
			const owner = (doc.get('uid') as string | undefined) ?? (doc.get('user_id') as string | undefined) ?? null;
			return owner === user.uid;
		});

		if (owned.length === 0) {
			// This should not happen unless campaign IDs collide across tenants.
			logger.warn('pipeline_jobs_campaign_id_mismatch', { returned: snapshot.size });
			break;
		}

		const batch = firestore.batch();
		owned.forEach((doc) => {
			pipelineJobIds.push(doc.id);
			batch.delete(doc.ref);
		});
		await batch.commit();

		if (snapshot.size < 500) break;
	}

	const resolvedProjectId =
		process.env.GOOGLE_CLOUD_PROJECT ||
		process.env.FIREBASE_PROJECT_ID ||
		(adminStorage.app.options.projectId || 'penni-ai-platform');
	const fallbackBucket = `${resolvedProjectId}.firebasestorage.app`;
	const bucketName =
		process.env.STORAGE_BUCKET ||
		process.env.FIREBASE_STORAGE_BUCKET ||
		adminStorage.app.options.storageBucket ||
		fallbackBucket;

	const bucket = adminStorage.bucket(bucketName);
	let deletedPrefixes = 0;
	for (const jobId of pipelineJobIds) {
		const prefix = `pipeline_jobs/${jobId}/`;
		try {
			if (typeof (bucket as any).deleteFiles !== 'function') {
				logger.warn('pipeline_storage_delete_unsupported', { prefix, bucket: bucket.name });
				break;
			}
			await (bucket as any).deleteFiles({ prefix, force: true });
			deletedPrefixes++;
		} catch (error) {
			logger.warn('pipeline_storage_delete_failed', {
				prefix,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	if (typeof (firestore as any).recursiveDelete === 'function') {
		await (firestore as any).recursiveDelete(docRef);
	} else {
		await docRef.delete();
	}

	logger.info('campaign_deleted', {
		deletedQueueItems,
		pipelineJobsDeleted: pipelineJobIds.length,
		pipelineJobPrefixesDeleted: deletedPrefixes
	});

	return apiOk({ success: true });
}, { component: 'campaigns' });
