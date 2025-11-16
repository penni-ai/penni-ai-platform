/**
 * Firebase Client SDK initialization
 * 
 * This module initializes Firebase client SDK for browser use.
 * It automatically connects to emulators in development mode when configured.
 * 
 * Exports:
 * - firebaseApp: The Firebase app instance
 * - firebaseAuth: The Firebase Auth instance
 * - firebaseFirestore: The Firestore instance
 */

import { browser } from '$app/environment';
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { env as publicEnv } from '$env/dynamic/public';

const firebaseConfig = {
	apiKey: publicEnv.PUBLIC_FIREBASE_API_KEY,
	authDomain: publicEnv.PUBLIC_FIREBASE_AUTH_DOMAIN,
	projectId: publicEnv.PUBLIC_FIREBASE_PROJECT_ID,
	storageBucket: publicEnv.PUBLIC_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: publicEnv.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
	appId: publicEnv.PUBLIC_FIREBASE_APP_ID
};

function createFirebaseApp(): FirebaseApp {
	// Check if already initialized
	if (getApps().length) {
		return getApp();
	}
	
	// Validate required config (but don't throw during build - use fallbacks)
	if (!firebaseConfig.apiKey) {
		// In browser, this is a real error. During SSR/build, we might not have env vars yet
		if (typeof window !== 'undefined') {
			throw new Error('Missing Firebase configuration. Did you set PUBLIC_FIREBASE_* environment variables?');
		}
		// During SSR/build, create a minimal app - it will fail gracefully if used without config
		console.warn('[FirebaseClient] Missing PUBLIC_FIREBASE_API_KEY - Firebase features may not work');
	}
	
	return initializeApp(firebaseConfig);
}

function configureAuth(app: FirebaseApp): Auth {
	const auth = getAuth(app);
	if (browser && import.meta.env.DEV) {
		const emulatorHost = publicEnv.PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
		if (emulatorHost) {
			connectAuthEmulator(auth, emulatorHost, { disableWarnings: true });
		}
	}
	return auth;
}

function configureFirestore(app: FirebaseApp): Firestore {
	// Get auth first to ensure it's initialized
	const auth = getAuth(app);
	const firestore = getFirestore(app);
	
	// Connect to emulator if in development mode
	// IMPORTANT: This must be called BEFORE any Firestore operations
	if (browser && import.meta.env.DEV) {
		const emulatorHost = publicEnv.PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST;
		if (emulatorHost) {
			try {
			const [host, portRaw] = emulatorHost.split(':');
			const port = Number.parseInt(portRaw ?? '', 10) || 8080;
			connectFirestoreEmulator(firestore, host || 'localhost', port);
				console.log('[FirebaseClient] Connected to Firestore emulator', { host, port });
			} catch (error) {
				// If already connected, that's okay
				if (error instanceof Error && error.message.includes('already been called')) {
					console.warn('[FirebaseClient] Firestore emulator already connected');
				} else {
					console.error('[FirebaseClient] Failed to connect Firestore emulator', error);
				}
			}
		} else {
			console.warn('[FirebaseClient] PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST not set - using production Firestore');
		}
	}
	return firestore;
}

export const firebaseApp = createFirebaseApp();
export const firebaseAuth = configureAuth(firebaseApp);
export const firebaseFirestore = configureFirestore(firebaseApp);
