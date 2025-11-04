import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
	const messages = [
		{ role: 'assistant', content: 'Tell me about your campaign.', created_at: '2025-01-10T09:00:00Z', kind: 'bubble' },
		{ role: 'user', content: 'We are launching a campus pop-up and need foodie creators.', created_at: '2025-01-10T09:02:00Z', kind: 'bubble' },
		{ role: 'assistant', content: 'Great! I will outline suggested influencers, outreach copy, and next steps.', created_at: '2025-01-10T09:03:00Z', kind: 'bubble' }
	];

	return {
		campaign: { id: params.id, name: 'Student AI Campaign' },
		messages
	};
};
