import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	const threads = [
		{
			id: 'thr-001',
			campaign_influencer_id: 'inf-001',
			channel: 'email',
			last_message_at: '2025-01-15T11:24:00Z',
			campaign_id: 'cmp-001',
			status: 'in_conversation',
			influencer: { display_name: 'Ava Ramos', handle: '@ava.cooks' },
			messages: [
				{ direction: 'brand', body: 'Would love to host you this Friday!', sent_at: '2025-01-12T09:20:00Z' },
				{ direction: 'influencer', body: 'Sounds great! Send me details.', sent_at: '2025-01-12T12:32:00Z' }
			]
		},
		{
			id: 'thr-002',
			campaign_influencer_id: 'inf-002',
			channel: 'instagram dm',
			last_message_at: '2025-01-14T16:10:00Z',
			campaign_id: 'cmp-001',
			status: 'invited',
			influencer: { display_name: 'Jasper Lee', handle: '@jasper.codes' },
			messages: [
				{ direction: 'brand', body: 'Hey Jasper! Interested in co-hosting our AI night?', sent_at: '2025-01-14T16:10:00Z' }
			]
		}
	];

	return {
		threads
	};
};
