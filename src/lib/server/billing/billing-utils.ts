import type { PlanKey } from './stripe';

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
	
	if (planKey === 'free') {
		return {
			outreach: true, // Free plan allows limited outreach
			search: true,
			csvExport: false,
			connectedInboxes: 1,
			influencerSearchResults: 10,
			monthlyOutreachEmails: 10,
			planKey: 'free',
			updatedAt: now
		};
	}

	if (planKey === 'starter') {
		return {
			outreach: true,
			search: true,
			csvExport: false,
			connectedInboxes: 1,
			influencerSearchResults: 300,
			monthlyOutreachEmails: 200,
			planKey: 'starter',
			updatedAt: now
		};
	}

	if (planKey === 'growth') {
		return {
			outreach: true,
			search: true,
			csvExport: true,
			connectedInboxes: 3,
			influencerSearchResults: 1000,
			monthlyOutreachEmails: 700,
			planKey: 'growth',
			updatedAt: now
		};
	}

	if (planKey === 'event') {
		return {
			outreach: true,
			search: true,
			csvExport: true,
			connectedInboxes: 5,
			influencerSearchResults: 5000,
			monthlyOutreachEmails: 5000,
			planKey: 'event',
			updatedAt: now
		};
	}

	// Default to free plan capabilities if plan key is invalid
	return {
		outreach: true, // Free plan allows limited outreach
		search: true,
		csvExport: false,
		connectedInboxes: 1,
		influencerSearchResults: 10,
		monthlyOutreachEmails: 10,
		planKey: 'free',
		updatedAt: now
	};
}

export function buildEntitlements(planKey: PlanKey | null | undefined): PlanEntitlements | undefined {
	if (planKey === 'free') {
		return {
			maxProfiles: 10,
			connectedInboxes: 1,
			monthlyOutreachEmails: 10,
			csvExportEnabled: false
		};
	}
	if (planKey === 'starter') {
		return {
			maxProfiles: 300,
			connectedInboxes: 1,
			monthlyOutreachEmails: 200,
			csvExportEnabled: false
		};
	}
	if (planKey === 'growth') {
		return {
			maxProfiles: 1000,
			connectedInboxes: 3,
			monthlyOutreachEmails: 700,
			csvExportEnabled: true
		};
	}
	if (planKey === 'event') {
		return {
			maxProfiles: 5000,
			connectedInboxes: 5,
			monthlyOutreachEmails: 5000,
			csvExportEnabled: true
		};
	}
	return undefined;
}
