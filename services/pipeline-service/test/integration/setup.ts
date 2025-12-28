import { beforeAll } from 'vitest';

beforeAll(() => {
	// Ensure emulator-friendly defaults for firebase-admin + storage clients.
	process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'penni-ai-platform';
	process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;

	if (process.env.FIREBASE_STORAGE_EMULATOR_HOST && !process.env.STORAGE_EMULATOR_HOST) {
		const rawHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST.trim();
		if (rawHost) {
			process.env.STORAGE_EMULATOR_HOST = rawHost.startsWith('http') ? rawHost : `http://${rawHost}`;
		}
	}

	if (process.env.STORAGE_EMULATOR_HOST && !process.env.STORAGE_EMULATOR_HOST.startsWith('http')) {
		process.env.STORAGE_EMULATOR_HOST = `http://${process.env.STORAGE_EMULATOR_HOST}`;
	}
});

