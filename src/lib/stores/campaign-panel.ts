import { writable, get } from 'svelte/store';

interface CampaignPanelState {
	isOpen: boolean;
	campaignId: string | null;
	isCreating: boolean;
}

function createCampaignPanelStore() {
	const { subscribe, set, update } = writable<CampaignPanelState>({
		isOpen: false,
		campaignId: null,
		isCreating: false
	});

	return {
		subscribe,

		// Request to create a new campaign - this will be handled by the layout
		requestCreate: async () => {
			update(state => ({ ...state, isCreating: true }));

			try {
				const response = await fetch('/api/campaigns', { method: 'POST' });
				if (!response.ok) {
					throw new Error('Failed to create campaign');
				}
				const data = await response.json();
				if (data.campaignId) {
					set({
						isOpen: true,
						campaignId: data.campaignId,
						isCreating: false
					});
					return data.campaignId;
				}
				throw new Error('No campaign ID returned');
			} catch (error) {
				update(state => ({ ...state, isCreating: false }));
				throw error;
			}
		},

		// Open panel for an existing campaign
		open: (campaignId: string) => {
			set({
				isOpen: true,
				campaignId,
				isCreating: false
			});
		},

		// Close the panel
		close: () => {
			set({
				isOpen: false,
				campaignId: null,
				isCreating: false
			});
		},

		// Get current state
		get: () => get({ subscribe })
	};
}

export const campaignPanel = createCampaignPanelStore();
