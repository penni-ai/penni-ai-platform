import { redirect } from '@sveltejs/kit';
import { serializeCampaignSnapshot, type SerializedCampaign } from '$lib/server/campaigns';
import { userDocRef } from '$lib/server/core';
import type { LayoutServerLoad } from './$types';
import type { UserStripeState } from '$lib/server/core';

const SIDEBAR_CAMPAIGN_LIMIT = 25;

function sortCampaignsByRecency(campaigns: SerializedCampaign[]) {
	return campaigns.sort((a, b) => {
		const aTime = a.updatedAt ?? a.createdAt ?? 0;
		const bTime = b.updatedAt ?? b.createdAt ?? 0;
		return bTime - aTime;
	});
}

export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) {
		throw redirect(303, '/sign-in');
	}

	let campaigns: SerializedCampaign[] = [];

	try {
		// Use updatedAt for ordering (always present in new structure)
		const snapshot = await userDocRef(user.uid)
			.collection('campaigns')
			.orderBy('updatedAt', 'desc')
			.limit(SIDEBAR_CAMPAIGN_LIMIT)
			.get();

		campaigns = await Promise.all(
			snapshot.docs.map((doc) => serializeCampaignSnapshot(doc, user.uid))
		);
		campaigns = sortCampaignsByRecency(campaigns);
	} catch (error) {
		locals.logger?.warn('Failed to load sidebar campaigns', { error });
	}

	// Get user's current plan
	let currentPlan = null;
	try {
		const userSnap = await userDocRef(user.uid).get();
		const userData = userSnap.data() as UserStripeState | undefined;
		currentPlan = userData?.currentPlan ?? null;
	} catch (error) {
		locals.logger?.warn('Failed to load user plan', { error });
	}

	return {
		user: {
			uid: user.uid,
			email: user.email ?? null,
			currentPlan
		},
		campaigns
	};
};
