import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test('verify page handles missing code', async ({ page }) => {
	await page.goto('/auth/verify');
	await expect(page.getByText(/Verification link is invalid|We could not verify/i)).toBeVisible();
	await expect(page.getByRole('link', { name: /Request another link/i })).toBeVisible();
});
