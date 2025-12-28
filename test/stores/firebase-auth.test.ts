import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

import { firebaseAuthReady, resetFirebaseAuth, setFirebaseAuthReady } from '../../src/lib/stores/firebase-auth';

describe('stores/firebase-auth', () => {
	it('toggles readiness', () => {
		expect(get(firebaseAuthReady)).toBe(false);
		setFirebaseAuthReady();
		expect(get(firebaseAuthReady)).toBe(true);
		resetFirebaseAuth();
		expect(get(firebaseAuthReady)).toBe(false);
	});
});

