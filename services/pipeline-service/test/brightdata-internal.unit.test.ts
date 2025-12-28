import { beforeEach, describe, expect, it, vi } from 'vitest';

type AxiosResponse = { data: any };

const post = vi.fn<Promise<AxiosResponse>, any[]>();
const get = vi.fn<Promise<AxiosResponse>, any[]>();

const axiosMock: any = {
	create: vi.fn(() => ({ post, get })),
	isAxiosError: (err: any) => Boolean(err?.isAxiosError)
};

vi.mock('axios', () => ({ default: axiosMock }));

describe('brightdata-internal (unit)', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		delete process.env.BRIGHTDATA_API_KEY;
		delete process.env.BRIGHTDATA_BASE_URL;
		delete process.env.BRIGHTDATA_INSTAGRAM_DATASET_ID;
		delete process.env.BRIGHTDATA_TIKTOK_DATASET_ID;
		delete process.env.BRIGHTDATA_POLL_INTERVAL;
	});

	it('getBrightDataApiKey throws when missing', async () => {
		const { getBrightDataApiKey } = await import('../dist/utils/brightdata-internal.js');
		expect(() => getBrightDataApiKey()).toThrow(/BRIGHTDATA_API_KEY/);
	});

	it('getBrightDataBaseUrl + getPollingInterval read env vars with defaults', async () => {
		const { getBrightDataBaseUrl, getMaxWaitTime, getPollingInterval } = await import('../dist/utils/brightdata-internal.js');

		expect(getBrightDataBaseUrl()).toBe('https://api.brightdata.com/datasets/v3');
		expect(getPollingInterval()).toBe(10);
		expect(getMaxWaitTime()).toBe(3600);

		process.env.BRIGHTDATA_BASE_URL = 'https://custom.example';
		process.env.BRIGHTDATA_POLL_INTERVAL = '3';
		expect(getBrightDataBaseUrl()).toBe('https://custom.example');
		expect(getPollingInterval()).toBe(3);
	});

	it('detectPlatform returns instagram/tiktok/null', async () => {
		const mod = await import('../dist/utils/brightdata-internal.js');
		expect(mod.detectPlatform('https://instagram.com/x')).toBe('instagram');
		expect(mod.detectPlatform('https://tiktok.com/@x')).toBe('tiktok');
		expect(mod.detectPlatform('https://example.com')).toBe(null);
	});

	it('triggerCollection groups urls by platform and triggers both datasets', async () => {
		process.env.BRIGHTDATA_API_KEY = 'k';
		process.env.BRIGHTDATA_BASE_URL = 'https://api.example.test';
		process.env.BRIGHTDATA_INSTAGRAM_DATASET_ID = 'ig_ds';
		process.env.BRIGHTDATA_TIKTOK_DATASET_ID = 'tk_ds';

		post
			.mockResolvedValueOnce({ data: { snapshot_id: 'ig_snapshot' } })
			.mockResolvedValueOnce({ data: 'tk_snapshot' });

		const { triggerCollection } = await import('../dist/utils/brightdata-internal.js');

		const snapshots = await triggerCollection(
			['https://instagram.com/a/', 'https://tiktok.com/@b', 'https://instagram.com/c/'],
			'k',
			'https://api.example.test'
		);

		expect(snapshots).toEqual([
			{ snapshot_id: 'ig_snapshot', platform: 'instagram' },
			{ snapshot_id: 'tk_snapshot', platform: 'tiktok' }
		]);

		expect(axiosMock.create).toHaveBeenCalledTimes(1);
		expect(post).toHaveBeenCalledTimes(2);

		const [igUrl, igPayload] = post.mock.calls[0] as any[];
		expect(String(igUrl)).toContain('/trigger?dataset_id=ig_ds');
		expect(Array.isArray(igPayload)).toBe(true);
		expect(igPayload).toEqual([{ url: 'https://instagram.com/a/' }, { url: 'https://instagram.com/c/' }]);

		const [tkUrl, tkPayload] = post.mock.calls[1] as any[];
		expect(String(tkUrl)).toContain('/trigger?dataset_id=tk_ds');
		expect(tkPayload).toEqual([
			{ url: 'https://tiktok.com/@b', country: '' }
		]);
	});

	it('triggerCollection supports snapshot response shapes and no-op on unknown urls', async () => {
		post.mockResolvedValueOnce({ data: { snapshot: 'ig_snapshot' } });

		const { triggerCollection } = await import('../dist/utils/brightdata-internal.js');

		const snapshots = await triggerCollection(['https://instagram.com/a/', 'https://example.com/nope'], 'k', 'base');
		expect(snapshots).toEqual([{ snapshot_id: 'ig_snapshot', platform: 'instagram' }]);
	});

	it('triggerCollection surfaces TikTok axios errors with response data', async () => {
		process.env.BRIGHTDATA_API_KEY = 'k';
		process.env.BRIGHTDATA_TIKTOK_DATASET_ID = 'tk_ds';

		post.mockRejectedValueOnce({
			isAxiosError: true,
			message: 'bad request',
			response: { status: 401, data: { error: 'nope' } }
		});

		const { triggerCollection } = await import('../dist/utils/brightdata-internal.js');

		await expect(triggerCollection(['https://tiktok.com/@a'], 'k', 'https://api.example.test')).rejects.toThrow(
			/BrightData TikTok trigger error: 401/
		);
	});

	it('triggerCollection rethrows non-axios errors', async () => {
		post.mockRejectedValueOnce(new Error('boom'));

		const { triggerCollection } = await import('../dist/utils/brightdata-internal.js');
		await expect(triggerCollection(['https://tiktok.com/@a'], 'k', 'base')).rejects.toThrow('boom');
	});

	it('triggerCollection throws when snapshot_id cannot be extracted', async () => {
		process.env.BRIGHTDATA_API_KEY = 'k';
		process.env.BRIGHTDATA_INSTAGRAM_DATASET_ID = 'ig_ds';

		post.mockResolvedValueOnce({ data: { unexpected: true } });

		const { triggerCollection } = await import('../dist/utils/brightdata-internal.js');
		await expect(triggerCollection(['https://instagram.com/a/'], 'k', 'https://api.example.test')).rejects.toThrow(
			/Could not extract snapshot_id/
		);
	});

	it('triggerCollection surfaces axios errors with response data', async () => {
		process.env.BRIGHTDATA_API_KEY = 'k';
		process.env.BRIGHTDATA_INSTAGRAM_DATASET_ID = 'ig_ds';

		post.mockRejectedValueOnce({
			isAxiosError: true,
			message: 'bad request',
			response: { status: 400, data: { error: 'bad' } }
		});

		const { triggerCollection } = await import('../dist/utils/brightdata-internal.js');

		await expect(
			triggerCollection(['https://instagram.com/a/'], 'k', 'https://api.example.test')
		).rejects.toThrow(/BrightData Instagram trigger error: 400/);
	});

	it('checkProgress normalizes response shape', async () => {
		get.mockResolvedValueOnce({
			data: {
				snapshot_id: 's1',
				dataset_id: 'd1',
				status: 'ready',
				progress: 1,
				total: 10,
				completed: 10,
				failed: 0,
				message: 'ok'
			}
		});

		const { checkProgress } = await import('../dist/utils/brightdata-internal.js');

		const result = await checkProgress('s1', 'k', 'https://api.example.test');
		expect(result).toEqual({
			snapshot_id: 's1',
			dataset_id: 'd1',
			status: 'ready',
			progress: 1,
			total: 10,
			completed: 10,
			failed: 0,
			message: 'ok'
		});

		expect(get).toHaveBeenCalledWith('/progress/s1', expect.any(Object));
	});

	it('checkProgress throws friendly errors for axios failures', async () => {
		get.mockRejectedValueOnce({
			isAxiosError: true,
			message: 'boom',
			response: { status: 500, data: { error: 'server' } }
		});

		const { checkProgress } = await import('../dist/utils/brightdata-internal.js');
		await expect(checkProgress('s1', 'k', 'base')).rejects.toThrow(/BrightData progress check error: 500/);
	});

	it('checkProgress rethrows non-axios errors', async () => {
		get.mockRejectedValueOnce(new Error('boom'));

		const { checkProgress } = await import('../dist/utils/brightdata-internal.js');
		await expect(checkProgress('s1', 'k', 'base')).rejects.toThrow('boom');
	});

	it('downloadResults handles array and wrapped object responses', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const { downloadResults } = await import('../dist/utils/brightdata-internal.js');

		get.mockResolvedValueOnce({ data: [{ a: 1 }, { a: 2 }] });
		const arr = await downloadResults('snap1', 'k', 'https://api.example.test');
		expect(arr).toHaveLength(2);

		get.mockResolvedValueOnce({ data: { data: [{ b: 1 }] } });
		const dataWrapped = await downloadResults('snap2', 'k', 'https://api.example.test');
		expect(dataWrapped).toEqual([{ b: 1 }]);

		get.mockResolvedValueOnce({ data: { results: [{ c: 1 }, { c: 2 }] } });
		const resultsWrapped = await downloadResults('snap3', 'k', 'https://api.example.test');
		expect(resultsWrapped).toHaveLength(2);

		get.mockResolvedValueOnce({ data: { single: true } });
		const singleWrapped = await downloadResults('snap4', 'k', 'https://api.example.test');
		expect(singleWrapped).toEqual([{ single: true }]);

		// Exercise platform-structure logging branches.
		get.mockResolvedValueOnce({ data: [{ account: 'a', fbid: '1' }] });
		await downloadResults('snap5', 'k', 'https://api.example.test');

		get.mockResolvedValueOnce({ data: [{ account_id: 'a', nickname: 'n' }] });
		await downloadResults('snap6', 'k', 'https://api.example.test');

		get.mockResolvedValueOnce({ data: [{ platform: 'instagram' }] });
		await downloadResults('snap7', 'k', 'https://api.example.test');

		// Fallback return-as-is (unexpected primitive response).
		get.mockResolvedValueOnce({ data: 'weird' });
		const weird = await downloadResults('snap8', 'k', 'https://api.example.test');
		expect(weird as any).toBe('weird');

		logSpy.mockRestore();
	});

	it('downloadResults throws friendly errors for axios failures', async () => {
		get.mockRejectedValueOnce({
			isAxiosError: true,
			message: 'boom',
			response: { status: 404, data: { error: 'missing' } }
		});

		const { downloadResults } = await import('../dist/utils/brightdata-internal.js');
		await expect(downloadResults('snapx', 'k', 'base')).rejects.toThrow(/BrightData download error: 404/);
	});

	it('downloadResults rethrows non-axios errors', async () => {
		get.mockRejectedValueOnce(new Error('boom'));

		const { downloadResults } = await import('../dist/utils/brightdata-internal.js');
		await expect(downloadResults('snapx', 'k', 'base')).rejects.toThrow('boom');
	});

	it('waitForCompletion polls until ready, reuses cached ready results, and supports timeout/failure', async () => {
		vi.useFakeTimers();
		try {
			let call = 0;
			get.mockImplementation(async (url: string) => {
				call++;
				if (url.endsWith('/progress/s1')) {
					// running then ready
					return call < 3
						? { data: { snapshot_id: 's1', dataset_id: 'd', status: 'running' } }
						: { data: { snapshot_id: 's1', dataset_id: 'd', status: 'ready' } };
				}
				return { data: { snapshot_id: 's2', dataset_id: 'd', status: 'ready' } };
			});

			const { waitForCompletion } = await import('../dist/utils/brightdata-internal.js');

			const p = waitForCompletion(
				[
					{ snapshot_id: 's1', platform: 'instagram' },
					{ snapshot_id: 's2', platform: 'tiktok' }
				],
				'k',
				'base',
				1,
				10
			);

			await vi.advanceTimersByTimeAsync(1000);
			const progress = await p;
			expect(progress.map((p) => p.status).sort()).toEqual(['ready', 'ready']);

			// Failure path
			get.mockResolvedValueOnce({ data: { snapshot_id: 's3', dataset_id: 'd', status: 'failed', message: 'no' } });
			await expect(waitForCompletion([{ snapshot_id: 's3', platform: 'instagram' }], 'k', 'base', 1, 10)).rejects.toThrow(
				/collection failed/i
			);

			// Timeout path (attach rejection handler before advancing timers to avoid unhandled rejections)
			get.mockResolvedValue({ data: { snapshot_id: 's4', dataset_id: 'd', status: 'running' } });
			const timeoutPromise = waitForCompletion([{ snapshot_id: 's4', platform: 'instagram' }], 'k', 'base', 1, 1);
			const timeoutExpectation = expect(timeoutPromise).rejects.toThrow(/Timeout waiting/);
			await vi.advanceTimersByTimeAsync(2000);
			await timeoutExpectation;
		} finally {
			vi.useRealTimers();
		}
	});
});
