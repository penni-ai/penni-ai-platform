import { test, expect } from '@playwright/test';

test.use({ storageState: 'test-results/e2e-auth.json' });

test('gmail connections page loads', async ({ page }) => {
	await page.goto('/my-account/gmail');
	await expect(page.getByRole('heading', { name: /Gmail Connections/i })).toBeVisible();
	await expect(page.getByRole('button', { name: /Connect Gmail/i }).first()).toBeVisible();
});
