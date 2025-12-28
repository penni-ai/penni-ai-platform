import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

function installDom() {
	const attrs = new Map<string, string>();
	(globalThis as any).document = {
		documentElement: {
			setAttribute: (k: string, v: string) => attrs.set(k, v)
		}
	};
	const store = new Map<string, string>();
	(globalThis as any).localStorage = {
		getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
		setItem: (k: string, v: string) => void store.set(k, v)
	};
	return { attrs, store };
}

describe('stores/theme', () => {
	it('defaults to mixed when not in browser', async () => {
		vi.resetModules();
		vi.doMock('$app/environment', () => ({ browser: false }));
		const { theme } = await import('../../src/lib/stores/theme');
		expect(get(theme as any)).toBe('mixed');
	});

	it('persists + applies theme in browser mode', async () => {
		vi.resetModules();
		const { attrs, store } = installDom();
		store.set('theme', 'dark');

		vi.doMock('$app/environment', () => ({ browser: true }));
		const { theme } = await import('../../src/lib/stores/theme');
		expect(get(theme as any)).toBe('dark');

		theme.set('light');
		expect(store.get('theme')).toBe('light');
		expect(attrs.get('data-theme')).toBe('light');

		theme.toggle(); // light -> dark
		expect(get(theme as any)).toBe('dark');
		expect(store.get('theme')).toBe('dark');

		theme.sync();
		expect(attrs.get('data-theme')).toBe('dark');
	});
});

