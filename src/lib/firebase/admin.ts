import { initializeApp, getApp, getApps, type App, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const emulatorHost =
	process.env.FIREBASE_AUTH_EMULATOR_HOST || (process.env.NODE_ENV !== 'production' ? '127.0.0.1:9100' : undefined);

if (emulatorHost && !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
	process.env.FIREBASE_AUTH_EMULATOR_HOST = emulatorHost;
}

function createAdminApp(): App {
	if (getApps().length) {
		return getApp();
	}

	const projectId = process.env.FIREBASE_PROJECT_ID;
	const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
	const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

	if (clientEmail && privateKey) {
		return initializeApp({
			credential: cert({
				projectId,
				clientEmail,
				privateKey
			}),
			projectId
		});
	}

	if (projectId) {
		return initializeApp({ projectId });
	}

	return initializeApp();
}

export const adminApp = createAdminApp();
export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
