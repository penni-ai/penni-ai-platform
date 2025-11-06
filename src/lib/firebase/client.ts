import { browser } from '$app/environment';
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import {
	PUBLIC_FIREBASE_API_KEY,
	PUBLIC_FIREBASE_AUTH_DOMAIN,
	PUBLIC_FIREBASE_PROJECT_ID,
	PUBLIC_FIREBASE_STORAGE_BUCKET,
	PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
	PUBLIC_FIREBASE_APP_ID
} from '$env/static/public';
import { env as publicEnv } from '$env/dynamic/public';

const firebaseConfig = {
	apiKey: PUBLIC_FIREBASE_API_KEY,
	authDomain: PUBLIC_FIREBASE_AUTH_DOMAIN,
	projectId: PUBLIC_FIREBASE_PROJECT_ID,
	storageBucket: PUBLIC_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
	appId: PUBLIC_FIREBASE_APP_ID
};

function createFirebaseApp(): FirebaseApp {
	if (!firebaseConfig.apiKey) {
		throw new Error('Missing Firebase configuration. Did you set PUBLIC_FIREBASE_* environment variables?');
	}
	return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

function configureAuth(app: FirebaseApp): Auth {
	const auth = getAuth(app);
	if (browser && import.meta.env.DEV) {
		const emulatorHost = publicEnv.PUBLIC_FIREBASE_AUTH_EMULATOR_HOST || 'http://127.0.0.1:9100';
		connectAuthEmulator(auth, emulatorHost, { disableWarnings: true });
	}
	return auth;
}

export const firebaseApp = createFirebaseApp();
export const firebaseAuth = configureAuth(firebaseApp);
