/**
 * Firebase Auth readiness store
 *
 * Tracks whether the client-side Firebase Auth has been synced with the server session.
 * This is needed because:
 * - Server knows the user via session cookie
 * - Client Firebase SDK needs to be explicitly authenticated
 * - Firestore listeners won't work until client auth is ready
 *
 * Usage in components:
 * ```ts
 * import { firebaseAuthReady } from '$lib/stores/firebase-auth';
 *
 * $effect(() => {
 *   if ($firebaseAuthReady) {
 *     // Safe to use Firestore listeners
 *   }
 * });
 * ```
 */

import { writable } from 'svelte/store';

export const firebaseAuthReady = writable(false);

/**
 * Mark Firebase auth as ready (called from layout after ensureFirebaseAuthSession succeeds)
 */
export function setFirebaseAuthReady() {
	firebaseAuthReady.set(true);
}

/**
 * Reset Firebase auth state (called on logout)
 */
export function resetFirebaseAuth() {
	firebaseAuthReady.set(false);
}
