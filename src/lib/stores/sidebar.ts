import { browser } from '$app/environment';
import { writable } from 'svelte/store';

const STORAGE_KEY = 'penny-platform:sidebar-open';

function getStoredState(): boolean {
	if (!browser) return true;
	const stored = localStorage.getItem(STORAGE_KEY);
	return stored === null ? true : stored !== 'false';
}

function persistState(value: boolean) {
	if (!browser) return;
	localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
}

function createSidebarStore() {
	const { subscribe, set, update } = writable<boolean>(getStoredState());

	return {
		subscribe,
		open: () => {
			persistState(true);
			set(true);
		},
		close: () => {
			persistState(false);
			set(false);
		},
		set: (value: boolean) => {
			persistState(value);
			set(value);
		},
		toggle: () => {
			update(current => {
				const next = !current;
				persistState(next);
				return next;
			});
		}
	};
}

export const sidebarState = createSidebarStore();
