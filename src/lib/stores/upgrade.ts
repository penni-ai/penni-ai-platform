import { writable } from 'svelte/store';

interface UpgradeModalState {
	open: boolean;
	title?: string;
	description?: string;
}

function createUpgradeStore() {
	const { subscribe, set, update } = writable<UpgradeModalState>({
		open: false,
		title: undefined,
		description: undefined
	});

	return {
		subscribe,
		open: (title?: string, description?: string) => {
			set({ open: true, title, description });
		},
		close: () => {
			set({ open: false, title: undefined, description: undefined });
		}
	};
}

export const upgradeModal = createUpgradeStore();
