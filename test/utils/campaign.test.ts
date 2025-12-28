import { describe, expect, it } from 'vitest';

import {
	formatFollowerRange,
	getPlatformColor,
	getPlatformLogo,
	getPlatformLogos,
	getProfileId,
	normalizePlatforms,
	simpleHash
} from '../../src/lib/utils/campaign';

describe('utils/campaign', () => {
	it('simpleHash is deterministic', () => {
		expect(simpleHash('abc')).toBe(simpleHash('abc'));
		expect(simpleHash('abc')).not.toBe(simpleHash('abcd'));
	});

	it('getProfileId prefers _id then profile_url then composite key', () => {
		expect(getProfileId({ _id: 'id1' } as any)).toBe('id1');
		expect(getProfileId({ profile_url: 'https://x' } as any)).toBe('https://x');
		expect(getProfileId({ platform: 'instagram', display_name: 'a', followers: 10, email_address: 'e' } as any)).toContain(
			'instagram_a_10_e'
		);
		const noEmail = getProfileId({ platform: 'instagram', display_name: 'a', followers: 10 } as any);
		expect(noEmail).toContain('instagram_a_10_');
	});

	it('formatFollowerRange formats min/max bounds', () => {
		expect(formatFollowerRange(null)).toBe('—');
		expect(formatFollowerRange({ min: 10, max: 20 })).toContain('10');
		expect(formatFollowerRange({ min: 10, max: null })).toContain('10');
		expect(formatFollowerRange({ min: null, max: 20 })).toContain('Up to');
		expect(formatFollowerRange({ min: null, max: null } as any)).toBe('—');
	});

	it('platform logo and color helpers behave', () => {
		expect(getPlatformLogo('instagram')).toContain('<svg');
		expect(getPlatformLogo('tiktok')).toContain('<svg');
		expect(getPlatformLogo('unknown')).toBe('');
		expect(getPlatformLogo(null)).toBe('');
		expect(getPlatformColor('instagram')).toBe('text-green-700');
		expect(getPlatformColor('unknown')).toBe('text-gray-500');
		expect(getPlatformColor(null)).toBe('text-gray-400');
	});

	it('normalizes platforms and returns logos list', () => {
		expect(normalizePlatforms(null)).toEqual([]);
		expect(normalizePlatforms('instagram')).toEqual(['instagram']);
		expect(normalizePlatforms(['instagram', '', 1 as any])).toEqual(['instagram']);
		expect(normalizePlatforms({} as any)).toEqual([]);
		const logos = getPlatformLogos(['instagram', 'tiktok']);
		expect(logos).toHaveLength(2);
		expect(logos[0]).toHaveProperty('logo');
	});
});
