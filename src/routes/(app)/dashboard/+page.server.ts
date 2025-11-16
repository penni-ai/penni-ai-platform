import type { PageServerLoad } from './$types';
import type { LayoutData } from '../$types';
import { userDocRef, outreachContactsCollectionRef, firestore } from '$lib/server/core';
import type { UserStripeState } from '$lib/server/core';

const PIPELINE_COLLECTION = 'pipeline_jobs';

interface CampaignStats {
	outreachSent: number;
	influencersFound: number;
}

async function getCampaignStats(uid: string, campaignId: string, pipelineId: string | null): Promise<CampaignStats> {
	const stats: CampaignStats = {
		outreachSent: 0,
		influencersFound: 0
	};

	try {
		// Get outreach count (contacts with status 'sent' or 'pending')
		const contactsRef = outreachContactsCollectionRef(uid, campaignId);
		const contactsSnapshot = await contactsRef.get();
		
		contactsSnapshot.forEach((doc) => {
			const contact = doc.data();
			if (contact.sendStatus === 'sent' || contact.sendStatus === 'pending') {
				stats.outreachSent++;
			}
		});
	} catch (error) {
		console.error(`Failed to get outreach stats for campaign ${campaignId}:`, error);
	}

	try {
		// Get influencer count from pipeline
		if (pipelineId) {
			const pipelineDoc = await firestore.collection(PIPELINE_COLLECTION).doc(pipelineId).get();
			if (pipelineDoc.exists) {
				const pipelineData = pipelineDoc.data();
				// Use profiles_count if available
				if (typeof pipelineData?.profiles_count === 'number') {
					stats.influencersFound = pipelineData.profiles_count;
				}
				// Note: If profiles are stored in storage, we'd need to load them to get exact count
				// For dashboard performance, we use profiles_count from the pipeline document
			}
		}
	} catch (error) {
		console.error(`Failed to get pipeline stats for campaign ${campaignId}:`, error);
	}

	return stats;
}

export const load: PageServerLoad = async ({ parent, locals }) => {
	// Use campaigns from layout
	const layoutData = await parent() as LayoutData;
	
	// Check subscription status
	const uid = locals.user?.uid ?? null;
	let hasSubscription = false;
	
	if (uid) {
		try {
			const userSnap = await userDocRef(uid).get();
			const userData = userSnap.data() as UserStripeState | undefined;
			const currentPlan = userData?.currentPlan;
			
			// Check if user has an active subscription
			if (currentPlan?.planKey && currentPlan.status !== 'canceled') {
				hasSubscription = true;
			}
			
			// Also check subscriptions collection
			if (!hasSubscription) {
				const subsSnap = await userDocRef(uid)
					.collection('subscriptions')
					.orderBy('updatedAt', 'desc')
					.limit(1)
					.get();
				
				const subscriptionData = subsSnap.docs[0]?.data();
				if (subscriptionData?.status && subscriptionData.status !== 'canceled') {
					hasSubscription = true;
				}
			}
		} catch (error) {
			locals.logger?.warn('Failed to check subscription status', { error });
		}
	}

	// Fetch statistics for each campaign
	const campaigns = layoutData.campaigns ?? [];
	const campaignsWithStats = await Promise.all(
		campaigns.map(async (campaign) => {
			if (!campaign.id || !uid) {
				return { ...campaign, stats: { outreachSent: 0, influencersFound: 0 } };
			}
			
			const stats = await getCampaignStats(uid, campaign.id, campaign.pipeline_id ?? null);
			return { ...campaign, stats };
		})
	);
	
	return {
		campaigns: campaignsWithStats,
		hasSubscription
	};
};

