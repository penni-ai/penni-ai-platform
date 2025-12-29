import { test, expect } from '@playwright/test';

test.use({ storageState: 'test-results/e2e-auth.json' });

test('outreach queue shows seeded emails and supports retry/cancel', async ({ page }) => {
	const baseURL = test.info().config.use.baseURL as string;
	const queuedSubject = `Fixture queued outreach ${Date.now()}`;
	const failedSubject = `Fixture failed outreach ${Date.now()}`;

	const seedResponse = await page.request.post('/api/public/test-seed', {
		data: {
			queueEmails: [
				{ to: 'queued@example.com', subject: queuedSubject, status: 'queued' },
				{ to: 'failed@example.com', subject: failedSubject, status: 'failed' }
			]
		},
		headers: { origin: baseURL }
	});
	expect(seedResponse.ok()).toBeTruthy();

	await page.goto('/inbox');
	await page.getByRole('button', { name: /Outreach Status/i }).click();

	await page.locator('.filter-pills button', { hasText: 'Failed' }).click();
	await expect(page.getByText(failedSubject)).toBeVisible();

	await page.getByRole('button', { name: /Retry/i }).first().click();
	await page.waitForLoadState('domcontentloaded');

	await page.locator('.filter-pills button', { hasText: 'All' }).click();
	const retriedRow = page.locator('.queue-item', { hasText: failedSubject });
	await expect(retriedRow).toContainText('Queued');

	const queuedRow = page.locator('.queue-item', { hasText: queuedSubject });
	await expect(queuedRow).toContainText('Queued');
	await queuedRow.getByRole('button', { name: /Cancel/i }).click();
	await page.waitForLoadState('domcontentloaded');

	const cancelledRow = page.locator('.queue-item', { hasText: queuedSubject });
	await expect(cancelledRow).toContainText('Cancelled');
});
