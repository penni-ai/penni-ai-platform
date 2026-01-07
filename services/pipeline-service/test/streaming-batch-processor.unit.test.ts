import { beforeEach, describe, expect, it, vi } from 'vitest';

type AxiosResponse = { data: any };

function parseStructuredLogCall(call: unknown[]): Record<string, any> | null {
	const first = call[0];
	if (typeof first !== 'string') return null;
	try {
		const parsed = JSON.parse(first);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
	} catch {
		return null;
	}
}

function expectStructuredLogMessage(spy: ReturnType<typeof vi.spyOn>, message: string) {
	const matched = spy.mock.calls.some((call) => parseStructuredLogCall(call as unknown[])?.message === message);
	expect(matched).toBe(true);
}

const triggerCollection = vi.fn(async () => [{ snapshot_id: 'snap_1', platform: 'instagram' as const }]);

const getCachedProfilesBatch = vi.fn(async () => new Map<string, any>());
const setCachedProfilesBatch = vi.fn(async () => {});
const detectPlatformFromUrl = vi.fn((url: string) => (url.includes('tiktok.com') ? ('tiktok' as const) : ('instagram' as const)));
const extractProfileUrl = vi.fn((profile: any) => profile.url || profile.profile_url || 'https://instagram.com/x/');

vi.mock('../dist/utils/brightdata-internal.js', () => ({
	getBrightDataApiKey: () => 'k',
	getBrightDataBaseUrl: () => 'https://api.example.test',
	triggerCollection: (...args: any[]) => triggerCollection(...args)
}));

vi.mock('../dist/utils/brightdata-cache.js', () => ({
	getCachedProfilesBatch: (...args: any[]) => getCachedProfilesBatch(...args),
	setCachedProfilesBatch: (...args: any[]) => setCachedProfilesBatch(...args),
	detectPlatformFromUrl: (...args: any[]) => detectPlatformFromUrl(...args),
	extractProfileUrl: (...args: any[]) => extractProfileUrl(...args)
}));

const post = vi.fn<Promise<AxiosResponse>, any[]>();
const get = vi.fn<Promise<AxiosResponse>, any[]>();

const axiosMock: any = {
	create: vi.fn(() => ({ post, get })),
	isAxiosError: (err: any) => Boolean(err?.isAxiosError)
};

vi.mock('axios', () => ({ default: axiosMock }));

