import { test, expect } from '@playwright/test';

test.use({ storageState: 'test-results/e2e-auth.json' });

test('create campaign and run pipeline search', async ({ page }) => {
	await page.goto('/dashboard');
	await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/i })).toBeVisible();

	const welcomeCta = page.getByRole('button', { name: /Create Your First Campaign/i });
	if (await welcomeCta.isVisible()) {
		await welcomeCta.click();
	} else {
		await page.getByRole('button', { name: /Create Campaign/i }).click();
	}
	await page.getByRole('button', { name: /Enter company details manually/i }).click();

	await page.getByLabel('Brand / Company name').fill('Test Brand');
	await page.getByLabel('What do you sell?').fill('Coffee subscription box for busy founders.');
	await page.getByLabel('Website').fill('https://example.com');
	await page.getByRole('button', { name: /Continue/i }).click();

	await page.getByLabel('Creator niche or type').fill('coffee creators');
	await page.getByLabel('Location of Influencers').fill('New York');
	await page.getByRole('button', { name: /Continue/i }).click();

	const [response] = await Promise.all([
		page.waitForResponse((res) => res.url().includes('/api/search/influencers') && res.request().method() === 'POST'),
		page.getByRole('button', { name: /Launch search/i }).click(),
	]);

	const payload = await response.json().catch(() => ({}));
	const jobId = payload.job_id ?? payload?.data?.job_id;
	expect(jobId).toBeTruthy();

	await expect(page.getByRole('heading', { name: /Your Creators/i })).toBeVisible();
	await expect(page.getByText(/example_user_1/i)).toBeVisible();

	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: /Export/i }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/influencers-export-/i);
});
