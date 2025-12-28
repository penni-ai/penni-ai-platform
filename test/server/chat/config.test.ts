import { describe, expect, it, vi } from 'vitest';

describe('server/chat/config', () => {
	it('detects emulator mode via env vars', async () => {
		vi.resetModules();
		process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		vi.doMock('$env/dynamic/public', () => ({ env: {} }));

		const { isUsingEmulator, getChatbotEnv } = await import('../../../src/lib/server/chat/config');
		expect(isUsingEmulator()).toBe(true);
		expect(getChatbotEnv()).toBe('emulator');

		delete process.env.FIRESTORE_EMULATOR_HOST;
	});

	it('returns production env when CHATBOT_SERVICE_URL is configured', async () => {
		vi.resetModules();
		delete process.env.FIRESTORE_EMULATOR_HOST;
		process.env.CHATBOT_SERVICE_URL = 'https://chatbot.example.com';
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		vi.doMock('$env/dynamic/public', () => ({ env: {} }));

		const { getChatbotEnv, getChatbotServiceUrl } = await import('../../../src/lib/server/chat/config');
		expect(getChatbotEnv()).toBe('production');
		expect(getChatbotServiceUrl()).toBe('https://chatbot.example.com');

		delete process.env.CHATBOT_SERVICE_URL;
	});

	it('defaults to local url when no env configured', async () => {
		vi.resetModules();
		delete process.env.FIRESTORE_EMULATOR_HOST;
		delete process.env.CHATBOT_SERVICE_URL;
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		vi.doMock('$env/dynamic/public', () => ({ env: {} }));

		const { getChatbotEnv, getChatbotServiceUrl } = await import('../../../src/lib/server/chat/config');
		expect(getChatbotEnv()).toBe('local');
		expect(getChatbotServiceUrl()).toBe('http://localhost:8080');
	});

	it('detects emulator mode via public env and prefers CHATBOT_SERVICE_URL in emulator mode', async () => {
		vi.resetModules();
		process.env.CHATBOT_SERVICE_URL = 'http://localhost:9999';
		delete process.env.FIRESTORE_EMULATOR_HOST;

		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		vi.doMock('$env/dynamic/public', () => ({ env: { PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: 'http://localhost:9099' } }));

		const { isUsingEmulator, getChatbotEnv, getChatbotServiceUrl } = await import('../../../src/lib/server/chat/config');
		expect(isUsingEmulator()).toBe(true);
		expect(getChatbotEnv()).toBe('emulator');
		expect(getChatbotServiceUrl()).toBe('http://localhost:9999');

		delete process.env.CHATBOT_SERVICE_URL;
	});

	it('uses private CHATBOT_SERVICE_URL for production when set', async () => {
		vi.resetModules();
		delete process.env.FIRESTORE_EMULATOR_HOST;
		delete process.env.CHATBOT_SERVICE_URL;

		vi.doMock('$env/dynamic/private', () => ({ env: { CHATBOT_SERVICE_URL: 'https://private.example.com' } }));
		vi.doMock('$env/dynamic/public', () => ({ env: {} }));

		const { getChatbotEnv, getChatbotServiceUrl } = await import('../../../src/lib/server/chat/config');
		expect(getChatbotEnv()).toBe('production');
		expect(getChatbotServiceUrl()).toBe('https://private.example.com');
	});
});
