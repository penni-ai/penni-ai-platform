import type { PageLoad } from './$types';

type MetricSummary = {
	sent: number;
	opened: number | null;
	repliedOut: number;
	positive: number;
};

type InfluencerRow = {
	id: string;
	name: string;
	username: string;
	location: string;
	followers: string;
	status: 'sent' | 'replied' | null;
};

type CampaignRecord = {
	id: string;
	name: string;
	description: string;
	profileCount: number;
	metrics: MetricSummary;
	influencers: InfluencerRow[];
};

const campaignLibrary: Record<string, CampaignRecord> = {
	'student-ai-campaign': {
		id: 'student-ai-campaign',
		name: 'Student AI Campaign',
		description: 'Campus creators outreach · Spring term launch',
		profileCount: 100,
		metrics: {
			sent: 700,
			opened: null,
			repliedOut: 88,
			positive: 41
		},
		influencers: [
			{ id: 'inf-001', name: 'Jane Cooper', username: '@janecooper', location: 'Miami', followers: '124.5K', status: 'sent' },
			{ id: 'inf-002', name: 'Esther Howard', username: '@estherhoward', location: 'Atlanta', followers: '87,320', status: 'sent' },
			{ id: 'inf-003', name: 'Cameron Williamson', username: '@cameronwilli', location: 'Chicago', followers: '205K', status: 'sent' },
			{ id: 'inf-004', name: 'Leslie Alexander', username: '@lesliealexander01', location: 'Houston', followers: '12.3K', status: 'replied' },
			{ id: 'inf-005', name: 'Jenny Wilson', username: '@jennywilson', location: 'Phoenix', followers: '978K', status: 'sent' },
			{ id: 'inf-006', name: 'Robert Fox', username: '@robertfox', location: 'Detroit', followers: '45,700', status: 'replied' },
			{ id: 'inf-007', name: 'Jacob Jones', username: '@jacobjones', location: 'Seattle', followers: '134K', status: 'sent' },
			{ id: 'inf-008', name: 'Brooklyn Simmons', username: '@brooklynsimmons', location: 'Denver', followers: '3.2M', status: 'sent' },
			{ id: 'inf-009', name: 'Cody Fisher', username: '@codyfisher', location: 'Orlando', followers: '523,000', status: null },
			{ id: 'inf-010', name: 'Cody Fisher', username: '@codyfisher', location: 'Portland', followers: '523,000', status: null },
			{ id: 'inf-011', name: 'Cody Fisher', username: '@codyfisher', location: 'Columbus', followers: '523,000', status: null },
			{ id: 'inf-012', name: 'Cody Fisher', username: '@codyfisher', location: 'Memphis', followers: '523,000', status: null },
			{ id: 'inf-013', name: 'Kathryn Murphy', username: '@kathrynmurphy', location: 'Austin', followers: '76.8K', status: 'sent' }
		]
	},
	'july-fourth-campaign': {
		id: 'july-fourth-campaign',
		name: 'July Fourth Campaign',
		description: 'Patriotic pop-up series · Fireworks weekend',
		profileCount: 64,
		metrics: {
			sent: 420,
			opened: 298,
			repliedOut: 51,
			positive: 18
		},
		influencers: [
			{ id: 'inf-201', name: 'Savannah Nguyen', username: '@savcreates', location: 'Nashville', followers: '212K', status: 'sent' },
			{ id: 'inf-202', name: 'Ronald Richards', username: '@roncooks', location: 'Boston', followers: '88,900', status: 'replied' },
			{ id: 'inf-203', name: 'Courtney Henry', username: '@courtneyshots', location: 'New York', followers: '432K', status: 'sent' },
			{ id: 'inf-204', name: 'Kristin Watson', username: '@kwatson', location: 'San Diego', followers: '156K', status: 'sent' },
			{ id: 'inf-205', name: 'Dianne Russell', username: '@diannevents', location: 'Austin', followers: '98,300', status: null }
		]
	},
	'club-free-drinks-campaign': {
		id: 'club-free-drinks-campaign',
		name: 'Club Free Drinks Campaign',
		description: 'Launch weekend VIP invites · Downtown nightlife',
		profileCount: 87,
		metrics: {
			sent: 560,
			opened: 402,
			repliedOut: 112,
			positive: 36
		},
		influencers: [
			{ id: 'inf-301', name: 'Marvin McKinney', username: '@marvinmic', location: 'Las Vegas', followers: '612K', status: 'sent' },
			{ id: 'inf-302', name: 'Theresa Webb', username: '@tparty', location: 'Los Angeles', followers: '1.1M', status: 'sent' },
			{ id: 'inf-303', name: 'Guy Hawkins', username: '@nightlifeguy', location: 'Chicago', followers: '452K', status: 'replied' },
			{ id: 'inf-304', name: 'Eleanor Pena', username: '@elliep', location: 'New Orleans', followers: '265K', status: null },
			{ id: 'inf-305', name: 'Bessie Cooper', username: '@clubcooper', location: 'Miami', followers: '389K', status: 'sent' }
		]
	}
};

export const load: PageLoad = async ({ params }) => {
	const campaign = campaignLibrary[params.id] ?? campaignLibrary['student-ai-campaign'];

	return {
		campaign,
		metrics: campaign.metrics,
		profileCount: campaign.profileCount,
		influencers: campaign.influencers
	};
};
