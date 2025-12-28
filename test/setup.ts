import { beforeAll, beforeEach, vi } from 'vitest';

beforeAll(() => {
	process.env.NODE_ENV = process.env.NODE_ENV || 'test';

	process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'penni-ai-platform';
	process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
	process.env.PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || 'http://localhost';

	// Public Firebase client env (prevents noisy warnings in unit tests that import client modules).
	process.env.PUBLIC_FIREBASE_API_KEY = process.env.PUBLIC_FIREBASE_API_KEY || 'test-api-key';
	process.env.PUBLIC_FIREBASE_AUTH_DOMAIN = process.env.PUBLIC_FIREBASE_AUTH_DOMAIN || 'localhost';
	process.env.PUBLIC_FIREBASE_PROJECT_ID =
		process.env.PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'penni-ai-platform';
	process.env.PUBLIC_FIREBASE_STORAGE_BUCKET =
		process.env.PUBLIC_FIREBASE_STORAGE_BUCKET || `${process.env.PUBLIC_FIREBASE_PROJECT_ID}.firebasestorage.app`;
	process.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID =
		process.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID || 'test-sender';
	process.env.PUBLIC_FIREBASE_APP_ID = process.env.PUBLIC_FIREBASE_APP_ID || 'test-app-id';
});

beforeEach(() => {
	// Keep test output readable: most server modules are chatty by design.
	vi.spyOn(console, 'debug').mockImplementation(() => {});
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'info').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
