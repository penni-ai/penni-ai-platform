import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('llm analysis (unit)', () => {
	beforeEach(() => {
		vi.resetModules();
		process.env.OPENAI_API_KEY = 'sk-test';
	});

	it('returns inactive result without calling OpenAI', async () => {
		const create = vi.fn();
		vi.doMock('openai', () => ({
			default: class OpenAIStub {
				responses = { create };
				constructor(_opts: any) {}
			}
		}));

		const { analyzeProfileFit } = await import('../dist/utils/llm-analysis.js');

		const badDate: any = {
			toString() {
				throw new Error('bad date');
			}
		};

		const result = await analyzeProfileFit(
			{
				platform: 'instagram',
				account_id: 'a',
				id: '1',
				profile_url: 'https://instagram.com/a/',
				url: 'https://instagram.com/a/',
				display_name: 'A',
				biography: null,
				profile_image_url: null,
				followers: 1,
				following: 1,
				posts_count: 1,
				avg_engagement_rate: null,
				external_url: null,
				email_address: null,
				hashtags: null,
				posts_data: [
					{
						post_id: 'p1',
						post_url: 'u',
						post_type: 'photo',
						caption: null,
						likes: 0,
						comments: 0,
						shares: 0,
						created_at: badDate,
						content_url: null,
						hashtags: null,
						platform: 'instagram'
					}
				]
			} as any,
			'desc'
		);

		expect(result.fit_score).toBe(0);
		expect(result.fit_rationale).toContain('inactive');
		expect(create).not.toHaveBeenCalled();
	});

	it('parses OpenAI JSON score and converts 1-10 to 0-100', async () => {
		const create = vi.fn(async () => ({
			output_text: JSON.stringify({
				score: 9,
				rationale: 'ok',
				summary: 's'
			})
		}));

		vi.doMock('openai', () => ({
			default: class OpenAIStub {
				responses = { create };
				constructor(_opts: any) {}
			}
		}));

		const { analyzeProfileFit } = await import('../dist/utils/llm-analysis.js');

		const now = new Date();
		now.setDate(now.getDate() - 1);

		const result = await analyzeProfileFit(
			{
				platform: 'instagram',
				account_id: 'a',
				id: '1',
				profile_url: 'https://instagram.com/a/',
				url: 'https://instagram.com/a/',
				display_name: 'A',
				biography: null,
				profile_image_url: null,
				followers: 1,
				following: 1,
				posts_count: 1,
				avg_engagement_rate: null,
				external_url: null,
				email_address: null,
				hashtags: null,
				posts_data: [
					{
						post_id: 'p1',
						post_url: 'u',
						post_type: 'photo',
						caption: null,
						likes: 0,
						comments: 0,
						shares: 0,
						created_at: now.toISOString(),
						content_url: null,
						hashtags: null,
						platform: 'instagram'
					}
				]
			} as any,
			'desc'
		);

		expect(create).toHaveBeenCalledTimes(1);
		expect(result.fit_score).toBe(90);
		expect(result.fit_rationale).toBe('ok');
		expect(result.fit_summary).toBe('s');
	});

	it('returns 0 on invalid JSON response', async () => {
		const create = vi.fn(async () => ({
			output_text: 'not json'
		}));

		vi.doMock('openai', () => ({
			default: class OpenAIStub {
				responses = { create };
				constructor(_opts: any) {}
			}
		}));

		const { analyzeProfileFit } = await import('../dist/utils/llm-analysis.js');

		const now = new Date();
		now.setDate(now.getDate() - 1);

		const result = await analyzeProfileFit(
			{
				platform: 'instagram',
				account_id: 'a',
				id: '1',
				profile_url: 'https://instagram.com/a/',
				url: 'https://instagram.com/a/',
				display_name: 'A',
				biography: null,
				profile_image_url: null,
				followers: 1,
				following: 1,
				posts_count: 1,
				avg_engagement_rate: null,
				external_url: null,
				email_address: null,
				hashtags: null,
				posts_data: [
					{
						post_id: 'p1',
						post_url: 'u',
						post_type: 'photo',
						caption: null,
						likes: 0,
						comments: 0,
						shares: 0,
						created_at: now.toISOString(),
						content_url: null,
						hashtags: null,
						platform: 'instagram'
					}
				]
			} as any,
			'desc'
		);

		expect(create).toHaveBeenCalledTimes(1);
		expect(result.fit_score).toBe(0);
		expect(result.fit_rationale).toContain('Analysis failed');
	});

	it('parses Responses API output array structure when output_text is missing', async () => {
		const create = vi.fn(async () => ({
			output: [
				{
					type: 'message',
					content: [
						{
							type: 'output_text',
							text: JSON.stringify({ score: 1, rationale: 'r', summary: 's' })
						}
					]
				}
			]
		}));

		vi.doMock('openai', () => ({
			default: class OpenAIStub {
				responses = { create };
				constructor(_opts: any) {}
			}
		}));

		const { analyzeProfileFit } = await import('../dist/utils/llm-analysis.js');

		const now = new Date();
		now.setDate(now.getDate() - 1);

		const result = await analyzeProfileFit(
			{
				platform: 'instagram',
				account_id: 'a',
				id: '1',
				profile_url: 'https://instagram.com/a/',
				url: 'https://instagram.com/a/',
				display_name: 'A',
				biography: null,
				profile_image_url: null,
				followers: 1,
				following: 1,
				posts_count: 1,
				avg_engagement_rate: null,
				external_url: null,
				email_address: null,
				hashtags: null,
				posts_data: [
					{
						post_id: 'p1',
						post_url: 'u',
						post_type: 'reel',
						caption: null,
						likes: 0,
						comments: 0,
						shares: 0,
						created_at: now.toISOString(),
						content_url: null,
						hashtags: null,
						platform: 'instagram'
					}
				]
			} as any,
			'desc'
		);

		expect(create).toHaveBeenCalledTimes(1);
		expect(result.fit_score).toBe(10);
		expect(result.fit_rationale).toBe('r');
	});

	it('returns default error when OpenAI response contains no text', async () => {
		const create = vi.fn(async () => ({
			output: []
		}));

		vi.doMock('openai', () => ({
			default: class OpenAIStub {
				responses = { create };
				constructor(_opts: any) {}
			}
		}));

		const { analyzeProfileFit } = await import('../dist/utils/llm-analysis.js');

		const now = new Date();
		now.setDate(now.getDate() - 1);

		const result = await analyzeProfileFit(
			{
				platform: 'instagram',
				account_id: 'a',
				id: '1',
				profile_url: 'https://instagram.com/a/',
				url: 'https://instagram.com/a/',
				display_name: 'A',
				biography: null,
				profile_image_url: null,
				followers: 1,
				following: 1,
				posts_count: 1,
				avg_engagement_rate: null,
				external_url: null,
				email_address: null,
				hashtags: null,
				posts_data: [
					{
						post_id: 'p1',
						post_url: 'u',
						post_type: 'photo',
						caption: null,
						likes: 0,
						comments: 0,
						shares: 0,
						created_at: now.toISOString(),
						content_url: null,
						hashtags: null,
						platform: 'instagram'
					}
				]
			} as any,
			'desc'
		);

		expect(result.fit_score).toBe(0);
		expect(result.fit_rationale).toContain('No text content');
	});

	it('buildFitAnalysisPrompt includes strict-mode header when enabled', async () => {
		const { buildFitAnalysisPrompt } = await import('../dist/utils/llm-analysis.js');

		const normal = buildFitAnalysisPrompt('profile', 'biz', false);
		expect(normal).not.toContain('STRICT LOCATION MATCHING MODE ENABLED');

		const strict = buildFitAnalysisPrompt('profile', 'biz', true);
		expect(strict).toContain('STRICT LOCATION MATCHING MODE ENABLED');
		expect(strict).toContain('NON-NEGOTIABLE');
	});

	it('formatProfileForLLM renders relative post dates and media types', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));

		const { formatProfileForLLM } = await import('../dist/utils/llm-analysis.js');

		const badDate: any = {
			toString() {
				throw new Error('bad date');
			}
		};

		const text = formatProfileForLLM({
			platform: 'instagram',
			account_id: 'a',
			id: '1',
			profile_url: 'https://instagram.com/a/',
			url: 'https://instagram.com/a/',
			display_name: 'A',
			biography: 'bio',
			profile_image_url: null,
			followers: 123,
			following: 1,
			posts_count: 1,
			avg_engagement_rate: null,
			external_url: null,
			email_address: null,
			hashtags: null,
			posts_data: [
				{
					post_id: 'p1',
					post_url: 'u',
					post_type: 'photo',
					caption: 'c1',
					likes: 0,
					comments: 0,
					shares: 0,
					created_at: '2025-01-15T11:59:40.000Z',
					content_url: 'img',
					hashtags: null,
					platform: 'instagram'
				},
				{
					post_id: 'p1m',
					post_url: 'u1m',
					post_type: 'photo',
					caption: 'c1m',
					likes: 0,
					comments: 0,
					shares: 0,
					created_at: '2025-01-15T11:59:00.000Z',
					content_url: 'img1m',
					hashtags: null,
					platform: 'instagram'
				},
				{
					post_id: 'p2',
					post_url: 'u2',
					post_type: 'video',
					caption: 'c2',
					likes: 0,
					comments: 0,
					shares: 0,
					created_at: '2025-01-15T10:00:00.000Z',
					content_url: 'vid',
					hashtags: null,
					platform: 'instagram'
				},
				{
					post_id: 'p3w',
					post_url: 'uw',
					post_type: 'photo',
					caption: 'week',
					likes: 0,
					comments: 0,
					shares: 0,
					created_at: '2025-01-07T12:00:00.000Z',
					content_url: 'w',
					hashtags: null,
					platform: 'instagram'
				},
				{
					post_id: 'p4mo',
					post_url: 'umo',
					post_type: 'photo',
					caption: 'month',
					likes: 0,
					comments: 0,
					shares: 0,
					created_at: '2024-12-15T12:00:00.000Z',
					content_url: 'mo',
					hashtags: null,
					platform: 'instagram'
				},
				{
					post_id: 'p5y',
					post_url: 'uy',
					post_type: 'photo',
					caption: 'year',
					likes: 0,
					comments: 0,
					shares: 0,
					created_at: '2024-01-15T12:00:00.000Z',
					content_url: 'y',
					hashtags: null,
					platform: 'instagram'
				},
				{
					post_id: 'pbad',
					post_url: 'ubad',
					post_type: 'photo',
					caption: 'bad',
					likes: 0,
					comments: 0,
					shares: 0,
					created_at: badDate,
					content_url: 'bad',
					hashtags: null,
					platform: 'instagram'
				}
			]
		} as any);

		expect(text).toContain('Date: 20 seconds ago');
		expect(text).toContain('Date: 1 minute ago');
		expect(text).toContain('Date: 1 week ago');
		expect(text).toContain('Date: 1 month ago');
		expect(text).toContain('Date: 1 year ago');
		expect(text).toContain('Date: Date unknown');
		expect(text).toContain('content_type: photo image: img');
		expect(text).toContain('content_type: video video: vid');

		vi.useRealTimers();
	});

	it('parses Responses API output array when message content is a string', async () => {
		const create = vi.fn(async () => ({
			output: [
				{
					type: 'message',
					content: JSON.stringify({ score: 2, rationale: 'r', summary: 's' })
				}
			]
		}));

		vi.doMock('openai', () => ({
			default: class OpenAIStub {
				responses = { create };
				constructor(_opts: any) {}
			}
		}));

		const { analyzeProfileFit } = await import('../dist/utils/llm-analysis.js');

		const now = new Date();
		now.setDate(now.getDate() - 1);

		const result = await analyzeProfileFit(
			{
				platform: 'instagram',
				account_id: 'a',
				id: '1',
				profile_url: 'https://instagram.com/a/',
				url: 'https://instagram.com/a/',
				display_name: 'A',
				biography: null,
				profile_image_url: null,
				followers: 1,
				following: 1,
				posts_count: 1,
				avg_engagement_rate: null,
				external_url: null,
				email_address: null,
				hashtags: null,
				posts_data: [
					{
						post_id: 'p1',
						post_url: 'u',
						post_type: 'photo',
						caption: null,
						likes: 0,
						comments: 0,
						shares: 0,
						created_at: now.toISOString(),
						content_url: null,
						hashtags: null,
						platform: 'instagram'
					}
				]
			} as any,
			'desc'
		);

		expect(result.fit_score).toBe(20);
	});

	it('uses env MAX_CONCURRENT_LLM_REQUESTS when maxConcurrent is falsy', async () => {
		process.env.MAX_CONCURRENT_LLM_REQUESTS = '3';

		const { analyzeProfileFitBatch } = await import('../dist/utils/llm-analysis.js');

		const old = new Date('2000-01-01T00:00:00.000Z').toISOString();
		const profiles = Array.from({ length: 4 }, (_, i) => ({
			platform: 'instagram',
			account_id: `a${i}`,
			id: String(i),
			profile_url: `https://instagram.com/a${i}/`,
			url: `https://instagram.com/a${i}/`,
			display_name: 'A',
			biography: null,
			profile_image_url: null,
			followers: 1,
			following: 1,
			posts_count: 1,
			avg_engagement_rate: null,
			external_url: null,
			email_address: null,
			hashtags: null,
			posts_data: [
				{
					post_id: 'p1',
					post_url: 'u',
					post_type: 'photo',
					caption: null,
					likes: 0,
					comments: 0,
					shares: 0,
					created_at: old,
					content_url: null,
					hashtags: null,
					platform: 'instagram'
				}
			]
		}));

		const results = await analyzeProfileFitBatch(profiles as any, 'desc', 0, false);
		expect(results).toHaveLength(4);
		expect(results.every((r) => r.fit_score === 0)).toBe(true);
	});

	it('analyzeProfileFitBatch retries failures with backoff', async () => {
		vi.useFakeTimers();
		delete process.env.OPENAI_API_KEY;

		const { analyzeProfileFitBatch } = await import('../dist/utils/llm-analysis.js');

		const now = new Date();
		now.setDate(now.getDate() - 1);

		const profiles = Array.from({ length: 3 }, (_, i) => ({
			platform: 'instagram',
			account_id: `a${i}`,
			id: String(i),
			profile_url: `https://instagram.com/a${i}/`,
			url: `https://instagram.com/a${i}/`,
			display_name: 'A',
			biography: null,
			profile_image_url: null,
			followers: 1,
			following: 1,
			posts_count: 1,
			avg_engagement_rate: null,
			external_url: null,
			email_address: null,
			hashtags: null,
			posts_data: [
				{
					post_id: 'p1',
					post_url: 'u',
					post_type: 'photo',
					caption: null,
					likes: 0,
					comments: 0,
					shares: 0,
					created_at: now.toISOString(),
					content_url: null,
					hashtags: null,
					platform: 'instagram'
				}
			]
		}));

		const promise = analyzeProfileFitBatch(profiles as any, 'desc', 2, false);
		await vi.advanceTimersByTimeAsync(10_000);
		const results = await promise;

		expect(results).toHaveLength(3);
		expect(results.every((r) => r.fit_score === 0)).toBe(true);
		expect(results[0].fit_rationale).toContain('after retries');

		vi.useRealTimers();
	});

	it('analyzeProfileFitBatch adds rejected results when internal backoff scheduling throws', async () => {
		delete process.env.OPENAI_API_KEY;

		const originalSetTimeout = globalThis.setTimeout;
		globalThis.setTimeout = (() => {
			throw new Error('setTimeout broke');
		}) as any;

		try {
			const { analyzeProfileFitBatch } = await import('../dist/utils/llm-analysis.js');

			const now = new Date();
			now.setDate(now.getDate() - 1);

			const profiles = [
				{
					platform: 'instagram',
					account_id: 'a0',
					id: '0',
					profile_url: 'https://instagram.com/a0/',
					url: 'https://instagram.com/a0/',
					display_name: 'A',
					biography: null,
					profile_image_url: null,
					followers: 1,
					following: 1,
					posts_count: 1,
					avg_engagement_rate: null,
					external_url: null,
					email_address: null,
					hashtags: null,
					posts_data: [
						{
							post_id: 'p1',
							post_url: 'u',
							post_type: 'photo',
							caption: null,
							likes: 0,
							comments: 0,
							shares: 0,
							created_at: now.toISOString(),
							content_url: null,
							hashtags: null,
							platform: 'instagram'
						}
					]
				}
			];

			const results = await analyzeProfileFitBatch(profiles as any, 'desc', 1, false);
			expect(results).toHaveLength(1);
			expect(results[0].fit_score).toBe(0);
			expect(results[0].fit_rationale).toContain('Analysis failed');
		} finally {
			globalThis.setTimeout = originalSetTimeout;
		}
	});
});
