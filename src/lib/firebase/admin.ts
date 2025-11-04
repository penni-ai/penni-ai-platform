import { initializeApp, getApp, getApps, type App, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const emulatorHost =
	process.env.FIREBASE_AUTH_EMULATOR_HOST || (process.env.NODE_ENV !== 'production' ? '127.0.0.1:9100' : undefined);

if (emulatorHost && !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
	process.env.FIREBASE_AUTH_EMULATOR_HOST = emulatorHost;
}

function createAdminApp(): App {
	if (getApps().length) {
		return getApp();
	}

	const projectId = process.env.FIREBASE_PROJECT_ID ?? 'demo-project';
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

	return initializeApp({ projectId });
}

export const adminApp = createAdminApp();
export const adminAuth = getAuth(adminApp);
