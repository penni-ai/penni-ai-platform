import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	return {
		conversation: [
			{ role: 'assistant', kind: 'bubble', content: 'Tell me about your campaign.', created_at: new Date().toISOString() }
		]
	};
};
