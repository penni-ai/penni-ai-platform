import { ApiProblem, apiOk, handleApiRoute, requireUser } from '$lib/server/core';
import { outreachContactsCollectionRef } from '$lib/server/core/firestore';

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
		const contactsRef = outreachContactsCollectionRef(user.uid, campaignId);
		const snapshot = await contactsRef.get();
		
		// Collect influencer IDs that have been contacted (pending or sent)
		const contactedInfluencerIds = new Set<string>();
		
		snapshot.forEach((doc) => {
			const contact = doc.data();
			// Only count contacts that are pending or sent (not failed or cancelled)
			if (contact.sendStatus === 'pending' || contact.sendStatus === 'sent') {
				if (contact.influencerId) {
					contactedInfluencerIds.add(contact.influencerId);
				}
			}
		});
		
		return apiOk({
			contactedInfluencerIds: Array.from(contactedInfluencerIds)
		});
	} catch (error) {
		throw new ApiProblem({
			status: 500,
			code: 'CONTACTS_FETCH_FAILED',
			message: 'Failed to fetch contacted influencers.',
			cause: error
		});
	}
}, { component: 'outreach-contacts' });

