import { outreachStateDocRef, outreachContactsCollectionRef, type OutreachState } from '../core/firestore';

/**
 * Clear selections from OutreachState based on OutreachContact records
 * Removes influencers and contact methods that have been contacted (pending or sent status)
 */
export async function clearSelectionsForContacted(
	uid: string,
	campaignId: string,
	influencerIds: string[],
	contactMethods: string[]
): Promise<void> {
	const stateRef = outreachStateDocRef(uid, campaignId);
	const contactsRef = outreachContactsCollectionRef(uid, campaignId);
	
	// Get current state
	const stateDoc = await stateRef.get();
	if (!stateDoc.exists) {
		return; // No state to update
	}
	
	const currentState = stateDoc.data() as OutreachState;
	
	// Get all outreach contacts for this campaign
	const contactsSnapshot = await contactsRef.get();
	const contactedInfluencerIds = new Set<string>();
	const contactedMethodsByInfluencer = new Map<string, Set<string>>();
	
	contactsSnapshot.forEach((doc) => {
		const contact = doc.data();
		// Only count contacts that are pending or sent (not failed or cancelled)
		if (contact.sendStatus === 'pending' || contact.sendStatus === 'sent') {
			if (contact.influencerId) {
				contactedInfluencerIds.add(contact.influencerId);
				
				// Track which methods were used for this influencer
				if (!contactedMethodsByInfluencer.has(contact.influencerId)) {
					contactedMethodsByInfluencer.set(contact.influencerId, new Set());
				}
				
				// Add the platform as a contact method
				if (contact.platform) {
					contactedMethodsByInfluencer.get(contact.influencerId)!.add(contact.platform);
				}
				
				// Also check contactMethods array if it exists
				if (contact.contactMethods && Array.isArray(contact.contactMethods)) {
					contact.contactMethods.forEach((method: string) => {
						contactedMethodsByInfluencer.get(contact.influencerId)!.add(method);
					});
				}
			}
		}
	});
	
	// Filter out contacted influencers from selectedInfluencerIds
	const updatedSelectedInfluencerIds = (currentState.selectedInfluencerIds || []).filter(
		id => !contactedInfluencerIds.has(id)
	);
	
	// Filter out contacted methods from selectedMethods
	const updatedSelectedMethods: Record<string, string[]> = {};
	if (currentState.selectedMethods) {
		Object.entries(currentState.selectedMethods).forEach(([influencerKey, methods]) => {
			// Check if this influencer has been contacted
			if (contactedInfluencerIds.has(influencerKey)) {
				// Remove all methods for contacted influencers
				return;
			}
			
			// Check which methods have been used for this influencer
			const usedMethods = contactedMethodsByInfluencer.get(influencerKey) || new Set();
			const remainingMethods = (methods || []).filter(
				method => !usedMethods.has(method)
			);
			
			// Only keep if there are remaining methods
			if (remainingMethods.length > 0) {
				updatedSelectedMethods[influencerKey] = remainingMethods;
			}
		});
	}
	
	// Update state if changes were made
	if (
		updatedSelectedInfluencerIds.length !== (currentState.selectedInfluencerIds || []).length ||
		Object.keys(updatedSelectedMethods).length !== Object.keys(currentState.selectedMethods || {}).length
	) {
		await stateRef.set({
			...currentState,
			selectedInfluencerIds: updatedSelectedInfluencerIds,
			selectedMethods: updatedSelectedMethods,
			updatedAt: Date.now()
		}, { merge: true });
	}
}

/**
 * Clear specific influencer selections after outreach is sent
 * Removes influencers from selectedInfluencerIds and removes specific methods from selectedMethods
 */
export async function clearSelectionsAfterSend(
	uid: string,
	campaignId: string,
	influencerIds: string[],
	methodsToRemove: Record<string, string[]> // influencerKey -> methods to remove
): Promise<void> {
	const stateRef = outreachStateDocRef(uid, campaignId);
	const stateDoc = await stateRef.get();
	
	if (!stateDoc.exists) {
		return; // No state to update
	}
	
	const currentState = stateDoc.data() as OutreachState;
	
	// Remove influencer IDs from selectedInfluencerIds
	const updatedSelectedInfluencerIds = (currentState.selectedInfluencerIds || []).filter(
		id => !influencerIds.includes(id)
	);
	
	// Remove methods from selectedMethods
	const updatedSelectedMethods: Record<string, string[]> = {};
	if (currentState.selectedMethods) {
		Object.entries(currentState.selectedMethods).forEach(([influencerKey, methods]) => {
			const methodsToRemoveForInfluencer = methodsToRemove[influencerKey] || [];
			const remainingMethods = (methods || []).filter(
				method => !methodsToRemoveForInfluencer.includes(method)
			);
			
			// Only keep if there are remaining methods
			if (remainingMethods.length > 0) {
				updatedSelectedMethods[influencerKey] = remainingMethods;
			}
		});
	}
	
	// Update state
	await stateRef.set({
		...currentState,
		selectedInfluencerIds: updatedSelectedInfluencerIds,
		selectedMethods: updatedSelectedMethods,
		updatedAt: Date.now()
	}, { merge: true });
}

