import { describe, expect, it, vi } from 'vitest';

describe('routes/(app)/settings load', () => {
	it('redirects to /my-account', async () => {
		vi.resetModules();

		const { load } = await import('../../../src/routes/(app)/settings/+page');
		try {
			load();
			throw new Error('Expected redirect');
		} catch (error) {
			expect(error).toMatchObject({ status: 307, location: '/my-account' });
		}
	});
});
