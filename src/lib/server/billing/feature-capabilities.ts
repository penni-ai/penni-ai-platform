/**
 * Feature capabilities utilities
 * 
 * Provides functions to check and manage user feature capabilities
 * based on their subscription plan.
 */

import { userDocRef, type UserUsage } from '../core';
import { buildFeatureCapabilities, getRefreshDate, type FeatureCapabilities } from './billing-utils';
import type { PlanKey } from './stripe';

/**
 * Get user's feature capabilities from Firestore
 * Returns null if user document doesn't exist or capabilities aren't set
 */
export async function getUserFeatureCapabilities(uid: string): Promise<FeatureCapabilities | null> {
	const userDoc = await userDocRef(uid).get();
	const userData = userDoc.data();
	
	if (!userData) {
		return null;
	}
	
	// Check if feature_capabilities exists
	if (userData.feature_capabilities) {
		return userData.feature_capabilities as FeatureCapabilities;
	}
	
	// Fallback: build from current plan if available
	const planKey = (userData.currentPlan as { planKey?: PlanKey | null } | undefined)?.planKey ?? null;
	return buildFeatureCapabilities(planKey);
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
			update.feature_capabilities = buildFeatureCapabilities(planKey);
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
	maxActiveCampaigns: number;
	monthlyOutreachEmails: number;
	connectedInboxes: number;
} | null> {
	const capabilities = await getUserFeatureCapabilities(uid);
	if (!capabilities) {
		return null;
	}
	
	return {
		influencerSearchResults: capabilities.influencerSearchResults,
		maxActiveCampaigns: capabilities.maxActiveCampaigns,
		monthlyOutreachEmails: capabilities.monthlyOutreachEmails,
		connectedInboxes: capabilities.connectedInboxes
	};
}

