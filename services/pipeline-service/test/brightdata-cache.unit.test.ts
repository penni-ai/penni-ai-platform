import { describe, expect, it } from 'vitest';

import {
	detectPlatformFromUrl,
	extractProfileUrl,
	normalizeUrlForCache,
	urlToDocId
} from '../dist/utils/brightdata-cache.js';

describe('brightdata cache utils (unit)', () => {
	it('normalizes urls consistently for cache keys', () => {
		expect(normalizeUrlForCache(' https://www.instagram.com/SomeUser/ ')).toBe(
			'https://instagram.com/someuser'
		);
		expect(normalizeUrlForCache('https://instagram.com/SomeUser')).toBe('https://instagram.com/someuser');
		expect(normalizeUrlForCache('https://www.tiktok.com/@SomeUser/')).toBe('https://tiktok.com/@someuser');
	});

	it('creates stable firestore doc ids from urls', () => {
		const a = urlToDocId('https://instagram.com/someuser/');
		const b = urlToDocId('https://www.instagram.com/someuser');
		expect(a).toBe(b);
		expect(a).toMatch(/^[a-f0-9]{40}$/);
	});

	it('detects platform from url', () => {
		expect(detectPlatformFromUrl('https://instagram.com/x')).toBe('instagram');
		expect(detectPlatformFromUrl('https://tiktok.com/@x')).toBe('tiktok');
	});

	it('extracts profile url from raw profiles with fallbacks', () => {
		expect(
			extractProfileUrl(
				{ account: 'abc', profile_url: 'https://instagram.com/abc/', url: 'x' } as any,
				'instagram'
			)
		).toBe('https://instagram.com/abc/');

		expect(
			extractProfileUrl({ account: 'abc', profile_url: '', url: 'https://instagram.com/abc/' } as any, 'instagram')
		).toBe('https://instagram.com/abc/');

		expect(extractProfileUrl({ account: 'abc', profile_url: '', url: '' } as any, 'instagram')).toBe(
			'https://instagram.com/abc/'
		);

		expect(extractProfileUrl({ account_id: 'abc', url: 'https://tiktok.com/@abc' } as any, 'tiktok')).toBe(
			'https://tiktok.com/@abc'
		);

		expect(extractProfileUrl({ account_id: 'abc', url: '' } as any, 'tiktok')).toBe('https://tiktok.com/@abc');
	});
});

