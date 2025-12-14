/**
 * Feature capabilities utilities
 * 
 * Provides functions to check and manage user feature capabilities
 * based on their subscription plan.
 */

import { userDocRef, type UserUsage } from '../core';
import { buildFeatureCapabilities, getRefreshDate, type FeatureCapabilities } from './billing-utils';
import type { PlanKey } from './stripe';
import { PLAN_LIMITS } from '$lib/billing/plans';

/**
 * Get user's feature capabilities from Firestore
 * Returns null if user document doesn't exist or capabilities aren't set
 */
function normalizeFreeCapabilities(cap: FeatureCapabilities): FeatureCapabilities {
	if (cap.planKey !== 'free') return cap;
	// Enforce free plan limits from centralized source
	return {
		...cap,
		outreach: true,
		connectedInboxes: Math.max(cap.connectedInboxes, PLAN_LIMITS.free.connectedInboxes),
		influencerSearchResults: PLAN_LIMITS.free.influencerProfiles,
		monthlyOutreachEmails: PLAN_LIMITS.free.outreachEmails
	};
}

export async function getUserFeatureCapabilities(uid: string): Promise<FeatureCapabilities | null> {
	const userDoc = await userDocRef(uid).get();
	const userData = userDoc.data();
	
	if (!userData) {
		return null;
	}
	
	// Check if feature_capabilities exists
	if (userData.feature_capabilities) {
		const cap = userData.feature_capabilities as FeatureCapabilities;
		return normalizeFreeCapabilities(cap);
	}
	
	// Fallback: build from current plan if available
	const planKey = (userData.currentPlan as { planKey?: PlanKey | null } | undefined)?.planKey ?? null;
	return normalizeFreeCapabilities(buildFeatureCapabilities(planKey));
}

/**
 * Update user's feature capabilities based on their plan
 * This should be called whenever a subscription changes
 */
export async function updateUserFeatureCapabilities(uid: string, planKey: PlanKey | null): Promise<void> {
	const capabilities = buildFeatureCapabilities(planKey);
	const userRef = userDocRef(uid);
	
	await userRef.set(
		{
			feature_capabilities: capabilities,
			updatedAt: Date.now()
		},
		{ merge: true }
	);
}

/**
 * Initialize usage tracking in user document for a new user
 * Sets both outreach and search usage to 0 for the current month
 */
function buildInitialUsage(): UserUsage {
	// Get current month key
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const currentMonth = `${year}-${month}`;
	const timestamp = Date.now();
	
	return {
		outreachSent: {
			month: currentMonth,
			count: 0,
			updatedAt: timestamp
		},
		influencersFound: {
			month: currentMonth,
			count: 0,
			updatedAt: timestamp
		}
	};
}

/**
 * Ensure user has both currentPlan and feature_capabilities set
 * If either is missing, initialize with free plan
 * This should be called on first sign-in or when plan details are missing
 */
export async function ensureFeatureCapabilities(uid: string): Promise<void> {
	const userDoc = await userDocRef(uid).get();
	const userData = userDoc.data();
	
	// Check if user has a current plan
	const existingPlanKey = (userData?.currentPlan as { planKey?: PlanKey | null } | undefined)?.planKey;
	const planKey: PlanKey = existingPlanKey ?? 'free';
	
	// Determine if we need to update
	const needsPlanUpdate = !userData || !userData.currentPlan;
	const needsCapabilitiesUpdate = !userData || !userData.feature_capabilities;
	const needsUsageUpdate = !userData || !userData.usage;
	
	if (needsPlanUpdate || needsCapabilitiesUpdate || needsUsageUpdate) {
		const userRef = userDocRef(uid);
		const now = Date.now();
		
		const update: Record<string, unknown> = {
			updatedAt: now
		};
		
		// Set currentPlan if missing (billing info only, no entitlements)
		if (needsPlanUpdate) {
			update.currentPlan = {
				planKey,
				status: 'active',
				refreshDate: getRefreshDate()
			};
		}
		
		// Set feature_capabilities if missing
		if (needsCapabilitiesUpdate) {
			update.feature_capabilities = normalizeFreeCapabilities(buildFeatureCapabilities(planKey));
		}
		
		// Set usage if missing
		if (needsUsageUpdate) {
			update.usage = buildInitialUsage();
		}
		
		await userRef.set(update, { merge: true });
	}
}

/**
 * Check if user has a specific feature capability
 */
export async function hasFeatureCapability(
	uid: string,
	feature: keyof Omit<FeatureCapabilities, 'planKey' | 'updatedAt'>
): Promise<boolean> {
	const capabilities = await getUserFeatureCapabilities(uid);
	if (!capabilities) {
		return false;
	}
	
	const value = capabilities[feature];
	return typeof value === 'boolean' ? value : value > 0;
}

/**
 * Check if user can use outreach feature
 */
export async function canUseOutreach(uid: string): Promise<boolean> {
	return hasFeatureCapability(uid, 'outreach');
}

/**
 * Check if user can export to CSV
 */
export async function canExportCSV(uid: string): Promise<boolean> {
	return hasFeatureCapability(uid, 'csvExport');
}

/**
 * Get user's feature limits
 */
export async function getFeatureLimits(uid: string): Promise<{
	influencerSearchResults: number;
	monthlyOutreachEmails: number;
	connectedInboxes: number;
} | null> {
	const capabilities = await getUserFeatureCapabilities(uid);
	if (!capabilities) {
		// Return free plan defaults from centralized source
		return {
			influencerSearchResults: PLAN_LIMITS.free.influencerProfiles,
			monthlyOutreachEmails: PLAN_LIMITS.free.outreachEmails,
			connectedInboxes: PLAN_LIMITS.free.connectedInboxes
		};
	}

	return {
		influencerSearchResults: capabilities.influencerSearchResults,
		monthlyOutreachEmails: capabilities.monthlyOutreachEmails,
		connectedInboxes: capabilities.connectedInboxes
	};
}
