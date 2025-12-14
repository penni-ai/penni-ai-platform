import type { PlanKey } from './stripe';
import { PLAN_LIMITS } from '$lib/billing/plans';

export interface PlanEntitlements {
	maxProfiles: number;
	connectedInboxes: number;
	monthlyOutreachEmails: number;
	csvExportEnabled: boolean;
}

/**
 * Get the refresh date (first day of next month) as a timestamp
 * This is when monthly limits reset
 */
export function getRefreshDate(): number {
	const now = new Date();
	const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
	return nextMonth.getTime();
}

/**
 * Feature capabilities structure stored in user document
 * This represents what features the user can access based on their subscription
 */
export interface FeatureCapabilities {
	// Core feature flags
	outreach: boolean; // Can send outreach emails
	search: boolean; // Can search for influencers
	csvExport: boolean; // Can export data to CSV
	
	// Limits and quotas
	connectedInboxes: number; // Max number of connected Gmail inboxes
	influencerSearchResults: number; // Max influencer search results per search
	monthlyOutreachEmails: number; // Max outreach emails per month
	
	// Plan metadata
	planKey: PlanKey | null;
	updatedAt: number;
}

/**
 * Build feature capabilities from plan key
 * This determines what features a user can access based on their subscription tier
 */
export function buildFeatureCapabilities(planKey: PlanKey | null | undefined): FeatureCapabilities {
	const now = Date.now();
	const key = planKey ?? 'free';
	const limits = PLAN_LIMITS[key as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.free;

	return {
		outreach: true,
		search: true,
		csvExport: limits.csvExport,
		connectedInboxes: limits.connectedInboxes,
		influencerSearchResults: limits.influencerProfiles,
		monthlyOutreachEmails: limits.outreachEmails,
		planKey: key === 'event' ? 'event' : key as PlanKey,
		updatedAt: now
	};
}

export function buildEntitlements(planKey: PlanKey | null | undefined): PlanEntitlements | undefined {
	if (!planKey) return undefined;
	const limits = PLAN_LIMITS[planKey as keyof typeof PLAN_LIMITS];
	if (!limits) return undefined;

	return {
		maxProfiles: limits.influencerProfiles,
		connectedInboxes: limits.connectedInboxes,
		monthlyOutreachEmails: limits.outreachEmails,
		csvExportEnabled: limits.csvExport
	};
}
