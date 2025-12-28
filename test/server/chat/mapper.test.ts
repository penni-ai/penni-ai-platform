import { describe, expect, it } from 'vitest';

import { mapConversationToUi } from '../../../src/lib/server/chat/mapper';

describe('server/chat/mapper', () => {
	it('maps collected fields and derives followers string', () => {
		const ui = mapConversationToUi({
			id: 'c1',
			status: 'ready',
			collected: {
				website: 'https://example.com',
				business_name: 'Acme',
				influencer_location: 'NYC',
				platform: 'instagram',
				type_of_influencer: 'food',
				min_followers: 100,
				max_followers: 200,
				updatedAt: 1
			},
			messages: []
		});

		expect(ui.collected.locations).toBe('NYC');
		expect(ui.collected.followers).toBe('100-200');
		expect(ui.followerRange).toEqual({ min: 100, max: 200 });
	});

	it('omits follower string when bounds are both null', () => {
		const ui = mapConversationToUi({
			id: 'c1',
			status: 'ready',
			collected: { min_followers: null, max_followers: null },
			messages: []
		} as any);
		expect(ui.collected.followers).toBeUndefined();
	});
});

