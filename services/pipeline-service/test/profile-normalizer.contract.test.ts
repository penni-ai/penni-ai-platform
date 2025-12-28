import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { normalizeProfiles } from '../dist/utils/profile-normalizer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, 'fixtures', 'external');

function loadFixture<T = unknown>(name: string): T {
	const filePath = path.join(fixturesDir, name);
	const raw = fs.readFileSync(filePath, 'utf8');
	return JSON.parse(raw) as T;
}

describe('profile normalizer (external fixtures)', () => {
	it('normalizes BrightData Instagram snapshot rows', () => {
		const raw = loadFixture<any[]>('brightdata.snapshot.instagram.json');
		expect(Array.isArray(raw)).toBe(true);
		expect(raw.length).toBeGreaterThan(0);

		const normalized = normalizeProfiles(raw as any);
		expect(normalized).toHaveLength(raw.length);

		for (const profile of normalized) {
			expect(profile.platform).toBe('instagram');
			expect(typeof profile.profile_url).toBe('string');
			expect(profile.profile_url).toContain('instagram.com');

			expect(typeof profile.display_name).toBe('string');
			expect(profile.display_name.length).toBeGreaterThan(0);

			expect(typeof profile.followers).toBe('number');
			expect(Number.isFinite(profile.followers)).toBe(true);

			expect(profile.biography === null || typeof profile.biography === 'string').toBe(true);
			expect(profile.profile_image_url === null || typeof profile.profile_image_url === 'string').toBe(true);
			expect(profile.external_url === null || typeof profile.external_url === 'string').toBe(true);
			expect(profile.avg_engagement_rate === null || typeof profile.avg_engagement_rate === 'number').toBe(true);
			expect(profile.email_address === null || typeof profile.email_address === 'string').toBe(true);

			if (profile.posts_data !== undefined) {
				expect(Array.isArray(profile.posts_data)).toBe(true);
				expect(profile.posts_data.length).toBeLessThanOrEqual(8);
			}
		}
	});

	it('normalizes BrightData TikTok snapshot rows', () => {
		const raw = loadFixture<any[]>('brightdata.snapshot.tiktok.json');
		expect(Array.isArray(raw)).toBe(true);
		expect(raw.length).toBeGreaterThan(0);

		const normalized = normalizeProfiles(raw as any);
		expect(normalized).toHaveLength(raw.length);

		for (const profile of normalized) {
			expect(profile.platform).toBe('tiktok');
			expect(typeof profile.profile_url).toBe('string');
			expect(profile.profile_url).toContain('tiktok.com');

			expect(typeof profile.display_name).toBe('string');
			expect(profile.display_name.length).toBeGreaterThan(0);

			expect(typeof profile.followers).toBe('number');
			expect(Number.isFinite(profile.followers)).toBe(true);

			expect(profile.biography === null || typeof profile.biography === 'string').toBe(true);
			expect(profile.profile_image_url === null || typeof profile.profile_image_url === 'string').toBe(true);
			expect(profile.external_url === null || typeof profile.external_url === 'string').toBe(true);
			expect(profile.avg_engagement_rate === null || typeof profile.avg_engagement_rate === 'number').toBe(true);
			expect(profile.email_address === null || typeof profile.email_address === 'string').toBe(true);

			if (profile.posts_data !== undefined) {
				expect(Array.isArray(profile.posts_data)).toBe(true);
				expect(profile.posts_data.length).toBeLessThanOrEqual(8);
			}
		}
	});
});

