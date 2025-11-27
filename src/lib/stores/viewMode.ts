import { browser } from '$app/environment';
import { writable } from 'svelte/store';

export type ViewMode = 'simple' | 'advanced';
// Default to simple for new sessions and newly created campaigns
export const DEFAULT_VIEW_MODE: ViewMode = 'simple';

const initialMode: ViewMode = DEFAULT_VIEW_MODE;
const viewMode = writable<ViewMode>(initialMode);

if (browser) {
	const stored = localStorage.getItem('campaignViewMode');
	if (stored === 'simple' || stored === 'advanced') {
		viewMode.set(stored);
	}
}

export function setViewMode(mode: ViewMode) {
	viewMode.set(mode);
	if (browser) {
		localStorage.setItem('campaignViewMode', mode);
	}
}

export { viewMode };
