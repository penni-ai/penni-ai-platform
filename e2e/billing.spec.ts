import { test, expect } from '@playwright/test';

test.use({ storageState: 'test-results/e2e-auth.json' });

test('billing page loads current plan and features', async ({ page }) => {
	await page.goto('/my-account/billing');
	await expect(page.getByRole('heading', { name: /Billing & Subscription/i })).toBeVisible();
	await expect(page.getByRole('heading', { name: /Current Plan/i })).toBeVisible();
	await expect(page.getByRole('heading', { name: /Plan Features/i })).toBeVisible();
});
