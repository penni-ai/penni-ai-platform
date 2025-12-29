import { request } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const storageStatePath = resolve('test-results/e2e-auth.json');

export default async function globalSetup() {
	const baseURL = process.env.PLAYWRIGHT_BASE_URL;
	if (!baseURL) {
		throw new Error('PLAYWRIGHT_BASE_URL must be set for E2E tests.');
	}

	const email = process.env.E2E_TEST_EMAIL || 'search-tester@example.com';
	const password = process.env.E2E_TEST_PASSWORD || 'TestPass123!';
	const uid = process.env.E2E_TEST_UID || 'e2e-test-user-0001';

	const context = await request.newContext({
		baseURL,
		extraHTTPHeaders: { origin: baseURL }
	});

	const response = await context.post('/api/public/test-login', {
		data: {
			email,
			password,
			uid,
			reset: true,
			remember: true
		}
	});

	if (!response.ok()) {
		const body = await response.text();
		throw new Error(`Failed to create test session: ${response.status()} ${body}`);
	}

	const storageState = await context.storageState();
	mkdirSync(dirname(storageStatePath), { recursive: true });
	writeFileSync(storageStatePath, JSON.stringify(storageState, null, 2), 'utf-8');

	await context.dispose();
}
