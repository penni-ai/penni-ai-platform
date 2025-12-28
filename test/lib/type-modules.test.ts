import { describe, expect, it } from 'vitest';

describe('type-only modules', () => {
	it('can be imported for coverage', async () => {
		const libIndex = await import('$lib');
		const campaignTypes = await import('$lib/types/campaign');
		const outreachTypes = await import('$lib/components/outreach/types');

		expect(libIndex).toBeDefined();
		expect(campaignTypes).toBeDefined();
		expect(outreachTypes).toBeDefined();
	});
});

