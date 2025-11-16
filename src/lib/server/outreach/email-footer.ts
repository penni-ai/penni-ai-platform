import type { UserEmailSettings } from '$lib/server/core/firestore';

/**
 * Generate email footer HTML from user settings
 */
export function generateEmailFooter(settings: UserEmailSettings | null | undefined): string {
	if (!settings?.footer?.enabled || !settings.footer.html) {
		return '';
	}
	
	let footer = settings.footer.html;
	
	// Replace branding variables if present
	if (settings.branding) {
		footer = footer.replace(/\{\{companyName\}\}/g, settings.branding.companyName || '');
		footer = footer.replace(/\{\{website\}\}/g, settings.branding.website || '');
		
		// Insert logo if provided
		if (settings.branding.logoUrl) {
			const logoHtml = `<img src="${settings.branding.logoUrl}" alt="${settings.branding.logoAlt || 'Logo'}" style="max-height: 60px; margin-bottom: 16px;" />`;
			footer = logoHtml + footer;
		}
		
		// Add social links if provided
		if (settings.branding.socialLinks) {
			const socialLinks: string[] = [];
			if (settings.branding.socialLinks.instagram) {
				socialLinks.push(`<a href="${settings.branding.socialLinks.instagram}">Instagram</a>`);
			}
			if (settings.branding.socialLinks.twitter) {
				socialLinks.push(`<a href="${settings.branding.socialLinks.twitter}">Twitter</a>`);
			}
			if (settings.branding.socialLinks.linkedin) {
				socialLinks.push(`<a href="${settings.branding.socialLinks.linkedin}">LinkedIn</a>`);
			}
			if (socialLinks.length > 0) {
				footer += `<div style="margin-top: 16px;">${socialLinks.join(' | ')}</div>`;
			}
		}
	}
	
	// Wrap footer in a div with email-safe styling
	return `<div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">${footer}</div>`;
}

