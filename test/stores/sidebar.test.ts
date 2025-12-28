import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

function installLocalStorage() {
	const store = new Map<string, string>();
	(globalThis as any).localStorage = {
		getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
		setItem: (k: string, v: string) => void store.set(k, v)
	};
	return store;
}

describe('stores/sidebar', () => {
	it('defaults to open in non-browser mode', async () => {
		vi.resetModules();
		vi.doMock('$app/environment', () => ({ browser: false }));
		const { sidebarState } = await import('../../src/lib/stores/sidebar');
		expect(get(sidebarState as any)).toBe(true);
	});

	it('persists state to localStorage in browser mode', async () => {
		vi.resetModules();
		const store = installLocalStorage();
		store.set('penny-platform:sidebar-open', 'false');

		vi.doMock('$app/environment', () => ({ browser: true }));
		const { sidebarState } = await import('../../src/lib/stores/sidebar');
		expect(get(sidebarState as any)).toBe(false);

		sidebarState.open();
		expect(get(sidebarState as any)).toBe(true);
		expect(store.get('penny-platform:sidebar-open')).toBe('true');

		sidebarState.close();
		expect(get(sidebarState as any)).toBe(false);
		expect(store.get('penny-platform:sidebar-open')).toBe('false');

		sidebarState.set(true);
		expect(get(sidebarState as any)).toBe(true);
		expect(store.get('penny-platform:sidebar-open')).toBe('true');

		sidebarState.toggle();
		expect(get(sidebarState as any)).toBe(false);
		expect(store.get('penny-platform:sidebar-open')).toBe('false');
	});

	it('defaults to open in browser mode when storage key missing', async () => {
		vi.resetModules();
		installLocalStorage();

		vi.doMock('$app/environment', () => ({ browser: true }));
		const { sidebarState } = await import('../../src/lib/stores/sidebar');
		expect(get(sidebarState as any)).toBe(true);
	});
});
