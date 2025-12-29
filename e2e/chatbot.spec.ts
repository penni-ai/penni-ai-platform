import { test, expect } from '@playwright/test';

test.use({ storageState: 'test-results/e2e-auth.json' });

test('chatbot page renders demo campaign form', async ({ page }) => {
	await page.goto('/chatbot');
	await expect(page.getByRole('heading', { name: /Draft a campaign brief/i })).toBeVisible();
	await expect(page.getByRole('button', { name: /Generate campaign/i })).toBeVisible();
	await expect(page.getByText(/No conversation yet/i)).toBeVisible();
});
