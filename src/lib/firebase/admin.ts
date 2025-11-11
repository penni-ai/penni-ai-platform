import { initializeApp, getApp, getApps, type App, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

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

const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (firestoreEmulatorHost) {
	console.info(`Using Firestore emulator at ${firestoreEmulatorHost}`);
}
