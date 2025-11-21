/**
 * Firebase Admin SDK initialization
 * 
 * This module initializes Firebase Admin SDK for server-side use.
 * It automatically detects and connects to emulators when configured.
 * 
 * Exports:
 * - adminApp: The Firebase Admin app instance
 * - adminAuth: The Firebase Admin Auth instance
 * - adminDb: The Firestore Admin instance
 * - adminStorage: The Storage Admin instance
 */

import { initializeApp, getApp, getApps, type App, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

type FirebaseEnvConfig = {
	projectId?: string;
	storageBucket?: string;
};

function parseFirebaseEnvConfig(): FirebaseEnvConfig {
	const rawConfig = process.env.FIREBASE_CONFIG;
	if (!rawConfig) return {};
	try {
		const parsed = JSON.parse(rawConfig);
		return {
			projectId: parsed.projectId || parsed.project_id,
			storageBucket: parsed.storageBucket || parsed.storage_bucket
		};
	} catch (error) {
		console.warn('[FirebaseAdmin] Failed to parse FIREBASE_CONFIG', error);
		return {};
	}
}

const firebaseEnvConfig = parseFirebaseEnvConfig();
const resolvedProjectId =
	process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || firebaseEnvConfig.projectId;
const fallbackBucket = resolvedProjectId ? `${resolvedProjectId}.firebasestorage.app` : 'penni-ai-platform.firebasestorage.app';
const resolvedStorageBucket =
	process.env.STORAGE_BUCKET ||
	process.env.FIREBASE_STORAGE_BUCKET ||
	firebaseEnvConfig.storageBucket ||
	fallbackBucket;

if (!process.env.STORAGE_BUCKET) {
	process.env.STORAGE_BUCKET = resolvedStorageBucket;
}

if (!process.env.FIREBASE_STORAGE_BUCKET) {
	process.env.FIREBASE_STORAGE_BUCKET = resolvedStorageBucket;
}

let adminConfigLogged = false;

function createAdminApp(): App {
	if (getApps().length) {
		const existingApp = getApp();
		logAdminConfig(existingApp);
		return existingApp;
	}

	const projectId = resolvedProjectId;
	const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
	const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

	if (clientEmail && privateKey) {
		const app = initializeApp({
			credential: cert({
				projectId,
				clientEmail,
				privateKey
			}),
			projectId: projectId ?? undefined,
			storageBucket: resolvedStorageBucket
		});
		logAdminConfig(app);
		return app;
	}

	if (projectId) {
		const app = initializeApp({ projectId, storageBucket: resolvedStorageBucket });
		logAdminConfig(app);
		return app;
	}

	const app = initializeApp({ storageBucket: resolvedStorageBucket });
	logAdminConfig(app);
	return app;
}

export const adminApp = createAdminApp();
export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
export const adminStorage = getStorage(adminApp);

function logAdminConfig(app: App) {
	if (adminConfigLogged) return;
	adminConfigLogged = true;
	console.info('[FirebaseAdmin] Initialized API admin app', {
		projectId: app.options.projectId,
		storageBucket: app.options.storageBucket,
		resolvedProjectId,
		resolvedStorageBucket
	});
}

// Log emulator status (Admin SDK automatically detects emulators via environment variables)
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const storageEmulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

if (firestoreEmulatorHost || storageEmulatorHost || authEmulatorHost) {
	console.info('[FirebaseAdmin] Emulator configuration detected', {
		firestore: firestoreEmulatorHost || 'none',
		storage: storageEmulatorHost || 'none',
		auth: authEmulatorHost || 'none'
	});
}
