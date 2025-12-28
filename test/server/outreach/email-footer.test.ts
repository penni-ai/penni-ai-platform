import { describe, expect, it } from 'vitest';

import { generateEmailFooter } from '../../../src/lib/server/outreach/email-footer';

describe('server/outreach/email-footer', () => {
	it('returns empty string when disabled or missing html', () => {
		expect(generateEmailFooter(null)).toBe('');
		expect(generateEmailFooter({ footer: { enabled: false, html: '<p>x</p>' } } as any)).toBe('');
		expect(generateEmailFooter({ footer: { enabled: true, html: '' } } as any)).toBe('');
	});

	it('injects branding variables, logo, and socials', () => {
		const html = generateEmailFooter({
			footer: { enabled: true, html: '<p>{{companyName}} - {{website}}</p>' },
			branding: {
				companyName: 'Acme',
				website: 'https://acme.test',
				logoUrl: 'https://acme.test/logo.png',
				logoAlt: 'Acme logo',
				socialLinks: { instagram: 'https://ig.test/acme', twitter: 'https://x.test/acme', linkedin: 'https://li.test/acme' }
			}
		} as any);

		expect(html).toContain('<div style=');
		expect(html).toContain('Acme');
		expect(html).toContain('https://acme.test');
		expect(html).toContain('logo.png');
		expect(html).toContain('Instagram');
		expect(html).toContain('Twitter');
		expect(html).toContain('LinkedIn');
	});

	it('omits social section when socialLinks has no values', () => {
		const html = generateEmailFooter({
			footer: { enabled: true, html: '<p>Footer</p>' },
			branding: { companyName: 'Acme', socialLinks: {} }
		} as any);

		expect(html).toContain('<p>Footer</p>');
		expect(html).not.toContain('Instagram</a>');
		expect(html).not.toContain('LinkedIn</a>');
	});
});
