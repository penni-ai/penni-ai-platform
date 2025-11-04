import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	return {
		profile: {
			full_name: 'Avery Demo'
		},
		firebaseUser: {
			email: 'demo@penny.ai'
		},
		campaigns: [
			{ id: 'cmp-001', name: 'Student AI Campaign', status: 'active', objective: 'Drive 200 RSVPs from campus creators', start_date: '2025-01-14', end_date: null },
			{ id: 'cmp-002', name: 'Spring Pop-Up', status: 'draft', objective: 'Announce pop-up collaborations', start_date: null, end_date: null },
			{ id: 'cmp-003', name: 'Summer Menu Launch', status: 'completed', objective: 'Generate 50 influencer reels', start_date: '2024-08-01', end_date: '2024-09-01' }
		],
		campaignCounts: { total: 3, active: 1, draft: 1, completed: 1 },
		influencerSummary: { total: 42, invited: 18, in_conversation: 9, accepted: 6, completed: 4 },
		metricsSummary: { impressions: 128000, clicks: 5400, conversions: 760, spend_cents: 189000 }
	};
};
