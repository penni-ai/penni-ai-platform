import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

import { upgradeModal } from '../../src/lib/stores/upgrade';

describe('stores/upgrade', () => {
	it('opens and closes', () => {
		expect(get(upgradeModal as any).open).toBe(false);

		upgradeModal.open('Title', 'Desc');
		expect(get(upgradeModal as any)).toEqual({ open: true, title: 'Title', description: 'Desc' });

		upgradeModal.close();
		expect(get(upgradeModal as any)).toEqual({ open: false, title: undefined, description: undefined });
	});
});

