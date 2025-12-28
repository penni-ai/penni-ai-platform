import { describe, expect, it } from 'vitest';

import { getTemplateVariables, replaceTemplateVariables } from '../../../src/lib/server/outreach/email-templates';

describe('server/outreach/email-templates', () => {
	it('replaces influencer_name and related variables', () => {
		const out = replaceTemplateVariables('Hi {{name}} ({{influencer_name}}) {{platform}}', {
			influencer_name: 'Jane',
			platform: 'instagram'
		});
		expect(out).toBe('Hi Jane (Jane) instagram');
	});

	it('falls back to "there" when no name provided', () => {
		expect(replaceTemplateVariables('Hi {{name}}', {})).toBe('Hi there');
	});

	it('extracts variable names from content', () => {
		expect(getTemplateVariables('Hello {{name}} {{platform}} {{name}}')).toEqual(['name', 'platform']);
		expect(getTemplateVariables('no vars')).toEqual([]);
	});
});

