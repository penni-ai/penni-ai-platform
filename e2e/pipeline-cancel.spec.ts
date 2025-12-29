import { test, expect } from '@playwright/test';

test.use({ storageState: 'test-results/e2e-auth.json' });

test('cancel an in-flight pipeline search', async ({ page }) => {
	await page.goto('/dashboard');
	const welcomeCta = page.getByRole('button', { name: /Create Your First Campaign/i });
	if (await welcomeCta.isVisible()) {
		await welcomeCta.click();
	} else {
		await page.getByRole('button', { name: /Create Campaign/i }).click();
	}
	await page.getByRole('button', { name: /Enter company details manually/i }).click();

	await page.getByLabel('Brand / Company name').fill('Cancel Test');
	await page.getByLabel('What do you sell?').fill('Test cancellation flow.');
	await page.getByRole('button', { name: /Continue/i }).click();

	await page.getByLabel('Creator niche or type').fill('tech creators');
	await page.getByLabel('Location of Influencers').fill('San Francisco');
	await page.getByRole('button', { name: /Continue/i }).click();

	const [response] = await Promise.all([
		page.waitForResponse((res) => res.url().includes('/api/search/influencers') && res.request().method() === 'POST'),
		page.getByRole('button', { name: /Launch search/i }).click(),
	]);

	const payload = await response.json().catch(() => ({}));
	const jobId = payload.job_id ?? payload?.data?.job_id;
	expect(jobId).toBeTruthy();

	page.on('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: /Cancel search/i }).click();

	await expect.poll(async () => {
		const res = await page.request.get(`/api/pipeline/${jobId}`);
		const data = await res.json().catch(() => ({}));
		return data?.status ?? data?.data?.status;
	}).toBe('cancelled');
});
