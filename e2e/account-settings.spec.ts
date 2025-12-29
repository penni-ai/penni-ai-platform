import { test, expect } from '@playwright/test';

test.use({ storageState: 'test-results/e2e-auth.json' });

test('account settings saves outreach preferences and theme', async ({ page }) => {
	await page.goto('/my-account');
	await expect(page.getByRole('heading', { name: /Account Settings/i })).toBeVisible();

	const directSendToggle = page.getByLabel('Direct Gmail Send');
	await expect(directSendToggle).toBeEnabled();
	await directSendToggle.check();
	await page.getByRole('button', { name: /Save outreach settings/i }).click();
	await expect(page.getByText(/Outreach settings saved/i)).toBeVisible();

	await page.getByRole('button', { name: 'Dark' }).click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
