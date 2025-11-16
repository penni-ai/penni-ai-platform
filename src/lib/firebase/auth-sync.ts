/**
 * Client-side Firebase Auth synchronization utilities
 * 
 * This module provides utilities to synchronize Firebase Auth state between
 * the server-side session (cookie) and client-side Firebase Auth instance.
 * 
 * Usage:
 * ```ts
 * import { ensureFirebaseAuthSession } from '$lib/firebase/auth-sync';
 * 
 * await ensureFirebaseAuthSession(userUid);
 * // Now Firebase Auth is ready for Firestore queries
 * ```
 */

import { firebaseAuth } from './client';
import { onAuthStateChanged, signInWithCustomToken, onIdTokenChanged, type User } from 'firebase/auth';

const AUTH_SYNC_TIMEOUT = 5000;
const ID_TOKEN_TIMEOUT = 5000;

let authSyncPromise: Promise<void> | null = null;
let authStateReadyPromise: Promise<void> | null = null;

/**
 * Waits for Firebase Auth to have a user with the specified UID
 */
function waitForAuthUser(targetUid: string): Promise<void> {
	if (firebaseAuth.currentUser?.uid === targetUid) {
		return Promise.resolve();
	}
	if (authStateReadyPromise) {
		return authStateReadyPromise;
	}
	authStateReadyPromise = new Promise<void>((resolve, reject) => {
		let resolved = false;
		let unsubscribe: (() => void) | null = null;
		const timeout = setTimeout(() => {
			if (!resolved) {
				unsubscribe?.();
				reject(new Error('Timed out waiting for Firebase auth state'));
			}
		}, AUTH_SYNC_TIMEOUT);

		unsubscribe = onAuthStateChanged(
			firebaseAuth,
			(user) => {
				if (user?.uid === targetUid) {
					resolved = true;
					clearTimeout(timeout);
					unsubscribe?.();
					resolve();
				}
			},
			(error) => {
				clearTimeout(timeout);
				unsubscribe?.();
				reject(error);
			}
		);
	}).finally(() => {
		authStateReadyPromise = null;
	});
	return authStateReadyPromise ?? Promise.resolve();
}

/**
 * Waits for Firebase ID token to be available for the specified UID
 * This is required for Firestore to authenticate requests
 */
async function waitForIdToken(uid: string): Promise<void> {
	// First, try to get the token immediately if user is already authenticated
	if (firebaseAuth.currentUser?.uid === uid) {
		try {
			await firebaseAuth.currentUser.getIdToken(false);
			return;
		} catch (error) {
			// If that fails, wait for token refresh
			console.warn('[FirebaseAuthSync] Failed to get ID token immediately, waiting for refresh', error);
		}
	}
	
	// Wait for ID token to become available
	return new Promise<void>((resolve, reject) => {
		let resolved = false;
		let unsubscribe: (() => void) | null = null;
		const timeout = setTimeout(() => {
			if (!resolved) {
				unsubscribe?.();
				reject(new Error('Timed out waiting for Firebase ID token'));
			}
		}, ID_TOKEN_TIMEOUT);

		// Check immediately in case token is already available
		const checkToken = async (user: User | null) => {
			if (user?.uid === uid) {
				try {
					await user.getIdToken(false);
					if (!resolved) {
						resolved = true;
						clearTimeout(timeout);
						unsubscribe?.();
						resolve();
					}
				} catch (error) {
					// Token not ready yet, wait for onIdTokenChanged
				}
			}
		};

		// Check current user immediately
		checkToken(firebaseAuth.currentUser);

		unsubscribe = onIdTokenChanged(
			firebaseAuth,
			async (user) => {
				await checkToken(user);
			},
			(error) => {
				if (!resolved) {
					resolved = true;
					clearTimeout(timeout);
					unsubscribe?.();
					reject(error);
				}
			}
		);
	});
}

/**
 * Ensures Firebase Auth is synchronized with the server-side session
 * 
 * This function:
 * 1. Checks if Firebase Auth already has a valid user
 * 2. If not, fetches a custom token from the server
 * 3. Signs in with the custom token
 * 4. Waits for auth state and ID token to be ready
 * 
 * @param uid - The user UID from the server-side session
 * @throws Error if authentication fails
 */
export async function ensureFirebaseAuthSession(uid: string): Promise<void> {
	// If already authenticated with the correct user, ensure token is valid
	if (firebaseAuth.currentUser?.uid === uid) {
		try {
			await firebaseAuth.currentUser.getIdToken(false);
			return;
		} catch (error) {
			// If token refresh fails, re-authenticate
			console.warn('[FirebaseAuthSync] ID token unavailable, re-authenticating', error);
		}
	}
	
	// Prevent multiple simultaneous sync attempts
	if (authSyncPromise) {
		return authSyncPromise;
	}
	
	authSyncPromise = (async () => {
		try {
			const response = await fetch('/api/session/token', {
				method: 'GET',
				credentials: 'same-origin'
			});
			
			if (!response.ok) {
				const errorBody = await response.json().catch(() => ({}));
				throw new Error(
					errorBody?.error?.message ?? `Failed to fetch Firebase auth token (${response.status})`
				);
			}
			
			const payload = await response.json();
			if (!payload?.token || typeof payload.token !== 'string' || typeof payload.uid !== 'string') {
				throw new Error('Custom token response missing required fields');
			}
			
			if (payload.uid !== uid) {
				throw new Error(`UID mismatch: expected ${uid}, got ${payload.uid}`);
			}
			
			await signInWithCustomToken(firebaseAuth, payload.token);
			await waitForAuthUser(payload.uid);
			// Wait for ID token to be available (needed for Firestore)
			await waitForIdToken(payload.uid);
		} catch (error) {
			console.error('[FirebaseAuthSync] Failed to synchronize Firebase auth session', error);
			throw error;
		} finally {
			authSyncPromise = null;
		}
	})();
	
	return authSyncPromise;
}

/**
 * Gets the current Firebase Auth user, or null if not authenticated
 */
export function getCurrentFirebaseUser(): User | null {
	return firebaseAuth.currentUser;
}

/**
 * Checks if Firebase Auth is currently authenticated with the specified UID
 */
export function isAuthenticatedWith(uid: string): boolean {
	return firebaseAuth.currentUser?.uid === uid;
}

