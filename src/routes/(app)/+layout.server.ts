import { redirect } from '@sveltejs/kit';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { serializeCampaignSnapshot, type SerializedCampaign } from '$lib/server/campaigns';
import { userDocRef } from '$lib/server/core';
import type { LayoutServerLoad } from './$types';
import type { UserStripeState } from '$lib/server/core';
import { getUserFeatureCapabilities } from '$lib/server/billing/feature-capabilities';

const SIDEBAR_CAMPAIGN_LIMIT = 25;
const LAYOUT_LOAD_TIMEOUT_MS = 5000; // 5 second timeout for layout data

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout>;
	const timeoutPromise = new Promise<T>((resolve) => {
		timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
	});
	try {
		const result = await Promise.race([promise, timeoutPromise]);
		clearTimeout(timeoutId!);
		return result;
	} catch (error) {
		clearTimeout(timeoutId!);
		throw error;
	}
}

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
		// Fetch campaigns with timeout to prevent hanging page loads
		const snapshot = await withTimeout(
			userDocRef(user.uid)
				.collection('campaigns')
				.limit(SIDEBAR_CAMPAIGN_LIMIT)
				.get(),
			LAYOUT_LOAD_TIMEOUT_MS,
			{ docs: [] } as any
		);

		// Don't pass uid to skip extra Firestore reads for collected data
		// Sidebar only needs basic campaign fields from the document itself
		// This prevents 25+ extra reads that could hang the page load
		if (snapshot.docs.length > 0) {
			campaigns = await Promise.all(
				snapshot.docs.map((doc: QueryDocumentSnapshot) => serializeCampaignSnapshot(doc))
			);
			campaigns = sortCampaignsByRecency(campaigns);
		}
	} catch (error) {
		locals.logger?.warn('Failed to load sidebar campaigns', { error });
	}

	// Get user's current plan, feature capabilities, and onboarding status
	let currentPlan = null;
	let capabilities = null;
	let onboardingCompleted = false;
	try {
		// Fetch user data with timeout
		const userSnap = await withTimeout(
			userDocRef(user.uid).get(),
			LAYOUT_LOAD_TIMEOUT_MS,
			null as any
		);
		if (userSnap) {
			const userData = userSnap.data() as UserStripeState | undefined;
			currentPlan = userData?.currentPlan ?? null;
			onboardingCompleted = (userData as any)?.onboarding?.tutorialCompleted ?? (userData as any)?.onboarding?.tutorialSkipped ?? false;
		}

		// Fetch feature capabilities with timeout
		capabilities = await withTimeout(
			getUserFeatureCapabilities(user.uid),
			LAYOUT_LOAD_TIMEOUT_MS,
			null
		);
	} catch (error) {
		locals.logger?.warn('Failed to load user plan and capabilities', { error });
	}

	return {
		user: {
			uid: user.uid,
			email: user.email ?? null,
			currentPlan,
			capabilities
		},
		campaigns,
		onboardingCompleted
	};
};
