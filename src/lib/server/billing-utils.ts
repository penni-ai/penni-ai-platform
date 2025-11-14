import type { PlanKey } from './stripe';

export interface PlanEntitlements {
	maxProfiles: number;
	connectedInboxes: number;
	monthlyOutreachEmails: number;
	maxActiveCampaigns: number;
	csvExportEnabled: boolean;
}

export function buildEntitlements(planKey: PlanKey | null | undefined): PlanEntitlements | undefined {
	if (planKey === 'free') {
		return {
			maxProfiles: 10,
			connectedInboxes: 0,
			monthlyOutreachEmails: 0,
			maxActiveCampaigns: 1,
			csvExportEnabled: false
		};
	}
	if (planKey === 'starter') {
		return {
			maxProfiles: 300,
			connectedInboxes: 1,
			monthlyOutreachEmails: 200,
			maxActiveCampaigns: 1,
			csvExportEnabled: false
		};
	}
	if (planKey === 'growth') {
		return {
			maxProfiles: 1000,
			connectedInboxes: 3,
			monthlyOutreachEmails: 700,
			maxActiveCampaigns: 10,
			csvExportEnabled: true
		};
	}
	if (planKey === 'event') {
		return {
			maxProfiles: 5000,
			connectedInboxes: 5,
			monthlyOutreachEmails: 5000,
			maxActiveCampaigns: 10,
			csvExportEnabled: true
		};
	}
	return undefined;
}

