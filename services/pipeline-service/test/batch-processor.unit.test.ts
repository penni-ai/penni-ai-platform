import { beforeEach, describe, expect, it, vi } from 'vitest';

type AxiosResponse = { data: any };

const post = vi.fn<Promise<AxiosResponse>, any[]>();
const get = vi.fn<Promise<AxiosResponse>, any[]>();

const axiosMock: any = {
	create: vi.fn(() => ({ post, get })),
	isAxiosError: (err: any) => Boolean(err?.isAxiosError)
};

vi.mock('axios', () => ({ default: axiosMock }));

describe('batch-processor (unit)', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		process.env.BRIGHTDATA_API_KEY = 'k';
		process.env.BRIGHTDATA_BASE_URL = 'https://api.example.test';
		process.env.BRIGHTDATA_INSTAGRAM_DATASET_ID = 'ig_ds';
		process.env.BRIGHTDATA_TIKTOK_DATASET_ID = 'tk_ds';
	});

	it('processBatchedCollection triggers, polls, and downloads profiles', async () => {
		// Trigger: one IG batch and one TikTok batch.
		post.mockResolvedValueOnce({ data: { snapshot_id: 'ig_snap' } });
		post.mockResolvedValueOnce({ data: { snapshot_id: 'tk_snap' } });

		// Progress: both ready immediately.
		get.mockImplementation(async (url: string) => {
			if (String(url).startsWith('/progress/')) {
				const snapshotId = String(url).split('/').pop();
				return { data: { snapshot_id: snapshotId, dataset_id: 'ds', status: 'ready' } };
			}
			if (String(url).startsWith('/snapshot/ig_snap')) {
				return { data: [{ platform: 'instagram', account: 'a' }, { platform: 'instagram', account: 'b' }] };
			}
			if (String(url).startsWith('/snapshot/tk_snap')) {
				return { data: [{ platform: 'tiktok', account_id: 'c' }] };
			}
			throw new Error(`Unexpected GET url: ${url}`);
		});

		const { processBatchedCollection } = await import('../dist/utils/batch-processor.js');

		const result = await processBatchedCollection(
			['https://instagram.com/a/', 'https://instagram.com/b/', 'https://tiktok.com/@c'],
			{ batchSize: 2, maxConcurrentBatches: 10, pollingInterval: 0, maxWaitTime: 1 }
		);

		expect(result.stats.total_batches).toBe(2);
		expect(result.snapshots).toHaveLength(2);
		expect(result.profiles).toHaveLength(3);
		expect(post).toHaveBeenCalledTimes(2);
	});

	it('ignores unknown urls and fails when snapshot_id cannot be extracted', async () => {
		// Trigger returns an unexpected response shape (no snapshot_id / snapshot string).
		post.mockResolvedValueOnce({ data: { unexpected: true } });

		const { processBatchedCollection } = await import('../dist/utils/batch-processor.js');

		await expect(
			processBatchedCollection(['https://example.com/nope', 'https://instagram.com/a/'], {
				batchSize: 20,
				maxConcurrentBatches: 10,
				pollingInterval: 0,
				maxWaitTime: 1
			})
		).rejects.toThrow(/Failed to trigger any batches/);
	});

	it('tolerates non-axios trigger errors as failed batches', async () => {
		post.mockRejectedValueOnce(new Error('boom'));

		const { processBatchedCollection } = await import('../dist/utils/batch-processor.js');

		await expect(
			processBatchedCollection(['https://instagram.com/a/'], { batchSize: 20, maxConcurrentBatches: 10, pollingInterval: 0, maxWaitTime: 1 })
		).rejects.toThrow(/Failed to trigger any batches/);
	});

	it('respects trigger/download chunk delays when maxConcurrentBatches=1', async () => {
		vi.useFakeTimers();
		try {
			post.mockResolvedValueOnce({ data: { snapshot_id: 'snap_1' } });
			post.mockResolvedValueOnce({ data: { snapshot_id: 'snap_2' } });

			get.mockImplementation(async (url: string) => {
				if (String(url).startsWith('/progress/')) {
					const snapshotId = String(url).split('/').pop();
					return { data: { snapshot_id: snapshotId, dataset_id: 'ds', status: 'ready' } };
				}
				if (String(url).startsWith('/snapshot/snap_1')) {
					return { data: [{ platform: 'instagram', account: 'a' }] };
				}
				if (String(url).startsWith('/snapshot/snap_2')) {
					return { data: [{ platform: 'instagram', account: 'b' }] };
				}
				throw new Error(`Unexpected GET url: ${url}`);
			});

			const { processBatchedCollection } = await import('../dist/utils/batch-processor.js');

			const promise = processBatchedCollection(['https://instagram.com/a/', 'https://instagram.com/b/'], {
				batchSize: 1,
				maxConcurrentBatches: 1,
				pollingInterval: 0,
				maxWaitTime: 10
			});

			// Trigger chunk delay: 1000ms, download chunk delay: 500ms.
			await vi.advanceTimersByTimeAsync(1500);

			const result = await promise;
			expect(result.stats.total_batches).toBe(2);
			expect(result.profiles).toHaveLength(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('polls snapshots across iterations, reuses cached ready results, and waits between polls', async () => {
		vi.useFakeTimers();
		try {
			post.mockResolvedValueOnce({ data: { snapshot_id: 'snap_1' } });
			post.mockResolvedValueOnce({ data: { snapshot_id: 'snap_2' } });

			let snap2Calls = 0;
			let snap1Calls = 0;
			get.mockImplementation(async (url: string) => {
				if (String(url).startsWith('/progress/snap_1')) {
					snap1Calls++;
					return { data: { snapshot_id: 'snap_1', dataset_id: 'ds', status: 'ready' } };
				}
				if (String(url).startsWith('/progress/snap_2')) {
					snap2Calls++;
					return {
						data: {
							snapshot_id: 'snap_2',
							dataset_id: 'ds',
							status: snap2Calls < 2 ? 'running' : 'ready'
						}
					};
				}
				if (String(url).startsWith('/snapshot/')) {
					return { data: [{ ok: true }] };
				}
				throw new Error(`Unexpected GET url: ${url}`);
			});

			const { processBatchedCollection } = await import('../dist/utils/batch-processor.js');
			const promise = processBatchedCollection(['https://instagram.com/a/', 'https://instagram.com/b/'], {
				batchSize: 1,
				maxConcurrentBatches: 5,
				pollingInterval: 1,
				maxWaitTime: 10
			});

			await vi.advanceTimersByTimeAsync(1000);
			const result = await promise;

			expect(result.stats.total_batches).toBe(2);
			expect(snap2Calls).toBeGreaterThanOrEqual(2);
			// snap_1 should only be queried once (subsequent polls reuse the cached ready status).
			expect(snap1Calls).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('logs failed snapshots and throws on polling timeout', async () => {
		vi.useFakeTimers();
		try {
			post.mockResolvedValueOnce({ data: { snapshot_id: 'snap_1' } });
			post.mockResolvedValueOnce({ data: { snapshot_id: 'snap_2' } });

			get.mockImplementation(async (url: string) => {
				if (String(url).startsWith('/progress/snap_1')) {
					return { data: { snapshot_id: 'snap_1', dataset_id: 'ds', status: 'failed' } };
				}
				if (String(url).startsWith('/progress/snap_2')) {
					return { data: { snapshot_id: 'snap_2', dataset_id: 'ds', status: 'running' } };
				}
				throw new Error(`Unexpected GET url: ${url}`);
			});

			const { processBatchedCollection } = await import('../dist/utils/batch-processor.js');

			const promise = processBatchedCollection(['https://instagram.com/a/', 'https://instagram.com/b/'], {
				batchSize: 1,
				maxConcurrentBatches: 5,
				pollingInterval: 1,
				maxWaitTime: 1
			});

			const rejection = expect(promise).rejects.toThrow(/Timeout waiting for all snapshots/);
			await vi.advanceTimersByTimeAsync(1000);
			await rejection;
		} finally {
			vi.useRealTimers();
		}
	});

	it('surfaces progress check errors (axios and non-axios)', async () => {
		post.mockResolvedValueOnce({ data: { snapshot_id: 'snap_1' } });

		get.mockRejectedValueOnce({
			isAxiosError: true,
			message: 'boom',
			response: { status: 500, data: { error: 'server' } }
		});

		const { processBatchedCollection } = await import('../dist/utils/batch-processor.js');
		await expect(
			processBatchedCollection(['https://instagram.com/a/'], { batchSize: 20, maxConcurrentBatches: 5, pollingInterval: 0, maxWaitTime: 1 })
		).rejects.toThrow(/BrightData progress check error: 500/);

		vi.resetModules();
		vi.clearAllMocks();
		process.env.BRIGHTDATA_API_KEY = 'k';
		process.env.BRIGHTDATA_BASE_URL = 'https://api.example.test';
		process.env.BRIGHTDATA_INSTAGRAM_DATASET_ID = 'ig_ds';
		process.env.BRIGHTDATA_TIKTOK_DATASET_ID = 'tk_ds';

		post.mockResolvedValueOnce({ data: { snapshot_id: 'snap_1' } });
		get.mockRejectedValueOnce(new Error('boom'));

		const mod2 = await import('../dist/utils/batch-processor.js');
		await expect(
			mod2.processBatchedCollection(['https://instagram.com/a/'], { batchSize: 20, maxConcurrentBatches: 5, pollingInterval: 0, maxWaitTime: 1 })
		).rejects.toThrow('boom');
	});

	it('handles snapshot download wrappers, fallback return path, and logs failed downloads', async () => {
		const originalIsArray = Array.isArray;
		try {
			post.mockResolvedValueOnce({ data: { snapshot_id: 'snap_data' } });
			post.mockResolvedValueOnce({ data: { snapshot_id: 'snap_results' } });
			post.mockResolvedValueOnce({ data: { snapshot_id: 'snap_err' } });
			post.mockResolvedValueOnce({ data: { snapshot_id: 'snap_non_axios_err' } });

			let isArrayCalls = 0;
			(Array as any).isArray = (value: any) => {
				isArrayCalls++;
				// Force the first snapshot array check to fall through to the raw-data return branch.
				if (isArrayCalls === 1) return false;
				return originalIsArray(value);
			};

			get.mockImplementation(async (url: string) => {
				if (String(url).startsWith('/progress/')) {
					const snapshotId = String(url).split('/').pop();
					return { data: { snapshot_id: snapshotId, dataset_id: 'ds', status: 'ready' } };
				}
				if (String(url).startsWith('/snapshot/snap_data')) {
					return { data: { data: [{ a: 1 }] } };
				}
				if (String(url).startsWith('/snapshot/snap_results')) {
					return { data: { results: [{ b: 2 }] } };
				}
				if (String(url).startsWith('/snapshot/snap_err')) {
					throw {
						isAxiosError: true,
						message: 'boom',
						response: { status: 404, data: { error: 'missing' } }
					};
				}
				if (String(url).startsWith('/snapshot/snap_non_axios_err')) {
					throw new Error('non-axios download boom');
				}
				throw new Error(`Unexpected GET url: ${url}`);
			});

			const { processBatchedCollection } = await import('../dist/utils/batch-processor.js');
			const out = await processBatchedCollection(
				['https://instagram.com/a/', 'https://instagram.com/b/', 'https://instagram.com/c/', 'https://instagram.com/d/'],
				{ batchSize: 1, maxConcurrentBatches: 5, pollingInterval: 0, maxWaitTime: 10 }
			);

			// Two successful downloads + one failed download should still return best-effort results.
			expect(out.profiles).toEqual(expect.arrayContaining([{ a: 1 }, { b: 2 }]));
		} finally {
			(Array as any).isArray = originalIsArray;
		}
	});

	it('supports iterable (non-array) snapshot fallback responses', async () => {
		post.mockResolvedValueOnce({ data: { snapshot_id: 'snap_iterable' } });

		get.mockImplementation(async (url: string) => {
			if (String(url).startsWith('/progress/')) {
				return { data: { snapshot_id: 'snap_iterable', dataset_id: 'ds', status: 'ready' } };
			}
			if (String(url).startsWith('/snapshot/snap_iterable')) {
				// Array.isArray === false, but iterable via Set; should hit the fallback return branch.
				return { data: new Set([{ ok: true }]) };
			}
			throw new Error(`Unexpected GET url: ${url}`);
		});

		const { processBatchedCollection } = await import('../dist/utils/batch-processor.js');
		const out = await processBatchedCollection(['https://instagram.com/a/'], {
			batchSize: 1,
			maxConcurrentBatches: 5,
			pollingInterval: 0,
			maxWaitTime: 10
		});

		expect(out.profiles).toEqual(expect.arrayContaining([{ ok: true }]));
	});

	it('throws when no batches can be triggered', async () => {
		post.mockRejectedValue({
			isAxiosError: true,
			message: 'bad request',
			response: { status: 400, data: { error: 'bad' } }
		});

		const { processBatchedCollection } = await import('../dist/utils/batch-processor.js');

		await expect(
			processBatchedCollection(['https://instagram.com/a/'], { batchSize: 20, maxConcurrentBatches: 10, pollingInterval: 0, maxWaitTime: 1 })
		).rejects.toThrow(/Failed to trigger any batches/);
	});
});