describe('streaming-batch-processor (unit)', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it('covers snapshot response variants, cache write failures, and process failure accounting', async () => {
		getCachedProfilesBatch.mockResolvedValueOnce(new Map());

		// Force 4 batches (batchSize=1) so we can hit multiple snapshot response shapes.
		triggerCollection
			.mockResolvedValueOnce([{ snapshot_id: 'snap_array', platform: 'instagram' as const }])
			.mockResolvedValueOnce([{ snapshot_id: 'snap_data', platform: 'instagram' as const }])
			.mockResolvedValueOnce([{ snapshot_id: 'snap_results', platform: 'instagram' as const }])
			.mockResolvedValueOnce([{ snapshot_id: 'snap_profiles', platform: 'instagram' as const }]);

		// Make the async cache write fail to hit the warning .catch branch.
		setCachedProfilesBatch.mockRejectedValueOnce(new Error('cache down'));

		get.mockImplementation(async (url: string) => {
			const s = String(url);
			if (s.startsWith('/progress/')) {
				const snapshotId = s.split('/').pop();
				return { data: { snapshot_id: snapshotId, dataset_id: 'ds', status: 'ready' } };
			}
			if (s.startsWith('/snapshot/snap_array')) return { data: [{ url: 'https://instagram.com/a/' }] };
			if (s.startsWith('/snapshot/snap_data')) return { data: { data: [{ url: 'https://instagram.com/b/' }] } };
			if (s.startsWith('/snapshot/snap_results')) return { data: { results: [{ url: 'https://instagram.com/c/' }] } };
			if (s.startsWith('/snapshot/snap_profiles')) return { data: { profiles: [{ url: 'https://instagram.com/d/' }] } };
			throw new Error(`Unexpected GET url: ${url}`);
		});

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const { processBatchedCollectionStreaming } = await import('../dist/utils/streaming-batch-processor.js');
		const result = await processBatchedCollectionStreaming(
			['https://instagram.com/a/', 'https://instagram.com/b/', 'https://instagram.com/c/', 'https://instagram.com/d/'],
			{ batchSize: 1, maxConcurrentBatches: 5, pollingInterval: 0, maxWaitTime: 1 },
			undefined,
			async () => {}
		);

		expect(result.completedBatches).toBeGreaterThanOrEqual(1);
		expect(setCachedProfilesBatch).toHaveBeenCalled();
		expectStructuredLogMessage(warnSpy, 'streaming_batch_cache_failed');
	});

	it('returns early when all urls are cached (calls callback per platform)', async () => {
		const urls = ['https://instagram.com/a/', 'https://tiktok.com/@b'];
		getCachedProfilesBatch.mockResolvedValueOnce(
			new Map([
				[urls[0], { url: urls[0] }],
				[urls[1], { url: urls[1] }]
			])
		);

		const onBatchComplete = vi.fn(async () => {});
		const { processBatchedCollectionStreaming } = await import('../dist/utils/streaming-batch-processor.js');
		const result = await processBatchedCollectionStreaming(urls, { batchSize: 20, maxConcurrentBatches: 5, pollingInterval: 0, maxWaitTime: 1 }, undefined, onBatchComplete);

		expect(result.cacheHits).toBe(2);
		expect(result.totalProfiles).toBe(2);
		expect(result.skippedBrightData).toBeUndefined();
		expect(triggerCollection).not.toHaveBeenCalled();
		expect(onBatchComplete).toHaveBeenCalledTimes(2);
	});

	it('skips BrightData when cache hit rate >= 50%', async () => {
		const urls = ['https://instagram.com/a/', 'https://instagram.com/b/', 'https://instagram.com/c/', 'https://instagram.com/d/'];
		getCachedProfilesBatch.mockResolvedValueOnce(
			new Map([
				[urls[0], { url: urls[0] }],
				[urls[1], { url: urls[1] }]
			])
		);

		const onBatchComplete = vi.fn(async () => {});
		const { processBatchedCollectionStreaming } = await import('../dist/utils/streaming-batch-processor.js');
		const result = await processBatchedCollectionStreaming(urls, { batchSize: 20, maxConcurrentBatches: 5, pollingInterval: 0, maxWaitTime: 1 }, undefined, onBatchComplete);

		expect(result.cacheHits).toBe(2);
		expect(result.skippedBrightData).toBe(true);
		expect(triggerCollection).not.toHaveBeenCalled();
	});

	it('continues with BrightData when cache hit rate < 50% (totalBatches includes cached offset)', async () => {
		const urls = ['https://instagram.com/a/', 'https://instagram.com/b/', 'https://instagram.com/c/'];
		getCachedProfilesBatch.mockResolvedValueOnce(new Map([[urls[0], { url: urls[0] }]]));

		triggerCollection.mockResolvedValueOnce([{ snapshot_id: 'snap_1', platform: 'instagram' as const }]);

		get.mockImplementation(async (url: string) => {
			if (String(url).startsWith('/progress/')) {
				return { data: { snapshot_id: 'snap_1', dataset_id: 'ds', status: 'ready' } };
			}
			if (String(url).startsWith('/snapshot/snap_1')) {
				return { data: [{ url: urls[1] }, { url: urls[2] }] };
			}
			throw new Error(`Unexpected GET url: ${url}`);
		});

		const onBatchComplete = vi.fn(async () => {});
		const { processBatchedCollectionStreaming } = await import('../dist/utils/streaming-batch-processor.js');
		const result = await processBatchedCollectionStreaming(
			urls,
			{ batchSize: 2, maxConcurrentBatches: 5, pollingInterval: 0, maxWaitTime: 1 },
			undefined,
			onBatchComplete
		);

		expect(result.cacheHits).toBe(1);
		expect(result.totalBatches).toBe(2); // 1 cached "batch" + 1 BrightData snapshot
		expect(onBatchComplete).toHaveBeenCalledTimes(2);
	});

	it('triggers BrightData for uncached urls and processes a ready batch', async () => {
		getCachedProfilesBatch.mockResolvedValueOnce(new Map());

		get.mockImplementation(async (url: string) => {
			if (String(url).startsWith('/progress/')) {
				return { data: { snapshot_id: 'snap_1', dataset_id: 'ds', status: 'ready' } };
			}
			if (String(url).startsWith('/snapshot/snap_1')) {
				return { data: [{ url: 'https://instagram.com/a/' }, { url: 'https://instagram.com/b/' }] };
			}
			throw new Error(`Unexpected GET url: ${url}`);
		});

		const onBatchComplete = vi.fn(async () => {});
		const { processBatchedCollectionStreaming } = await import('../dist/utils/streaming-batch-processor.js');
		const result = await processBatchedCollectionStreaming(
			['https://instagram.com/a/', 'https://instagram.com/b/'],
			{ batchSize: 2, maxConcurrentBatches: 5, pollingInterval: 0, maxWaitTime: 1 },
			undefined,
			onBatchComplete
		);

		expect(triggerCollection).toHaveBeenCalledTimes(1);
		expect(onBatchComplete).toHaveBeenCalledTimes(1);
		expect(setCachedProfilesBatch).toHaveBeenCalledTimes(1);
		expect(result.completedBatches).toBeGreaterThanOrEqual(1);
	});

	it('handles tiktok batching, progress check errors, and global timeout', async () => {
		vi.useFakeTimers();
		try {
			getCachedProfilesBatch.mockResolvedValueOnce(new Map());

			// Trigger 2 batches: 1 IG + 1 TikTok (batchSize=1).
			triggerCollection
				.mockResolvedValueOnce([{ snapshot_id: 'snap_ig', platform: 'instagram' as const }])
				.mockResolvedValueOnce([{ snapshot_id: 'snap_tt', platform: 'tiktok' as const }]);

			let progressCalls = 0;
			get.mockImplementation(async (url: string) => {
				const s = String(url);
				if (s.startsWith('/progress/')) {
					progressCalls++;
					// First progress check throws (covered by inner catch), then we immediately time out globally.
					if (progressCalls === 1) {
						throw { isAxiosError: true, message: 'boom', response: { status: 500, data: { error: 'server' } } };
					}
					return { data: { snapshot_id: s.split('/').pop(), dataset_id: 'ds', status: 'running' } };
				}
				throw new Error(`Unexpected GET url: ${url}`);
			});

			const { processBatchedCollectionStreaming } = await import('../dist/utils/streaming-batch-processor.js');
			const promise = processBatchedCollectionStreaming(
				['https://instagram.com/a/', 'https://tiktok.com/@b'],
				// Use non-zero values (the implementation uses `||` defaults).
				{ batchSize: 1, maxConcurrentBatches: 1, pollingInterval: 0.001, maxWaitTime: 0.001 },
				undefined,
				async () => {}
			);

			// Allow the inter-trigger delay (250ms) + at least one poll interval to elapse.
			await vi.advanceTimersByTimeAsync(250);
			await vi.advanceTimersByTimeAsync(5);
			const result = await promise;

			expect(result.failedBatches).toBeGreaterThanOrEqual(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('counts a batch failure when processing throws after a snapshot is marked ready', async () => {
		getCachedProfilesBatch.mockResolvedValueOnce(new Map());
		triggerCollection.mockResolvedValueOnce([{ snapshot_id: 'snap_1', platform: 'instagram' as const }]);

		get.mockImplementation(async (url: string) => {
			if (String(url).startsWith('/progress/')) {
				return { data: { snapshot_id: 'snap_1', dataset_id: 'ds', status: 'ready' } };
			}
			if (String(url).startsWith('/snapshot/snap_1')) {
				throw { isAxiosError: true, message: 'boom', response: { status: 429, data: { error: 'rate' } } };
			}
			throw new Error(`Unexpected GET url: ${url}`);
		});

		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const { processBatchedCollectionStreaming } = await import('../dist/utils/streaming-batch-processor.js');
		const result = await processBatchedCollectionStreaming(
			['https://instagram.com/a/'],
			{ batchSize: 1, maxConcurrentBatches: 5, pollingInterval: 0, maxWaitTime: 1 },
			undefined,
			undefined
		);

		expect(result.failedBatches).toBe(1);
		expectStructuredLogMessage(errorSpy, 'streaming_batch_processing_failed');
		expectStructuredLogMessage(errorSpy, 'streaming_batch_process_failed');
	});

	it('fails fast when no batches can be triggered', async () => {
		getCachedProfilesBatch.mockResolvedValueOnce(new Map());

		// Return a snapshot for the wrong platform so the trigger mapping rejects.
		triggerCollection.mockResolvedValueOnce([{ snapshot_id: 'snap_1', platform: 'tiktok' as const }]);

		const { processBatchedCollectionStreaming } = await import('../dist/utils/streaming-batch-processor.js');
		await expect(
			processBatchedCollectionStreaming(
				['https://instagram.com/a/'],
				{ batchSize: 1, maxConcurrentBatches: 5, pollingInterval: 0, maxWaitTime: 1 },
				undefined,
				async () => {}
			)
		).rejects.toThrow(/Failed to trigger any batches/);
	});

	it('counts failed batches when progress reports failed', async () => {
		getCachedProfilesBatch.mockResolvedValueOnce(new Map());

		get.mockImplementation(async (url: string) => {
			if (String(url).startsWith('/progress/')) {
				return { data: { snapshot_id: 'snap_1', dataset_id: 'ds', status: 'failed' } };
			}
			throw new Error(`Unexpected GET url: ${url}`);
		});

		const { processBatchedCollectionStreaming } = await import('../dist/utils/streaming-batch-processor.js');
		const result = await processBatchedCollectionStreaming(
			['https://instagram.com/a/'],
			{ batchSize: 1, maxConcurrentBatches: 5, pollingInterval: 0, maxWaitTime: 1 },
			undefined,
			async () => {}
		);

		expect(result.failedBatches).toBe(1);
	});

	it('marks batches as failed when they exceed per-batch timeout', async () => {
		vi.useFakeTimers();
		getCachedProfilesBatch.mockResolvedValueOnce(new Map());

		get.mockImplementation(async (url: string) => {
			if (String(url).startsWith('/progress/')) {
				// Return a non-terminal status; the per-batch timeout logic should trip.
				return await new Promise((resolve) =>
					setTimeout(() => resolve({ data: { snapshot_id: 'snap_1', dataset_id: 'ds', status: 'running' } }), 0)
				);
			}
			throw new Error(`Unexpected GET url: ${url}`);
		});

		const { processBatchedCollectionStreaming } = await import('../dist/utils/streaming-batch-processor.js');
		const promise = processBatchedCollectionStreaming(
			['https://instagram.com/a/'],
			{ batchSize: 1, maxConcurrentBatches: 5, pollingInterval: 0, maxWaitTime: 3600 },
			undefined,
			async () => {}
		);

		// Advance time beyond the internal 5-minute batch timeout before the first progress check resolves.
		await vi.advanceTimersByTimeAsync(301_000);
		const result = await promise;
		expect(result.failedBatches).toBe(1);

		vi.useRealTimers();
	});

	it('exposes defensive non-array checks by forcing Array.isArray to return false', async () => {
		const originalIsArray = Array.isArray;
		try {
			getCachedProfilesBatch.mockResolvedValueOnce(new Map());
			triggerCollection.mockResolvedValueOnce([{ snapshot_id: 'snap_1', platform: 'instagram' as const }]);

			get.mockImplementation(async (url: string) => {
				if (String(url).startsWith('/progress/')) {
					return { data: { snapshot_id: 'snap_1', dataset_id: 'ds', status: 'ready' } };
				}
				if (String(url).startsWith('/snapshot/snap_1')) {
					return { data: [{ url: 'https://instagram.com/a/' }] };
				}
				throw new Error(`Unexpected GET url: ${url}`);
			});

			(Array as any).isArray = () => false;

			const { processBatchedCollectionStreaming } = await import('../dist/utils/streaming-batch-processor.js');
			const result = await processBatchedCollectionStreaming(
				['https://instagram.com/a/'],
				{ batchSize: 1, maxConcurrentBatches: 5, pollingInterval: 0, maxWaitTime: 1 },
				undefined,
				async () => {}
			);

			expect(result.completedBatches).toBe(0);
			expect(result.failedBatches).toBe(1);
		} finally {
			(Array as any).isArray = originalIsArray;
		}
	});

	it('uses defaults, supports timing tracker, and detects TikTok urls', async () => {
		getCachedProfilesBatch.mockResolvedValueOnce(new Map());
		triggerCollection.mockResolvedValueOnce([{ snapshot_id: 'snap_tt', platform: 'tiktok' as const }]);

		get.mockImplementation(async (url: string) => {
			if (String(url).startsWith('/progress/')) {
				return { data: { snapshot_id: 'snap_tt', dataset_id: 'ds', status: 'ready' } };
			}
			if (String(url).startsWith('/snapshot/snap_tt')) {
				return { data: [{ url: 'https://tiktok.com/@a' }] };
			}
			throw new Error(`Unexpected GET url: ${url}`);
		});

		const timingTracker = {
			startSubStage: vi.fn(),
			endSubStage: vi.fn()
		};

		const { processBatchedCollectionStreaming } = await import('../dist/utils/streaming-batch-processor.js');
		const result = await processBatchedCollectionStreaming(
			['https://tiktok.com/@a'],
			{}, // default config branches
			timingTracker as any,
			async () => {}
		);

		expect(result.completedBatches).toBe(1);
		expect(timingTracker.startSubStage).toHaveBeenCalledWith('brightdata_collection', 'batch_triggering');
		expect(timingTracker.endSubStage).toHaveBeenCalledWith('brightdata_collection', 'batch_triggering');
	});

	it('counts failures when snapshot download throws a non-axios error', async () => {
		getCachedProfilesBatch.mockResolvedValueOnce(new Map());
		triggerCollection.mockResolvedValueOnce([{ snapshot_id: 'snap_1', platform: 'instagram' as const }]);

		get.mockImplementation(async (url: string) => {
			if (String(url).startsWith('/progress/')) {
				return { data: { snapshot_id: 'snap_1', dataset_id: 'ds', status: 'ready' } };
			}
			if (String(url).startsWith('/snapshot/snap_1')) {
				throw new Error('boom');
			}
			throw new Error(`Unexpected GET url: ${url}`);
		});

		const { processBatchedCollectionStreaming } = await import('../dist/utils/streaming-batch-processor.js');
		const result = await processBatchedCollectionStreaming(
			['https://instagram.com/a/'],
			{ batchSize: 1, maxConcurrentBatches: 5, pollingInterval: 0.001, maxWaitTime: 0.001 },
			undefined,
			async () => {}
		);

		expect(result.failedBatches).toBe(1);
	});

	it('logs progress check errors for non-axios throws and handles non-object snapshot responses', async () => {
		vi.useFakeTimers();
		try {
			getCachedProfilesBatch.mockResolvedValueOnce(new Map());
			triggerCollection.mockResolvedValueOnce([{ snapshot_id: 'snap_1', platform: 'instagram' as const }]);

			get.mockImplementation(async (url: string) => {
				if (String(url).startsWith('/progress/')) {
					throw new Error('progress boom');
				}
				if (String(url).startsWith('/snapshot/')) {
					return { data: null };
				}
				throw new Error(`Unexpected GET url: ${url}`);
			});

			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			const { processBatchedCollectionStreaming } = await import('../dist/utils/streaming-batch-processor.js');
			const promise = processBatchedCollectionStreaming(
				['https://instagram.com/a/'],
				{ batchSize: 1, maxConcurrentBatches: 5, pollingInterval: 0.001, maxWaitTime: 0.001 },
				undefined,
				async () => {}
			);

			await vi.advanceTimersByTimeAsync(5);
			const result = await promise;

			expect(result.failedBatches).toBe(1);
			expectStructuredLogMessage(errorSpy, 'streaming_snapshot_check_failed');
			expectStructuredLogMessage(errorSpy, 'streaming_batches_timeout');
		} finally {
			vi.useRealTimers();
		}
	});

	it('returns empty results for snapshots with unexpected response types (null)', async () => {
		getCachedProfilesBatch.mockResolvedValueOnce(new Map());
		triggerCollection.mockResolvedValueOnce([{ snapshot_id: 'snap_1', platform: 'instagram' as const }]);

		get.mockImplementation(async (url: string) => {
			if (String(url).startsWith('/progress/')) {
				return { data: { snapshot_id: 'snap_1', dataset_id: 'ds', status: 'ready' } };
			}
			if (String(url).startsWith('/snapshot/snap_1')) {
				return { data: null };
			}
			throw new Error(`Unexpected GET url: ${url}`);
		});

		const onBatchComplete = vi.fn(async () => {});
		const { processBatchedCollectionStreaming } = await import('../dist/utils/streaming-batch-processor.js');
		const result = await processBatchedCollectionStreaming(
			['https://instagram.com/a/'],
			{ batchSize: 1, maxConcurrentBatches: 5, pollingInterval: 0.001, maxWaitTime: 0.001 },
			undefined,
			onBatchComplete
		);

		expect(result.totalProfiles).toBe(0);
		expect(onBatchComplete).toHaveBeenCalledWith(
			expect.objectContaining({ profiles: [] })
		);
	});

	it('hits the defensive "profiles is not an array" branch by forcing Array.isArray false on validation', async () => {
		const originalIsArray = Array.isArray;
		try {
			getCachedProfilesBatch.mockResolvedValueOnce(new Map());
			triggerCollection.mockResolvedValueOnce([{ snapshot_id: 'snap_1', platform: 'instagram' as const }]);

			let calls = 0;
			(Array as any).isArray = (value: any) => {
				calls++;
				// Allow the "data is array" check, but fail the final "profiles is array" validation.
				if (calls === 2) return false;
				return originalIsArray(value);
			};

			get.mockImplementation(async (url: string) => {
				if (String(url).startsWith('/progress/')) {
					return { data: { snapshot_id: 'snap_1', dataset_id: 'ds', status: 'ready' } };
				}
				if (String(url).startsWith('/snapshot/snap_1')) {
					return { data: [{ url: 'https://instagram.com/a/' }] };
				}
				throw new Error(`Unexpected GET url: ${url}`);
			});

			const { processBatchedCollectionStreaming } = await import('../dist/utils/streaming-batch-processor.js');
			const result = await processBatchedCollectionStreaming(
				['https://instagram.com/a/'],
				{ batchSize: 1, maxConcurrentBatches: 5, pollingInterval: 0.001, maxWaitTime: 0.001 },
				undefined,
				async () => {}
			);

			expect(result.totalProfiles).toBe(0);
		} finally {
			(Array as any).isArray = originalIsArray;
		}
	});

	it('ignores urls that do not match any supported platform', async () => {
		getCachedProfilesBatch.mockResolvedValueOnce(new Map());
		triggerCollection.mockResolvedValueOnce([{ snapshot_id: 'snap_1', platform: 'instagram' as const }]);

		get.mockImplementation(async (url: string) => {
			if (String(url).startsWith('/progress/')) {
				return { data: { snapshot_id: 'snap_1', dataset_id: 'ds', status: 'ready' } };
			}
			if (String(url).startsWith('/snapshot/snap_1')) {
				return { data: [{ url: 'https://instagram.com/a/' }] };
			}
			throw new Error(`Unexpected GET url: ${url}`);
		});

		const { processBatchedCollectionStreaming } = await import('../dist/utils/streaming-batch-processor.js');
		const result = await processBatchedCollectionStreaming(
			['https://example.com/nope', 'https://instagram.com/a/'],
			{ batchSize: 1, maxConcurrentBatches: 5, pollingInterval: 0.001, maxWaitTime: 0.001 },
			undefined,
			async () => {}
		);

		expect(result.totalProfiles).toBe(1);
	});
});
