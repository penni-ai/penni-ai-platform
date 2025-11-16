import { ApiProblem, apiOk, handleApiRoute, requireUser } from '$lib/server/core';
import { outreachStateDocRef } from '$lib/server/core/firestore';
import type { OutreachState } from '$lib/server/core/firestore';

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const campaignId = event.params.campaignId;
	
	if (!campaignId) {
		throw new ApiProblem({
			status: 400,
			code: 'CAMPAIGN_ID_REQUIRED',
			message: 'Campaign ID is required.'
		});
	}
	
	try {
		const stateDoc = await outreachStateDocRef(user.uid, campaignId).get();
		
		if (!stateDoc.exists) {
			return apiOk({ state: null });
		}
		
		const state = stateDoc.data() as OutreachState;
		
		// Verify the state belongs to this campaign
		if (state.campaignId !== campaignId) {
			return apiOk({ state: null });
		}
		
		return apiOk({ state });
	} catch (error) {
		throw new ApiProblem({
			status: 500,
			code: 'STATE_FETCH_FAILED',
			message: 'Failed to fetch outreach state.',
			cause: error
		});
	}
}, { component: 'outreach-state' });

export const PUT = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const campaignId = event.params.campaignId;
	
	if (!campaignId) {
		throw new ApiProblem({
			status: 400,
			code: 'CAMPAIGN_ID_REQUIRED',
			message: 'Campaign ID is required.'
		});
	}
	
	let body: Partial<OutreachState>;
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
	
	// Partial update is allowed - only validate fields that are provided
	// If updating selectedInfluencerIds only, other fields are optional
	const isPartialUpdate = body.selectedInfluencerIds !== undefined && 
		(body.currentStage === undefined || body.selectedMethods === undefined || body.messageContents === undefined);
	
	if (!isPartialUpdate) {
		// Full update requires all fields
		if (!body.currentStage || !body.selectedMethods || !body.messageContents) {
			throw new ApiProblem({
				status: 400,
				code: 'INVALID_STATE',
				message: 'Missing required fields: currentStage, selectedMethods, or messageContents.'
			});
		}
	}
	
	try {
		const stateRef = outreachStateDocRef(user.uid, campaignId);
		const existingDoc = await stateRef.get();
		const existingState = existingDoc.exists ? (existingDoc.data() as OutreachState) : null;
		
		const now = Date.now();
		
		// Merge with existing state for partial updates
		const state: OutreachState = {
			campaignId,
			currentStage: body.currentStage ?? existingState?.currentStage ?? 'select-methods',
			editingPlatform: body.editingPlatform !== undefined ? body.editingPlatform : (existingState?.editingPlatform ?? null),
			selectedInfluencerIds: body.selectedInfluencerIds ?? existingState?.selectedInfluencerIds ?? [],
			selectedMethods: body.selectedMethods ?? existingState?.selectedMethods ?? {},
			messageContents: body.messageContents ?? existingState?.messageContents ?? {
				email: '',
				instagram: '',
				tiktok: ''
			},
			selectedGmailConnectionId: body.selectedGmailConnectionId !== undefined 
				? body.selectedGmailConnectionId 
				: (existingState?.selectedGmailConnectionId ?? null),
			updatedAt: now,
			createdAt: existingState?.createdAt ?? now,
			version: 1
		};
		
		await stateRef.set(state);
		
		return apiOk({ success: true, updatedAt: now });
	} catch (error) {
		throw new ApiProblem({
			status: 500,
			code: 'STATE_SAVE_FAILED',
			message: 'Failed to save outreach state.',
			cause: error
		});
	}
}, { component: 'outreach-state' });

export const DELETE = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const campaignId = event.params.campaignId;
	
	if (!campaignId) {
		throw new ApiProblem({
			status: 400,
			code: 'CAMPAIGN_ID_REQUIRED',
			message: 'Campaign ID is required.'
		});
	}
	
	try {
		await outreachStateDocRef(user.uid, campaignId).delete();
		return apiOk({ success: true });
	} catch (error) {
		throw new ApiProblem({
			status: 500,
			code: 'STATE_DELETE_FAILED',
			message: 'Failed to delete outreach state.',
			cause: error
		});
	}
}, { component: 'outreach-state' });

