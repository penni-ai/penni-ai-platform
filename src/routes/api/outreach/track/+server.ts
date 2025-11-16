import { ApiProblem, apiOk, handleApiRoute, requireUser } from '$lib/server/core';
import { incrementOutreachUsage } from '$lib/server/usage';
import { outreachContactsCollectionRef } from '$lib/server/core/firestore';
import type { OutreachContact } from '$lib/server/core/firestore';
import { clearSelectionsAfterSend } from '$lib/server/outreach/clear-selections';

/**
 * Track outreach messages sent via Instagram/TikTok
 * This endpoint increments the user's outreach usage count when they click
 * "Send Instagram Messages" or "Send TikTok Messages" buttons
 * Also creates OutreachContact records and clears selections
 */
export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	
	let body: {
		platform: 'instagram' | 'tiktok';
		count: number; // Number of messages being sent
		campaignId?: string; // Optional campaign ID for tracking
		influencers?: Array<{
			influencerId: string;
			name?: string;
			profileUrl?: string;
		}>; // Optional: List of influencers being contacted
	};
	
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
	
	if (!body.platform || (body.platform !== 'instagram' && body.platform !== 'tiktok')) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_PLATFORM',
			message: 'Platform must be "instagram" or "tiktok".'
		});
	}
	
	if (typeof body.count !== 'number' || body.count < 1) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_COUNT',
			message: 'Count must be a positive number.'
		});
	}
	
	// Increment outreach usage
	await incrementOutreachUsage(user.uid, body.count);
	
	// Create OutreachContact records if campaignId and influencers are provided
	const contactedInfluencerIds: string[] = [];
	const methodsToRemove: Record<string, string[]> = {};
	
	if (body.campaignId && body.influencers && body.influencers.length > 0) {
		const contactsRef = outreachContactsCollectionRef(user.uid, body.campaignId);
		const now = Date.now();
		
		for (const influencer of body.influencers) {
			if (!influencer.influencerId) continue;
			
			try {
				// Create contact record for Instagram/TikTok outreach
				// Since we can't verify actual send, mark as 'pending'
				const contact: OutreachContact = {
					platform: body.platform,
					destination: influencer.profileUrl || '', // Profile URL as destination
					message: '', // No message content for Instagram/TikTok (user sends manually)
					sendStatus: 'pending', // Mark as pending since we can't verify actual send
					createdAt: now,
					updatedAt: now,
					influencerId: influencer.influencerId,
					influencerName: influencer.name || null,
					contactMethods: [body.platform] // Track that this platform method was used
				};
				
				// Use influencerId as document ID, sanitize it
				let contactId = influencer.influencerId;
				if (!contactId || contactId.trim() === '') {
					contactId = `contact_${now}_${Math.random().toString(36).substring(2, 9)}`;
				} else {
					contactId = contactId.replace(/[/\\]/g, '_').replace(/[^a-zA-Z0-9_-]/g, '_');
				}
				
				// Ensure contactId is never empty
				if (!contactId || contactId.trim() === '') {
					contactId = `contact_${now}_${Math.random().toString(36).substring(2, 9)}`;
				}
				
				await contactsRef.doc(contactId).set(contact, { merge: true });
				
				// Track for clearing selections
				const influencerKey = influencer.influencerId;
				if (!contactedInfluencerIds.includes(influencerKey)) {
					contactedInfluencerIds.push(influencerKey);
				}
				if (!methodsToRemove[influencerKey]) {
					methodsToRemove[influencerKey] = [];
				}
				if (!methodsToRemove[influencerKey].includes(body.platform)) {
					methodsToRemove[influencerKey].push(body.platform);
				}
			} catch (error) {
				// Log but don't fail the request if contact tracking fails
				console.error('Failed to save outreach contact:', error);
			}
		}
		
		// Clear selections for contacted influencers
		if (contactedInfluencerIds.length > 0) {
			try {
				await clearSelectionsAfterSend(user.uid, body.campaignId, contactedInfluencerIds, methodsToRemove);
			} catch (error) {
				// Log but don't fail the request if clearing selections fails
				console.error('Failed to clear selections after track:', error);
			}
		}
	}
	
	return apiOk({
		success: true,
		platform: body.platform,
		count: body.count
	});
}, { component: 'outreach' });

