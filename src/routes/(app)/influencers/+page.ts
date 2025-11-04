import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	const influencers = [
		{
			id: 'inf-001',
			display_name: 'Ava Ramos',
			handle: '@ava.cooks',
			platform: 'Instagram',
			follower_count: 128400,
			engagement_rate: 4.3,
			location: 'Los Angeles, CA',
			verticals: ['Food', 'Lifestyle']
		},
		{
			id: 'inf-002',
			display_name: 'Jasper Lee',
			handle: '@jasper.codes',
			platform: 'YouTube',
			follower_count: 256900,
			engagement_rate: 3.7,
			location: 'Seattle, WA',
			verticals: ['Technology', 'Education']
		},
		{
			id: 'inf-003',
			display_name: 'Elena Ruiz',
			handle: '@elenaruizfit',
			platform: 'TikTok',
			follower_count: 512800,
			engagement_rate: 6.1,
			location: 'Austin, TX',
			verticals: ['Fitness', 'Wellness']
		}
	];

	const campaigns = [
		{ id: 'cmp-001', name: 'Student AI Campaign' },
		{ id: 'cmp-002', name: 'Spring Pop-Up' }
	];

	return {
		influencers,
		campaigns,
		profile: { full_name: 'Avery Demo' }
	};
};
