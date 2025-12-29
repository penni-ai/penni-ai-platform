import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('landing page loads', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: /Connect with creators/i })).toBeVisible();
});

test('terms and privacy pages load', async ({ page }) => {
	await page.goto('/terms');
	await expect(page.getByRole('heading', { name: /Terms of Service/i })).toBeVisible();

	await page.goto('/privacy');
	await expect(page.getByRole('heading', { name: /Privacy Policy/i })).toBeVisible();
});
