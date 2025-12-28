import { describe, expect, it } from 'vitest';

import {
	normalizeInstagramProfile,
	normalizeProfile,
	normalizeProfiles,
	normalizeTikTokProfile
} from '../dist/utils/profile-normalizer.js';

describe('profile-normalizer (unit)', () => {
	it('normalizeProfiles throws on non-array input', () => {
		expect(() => normalizeProfiles({} as any)).toThrow(/expects an array/);
	});

	it('returns unified profiles as-is but fills missing display_name', () => {
		const unified = normalizeProfile({
			platform: 'instagram',
			account_id: 'abc',
			id: '1',
			profile_url: 'https://instagram.com/abc/',
			url: 'https://instagram.com/abc/',
			display_name: '   '
		} as any);

		expect(unified.platform).toBe('instagram');
		expect(unified.display_name).toBe('abc');
	});

	it('normalizes Instagram profiles (posts, email extraction, external_url coercion, hashtags)', () => {
		const normalized = normalizeInstagramProfile({
			account: 'acc',
			id: 'ig_1',
			fbid: 'fbid',
			profile_url: 'https://instagram.com/acc/',
			url: 'https://instagram.com/acc/',
			full_name: 'Full',
			profile_name: 'Profile',
			biography: 'Contact: test@example.com and @mention and bad@nope',
			profile_image_link: 'https://img',
			followers: 123,
			following: 10,
			posts_count: 2,
			avg_engagement: 0.12,
			external_url: [' https://example.com ', ''],
			email_address: null,
			posts: [
				{
					id: 'p0',
					shortcode: 'vid123',
					type: 'video',
					caption: 'Video caption',
					likes: { count: 10 },
					comments: { count: 0 },
					shares: { count: 0 },
					taken_at: '2025-01-02T00:00:00.000Z',
					video_url: 'https://video0',
					display_url: 'https://img0'
				},
				{
					id: 'p1',
					shortcode: 'abc123',
					type: 'reel',
					is_reel: true,
					caption: { text: 'Hello #Coffee #NYC' },
					likes: { count: 5 },
					comments: { count: 1 },
					shares: { count: 0 },
					video_view_count: 100,
					datetime: '2025-01-01T00:00:00.000Z',
					video_url: 'https://video',
					display_url: 'https://img1'
				},
				{
					id: 'p2',
					shortcode: 'def456',
					is_carousel: true,
					type: 'carousel',
					edge_media_to_caption: { edges: [{ node: { text: 'Caption #Coffee' } }] },
					edge_media_preview_like: { count: 50 },
					edge_media_to_comment: { count: 2 },
					taken_at_timestamp: 1,
					display_url: 'https://img2'
				}
			]
		} as any);

		expect(normalized.platform).toBe('instagram');
		expect(normalized.display_name).toBe('Full');
		expect(normalized.profile_url).toContain('instagram.com');
		expect(normalized.external_url).toBe('https://example.com');
		expect(normalized.email_address).toBe('test@example.com');
		expect(normalized.hashtags).toEqual(['coffee', 'nyc']);

		expect(normalized.posts_data).toBeDefined();
		expect(normalized.posts_data?.length).toBeLessThanOrEqual(8);
		expect(normalized.posts_data?.[0]?.post_type).toBe('carousel');
		expect(normalized.posts_data?.[0]?.likes).toBe(50);
		expect(normalized.posts_data?.some((p) => p.post_type === 'video')).toBe(true);
		expect(normalized.posts_data?.some((p) => p.created_at === '2025-01-02T00:00:00.000Z')).toBe(true);
	});

	it('coerces external_url from a string and supports fallbacks', () => {
		const normalized = normalizeInstagramProfile({
			account: 'acc',
			id: 'ig_2',
			fbid: 'fbid2',
			profile_url: 'https://instagram.com/acc/',
			url: 'https://instagram.com/acc/',
			full_name: 'Full',
			profile_name: 'Profile',
			biography: null,
			profile_image_link: null,
			followers: 0,
			following: 0,
			posts_count: 0,
			avg_engagement: null,
			external_url: '   https://example.com  ',
			email_address: null,
			posts: []
		} as any);

		expect(normalized.external_url).toBe('https://example.com');

		const empty = normalizeInstagramProfile({
			account: 'acc',
			id: 'ig_3',
			fbid: 'fbid3',
			profile_url: 'https://instagram.com/acc/',
			url: 'https://instagram.com/acc/',
			full_name: 'Full',
			profile_name: 'Profile',
			biography: null,
			profile_image_link: null,
			followers: 0,
			following: 0,
			posts_count: 0,
			avg_engagement: null,
			external_url: '   ',
			email_address: null,
			posts: []
		} as any);
		expect(empty.external_url).toBeNull();
	});

	it('normalizes TikTok profiles by merging top_videos + top_posts_data', () => {
		const normalized = normalizeTikTokProfile({
			account_id: 'tiktok_user',
			id: 'tt_1',
			url: 'https://tiktok.com/@tiktok_user',
			nickname: 'Nick',
			biography: 'Email me: hello@foo.com',
			profile_pic_url: 'https://pic',
			followers: 999,
			following: 10,
			videos_count: 2,
			awg_engagement_rate: Number.NaN,
			bio_link: [' https://tiktok.link ', ''],
			top_videos: [
				{
					video_id: 'v1',
					video_url: 'https://tiktok.com/v/1',
					diggcount: 1,
					commentcount: 2,
					share_count: 3,
					playcount: 4,
					favorites_count: 5,
					cover_image: 'https://cover',
					create_date: '2025-01-01T00:00:00.000Z'
				}
			],
			top_posts_data: [
				{
					post_id: 'v1',
					post_url: 'https://tiktok.com/v/1',
					post_type: 'video',
					description: 'desc',
					hashtags: ['TagA'],
					likes: 99,
					create_time: '2025-02-01T00:00:00.000Z'
				},
				{
					post_id: 'v2',
					post_url: 'https://tiktok.com/v/2',
					post_type: 'video',
					description: 'desc2',
					hashtags: ['TagB'],
					likes: 1,
					create_time: '2025-03-01T00:00:00.000Z'
				}
			]
		} as any);

		expect(normalized.platform).toBe('tiktok');
		expect(normalized.email_address).toBe('hello@foo.com');
		expect(normalized.external_url).toBe('https://tiktok.link');
		expect(normalized.avg_engagement_rate).toBeNull();

		expect(normalized.posts_data?.[0]?.post_id).toBe('v2'); // newest first
		const v1 = normalized.posts_data?.find((p) => p.post_id === 'v1');
		expect(v1?.caption).toBe('desc');
		expect(v1?.likes).toBe(99);
		expect(v1?.hashtags).toEqual(['TagA']);
	});

	it('falls back to URL detection when platform markers are missing', () => {
		const normalized = normalizeProfile({
			account_id: 'x',
			id: '1',
			url: 'https://tiktok.com/@x',
			profile_url: 'https://tiktok.com/@x',
			nickname: null,
			biography: null,
			profile_pic_url: null,
			followers: 1,
			following: 1,
			videos_count: 0,
			awg_engagement_rate: 0,
			bio_link: null
		} as any);

		expect(normalized.platform).toBe('tiktok');
	});

	it('normalizeProfile fallback chooses instagram/tiktok on URL, otherwise uses last-resort heuristics', () => {
		const byUrlInstagram = normalizeProfile({ url: 'https://instagram.com/x', profile_url: 'https://instagram.com/x' } as any);
		expect(byUrlInstagram.platform).toBe('instagram');

		const byUrlTikTok = normalizeProfile({ url: 'https://tiktok.com/@x', profile_url: 'https://tiktok.com/@x' } as any);
		expect(byUrlTikTok.platform).toBe('tiktok');

		const lastResortTikTok = normalizeProfile({ account_id: 'x', url: 'https://example.com/x' } as any);
		expect(lastResortTikTok.platform).toBe('tiktok');

		const lastResortInstagram = normalizeProfile({ url: 'https://example.com/x' } as any);
		expect(lastResortInstagram.platform).toBe('instagram');
	});
});
