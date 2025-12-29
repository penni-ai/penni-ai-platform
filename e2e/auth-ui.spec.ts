import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('sign up flow routes to confirm screen', async ({ page }) => {
	const uniqueEmail = `new-user-${Date.now()}@example.com`;
	const password = 'TestPass123!';

	await page.goto('/sign-up');
	await page.getByLabel('Email Address').fill(uniqueEmail);
	await page.getByLabel('Password').fill(password);
	await page.getByLabel('Confirm Password').fill(password);
	await page.getByRole('checkbox').check();
	await page.getByRole('button', { name: /Create Account/i }).click();

	await expect(page).toHaveURL(/\/sign-up\/confirm/);
	await expect(page.getByRole('heading', { name: /Confirm your email/i })).toBeVisible();
});

test('sign in with test account', async ({ page }) => {
	await page.goto('/sign-in');
	await page.getByRole('button', { name: /Use test account/i }).click();
	await expect(page).toHaveURL(/\/dashboard/);
	await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/i })).toBeVisible();
});
