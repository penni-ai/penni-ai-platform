import { beforeEach, describe, expect, it, vi } from 'vitest';

const hybrid = vi.fn();

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

const client: any = {
	isReady: vi.fn(async () => true),
	collections: {
		get: vi.fn(() => ({
			query: { hybrid }
		}))
	}
};

const connectToWeaviateCloud = vi.fn(async () => client);
class ApiKey {
	constructor(public key: string) {}
}

vi.mock('weaviate-client', () => ({
	default: { connectToWeaviateCloud, ApiKey }
}));

describe('weaviate-search (unit)', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();

		process.env.WEAVIATE_URL = 'https://weaviate.example.test';
		process.env.WEAVIATE_API_KEY = 'wv-key';
		process.env.DEEPINFRA_API_KEY = 'di-key';
		process.env.WEAVIATE_COLLECTION_NAME = 'influencer_profiles';
		process.env.DEEPINFRA_EMBEDDING_MODEL = 'model-x';
		process.env.MAX_CONCURRENT_WEAVIATE_SEARCHES = '24';
	});

	it('throws when required Weaviate env vars are missing', async () => {
		delete process.env.WEAVIATE_URL;
		const { getWeaviateClientInstance } = await import('../dist/utils/weaviate-search.js');
		await expect(getWeaviateClientInstance()).rejects.toThrow(/WEAVIATE_URL environment variable is required/);

		vi.resetModules();
		process.env.WEAVIATE_URL = 'https://weaviate.example.test';
		delete process.env.WEAVIATE_API_KEY;
		const mod2 = await import('../dist/utils/weaviate-search.js');
		await expect(mod2.getWeaviateClientInstance()).rejects.toThrow(/WEAVIATE_API_KEY environment variable is required/);
	});

	it('throws when required DeepInfra env vars are missing', async () => {
		delete process.env.DEEPINFRA_API_KEY;
		const { generateQueryEmbedding } = await import('../dist/utils/weaviate-search.js');
		await expect(generateQueryEmbedding('q')).rejects.toThrow(/DEEPINFRA_API_KEY environment variable is required/);
	});

	it('generateQueryEmbedding returns an embedding and surfaces errors', async () => {
		const fetchOk = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({ data: [{ embedding: [1, 2, 3] }] })
		}));
		vi.stubGlobal('fetch', fetchOk as any);

		const { generateQueryEmbedding } = await import('../dist/utils/weaviate-search.js');
		const embedding = await generateQueryEmbedding('coffee');
		expect(embedding).toEqual([1, 2, 3]);

		const fetchBad = vi.fn(async () => ({
			ok: false,
			status: 500,
			statusText: 'Server Error',
			text: async () => 'boom'
		}));
		vi.stubGlobal('fetch', fetchBad as any);

		await expect(generateQueryEmbedding('coffee')).rejects.toThrow(/DeepInfra API error: 500/);
		vi.unstubAllGlobals();
	});

	it('generateQueryEmbedding throws on invalid DeepInfra response format', async () => {
		const fetchOk = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({})
		}));
		vi.stubGlobal('fetch', fetchOk as any);

		const { generateQueryEmbedding } = await import('../dist/utils/weaviate-search.js');
		await expect(generateQueryEmbedding('coffee')).rejects.toThrow(/invalid response format/);
		vi.unstubAllGlobals();
	});

	it('generateQueryEmbeddingsBatch returns a map of query->embedding', async () => {
		const fetchOk = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({ data: [{ embedding: [1] }, { embedding: [2] }] })
		}));
		vi.stubGlobal('fetch', fetchOk as any);

		const { generateQueryEmbeddingsBatch } = await import('../dist/utils/weaviate-search.js');
		const map = await generateQueryEmbeddingsBatch(['a', 'b']);
		expect(map.get('a')).toEqual([1]);
		expect(map.get('b')).toEqual([2]);
		vi.unstubAllGlobals();
	});

	it('generateQueryEmbeddingsBatch returns empty map for empty input and errors on length mismatch', async () => {
		const { generateQueryEmbeddingsBatch } = await import('../dist/utils/weaviate-search.js');
		expect((await generateQueryEmbeddingsBatch([])).size).toBe(0);

		const fetchOk = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({ data: [{ embedding: [1] }] })
		}));
		vi.stubGlobal('fetch', fetchOk as any);

		await expect(generateQueryEmbeddingsBatch(['a', 'b'])).rejects.toThrow(/expected 2 embeddings/);
		vi.unstubAllGlobals();
	});

	it('generateQueryEmbeddingsBatch surfaces DeepInfra HTTP errors', async () => {
		const fetchBad = vi.fn(async () => ({
			ok: false,
			status: 500,
			statusText: 'Server Error',
			text: async () => 'boom'
		}));
		vi.stubGlobal('fetch', fetchBad as any);

		const { generateQueryEmbeddingsBatch } = await import('../dist/utils/weaviate-search.js');
		await expect(generateQueryEmbeddingsBatch(['a'])).rejects.toThrow(/DeepInfra API error: 500/);

		vi.unstubAllGlobals();
	});

	it('performSingleHybridSearch builds filters, applies exclusions, and returns expected shape', async () => {
		hybrid.mockResolvedValueOnce({
			objects: [
				{
					uuid: 'u1',
					metadata: { score: 0.8, distance: 0.2 },
					properties: {
						profile_url: 'https://instagram.com/exclude/',
						platform: 'instagram',
						display_name: 'X',
						biography: 'bio',
						followers: 123
					}
				},
				{
					uuid: 'u2',
					metadata: { score: 0.7, distance: 0.3 },
					properties: {
						profile_url: 'https://instagram.com/keep/',
						platform: 'instagram',
						display_name: 'Y',
						biography: 'bio2',
						followers: 456
					}
				}
			]
		});

		const { performSingleHybridSearch } = await import('../dist/utils/weaviate-search.js');
		const embeddingMap = new Map([['coffee', [0.1, 0.2]]]);

		const res = await performSingleHybridSearch(
			'coffee',
			0.2,
			1,
			10,
			1000,
			'instagram',
			embeddingMap,
			['https://instagram.com/exclude/']
		);

		expect(res.count).toBe(1);
		expect(res.results).toHaveLength(1);
		expect(res.results[0].data.profile_url).toBe('https://instagram.com/keep/');

		const passedOptions = hybrid.mock.calls[0]?.[1];
		expect(passedOptions.limit).toBe(2); // adjustedLimit = limit + exclusions.length
		expect(passedOptions.where).toEqual({
			operator: 'And',
			operands: [
				{ path: ['followers'], operator: 'GreaterThanEqual', valueNumber: 10 },
				{ path: ['followers'], operator: 'LessThanEqual', valueNumber: 1000 },
				{ path: ['platform'], operator: 'Equal', valueString: 'instagram' }
			]
		});
	});

	it('performSingleHybridSearch generates embedding when missing from embeddingMap and uses single-condition where', async () => {
		const fetchOk = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({ data: [{ embedding: [1, 2] }] })
		}));
		vi.stubGlobal('fetch', fetchOk as any);

		hybrid.mockResolvedValueOnce({ objects: [] });

		const { performSingleHybridSearch } = await import('../dist/utils/weaviate-search.js');
		const embeddingMap = new Map([['other', [0.1]]]);

		await performSingleHybridSearch('coffee', 0.2, 1, 10, null, null, embeddingMap, null);
		const passedOptions = hybrid.mock.calls[0]?.[1];
		expect(passedOptions.where).toEqual({ path: ['followers'], operator: 'GreaterThanEqual', valueNumber: 10 });

		vi.unstubAllGlobals();
	});

	it('getWeaviateClientInstance resets client when not ready and reuses init promise', async () => {
		// 1) Initialize OK
		client.isReady
			.mockResolvedValueOnce(true) // after connect during initial init
			.mockResolvedValueOnce(false) // cached client readiness check
			.mockResolvedValueOnce(true); // after connect during re-init

		const { getWeaviateClientInstance } = await import('../dist/utils/weaviate-search.js');
		await getWeaviateClientInstance();
		await getWeaviateClientInstance();
		expect(connectToWeaviateCloud).toHaveBeenCalledTimes(2);

		// 2) Promise reuse: second call during init returns the same promise
		vi.resetModules();
		vi.clearAllMocks();
		process.env.WEAVIATE_URL = 'https://weaviate.example.test';
		process.env.WEAVIATE_API_KEY = 'wv-key';
		process.env.DEEPINFRA_API_KEY = 'di-key';

		let resolveConnect: (value: any) => void = () => {};
		connectToWeaviateCloud.mockImplementationOnce(async () => {
			return await new Promise((resolve) => {
				resolveConnect = resolve;
			});
		});
		client.isReady.mockResolvedValue(true);

		const mod2 = await import('../dist/utils/weaviate-search.js');
		const p1 = mod2.getWeaviateClientInstance();
		const p2 = mod2.getWeaviateClientInstance();
		expect(connectToWeaviateCloud).toHaveBeenCalledTimes(1);
		resolveConnect(client);
		await expect(Promise.all([p1, p2])).resolves.toEqual([client, client]);
	});

	it('getWeaviateClientInstance throws when Weaviate reports not ready', async () => {
		client.isReady.mockResolvedValueOnce(false);
		const { getWeaviateClientInstance } = await import('../dist/utils/weaviate-search.js');
		await expect(getWeaviateClientInstance()).rejects.toThrow(/Failed to establish connection to Weaviate/);
	});

	it('performParallelHybridSearches runs searches and deduplicates by profile_url', async () => {
		const fetchOk = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({
				data: [{ embedding: [0.1] }, { embedding: [0.2] }]
			})
		}));
		vi.stubGlobal('fetch', fetchOk as any);

		// Two searches: both return same profile_url but different scores.
		hybrid
			.mockResolvedValueOnce({
				objects: [
					{
						uuid: 'u1',
						metadata: { score: 0.8, distance: 0.2 },
						properties: { profile_url: 'https://instagram.com/dup/', platform: 'instagram' }
					}
				]
			})
			.mockResolvedValueOnce({
				objects: [
					{
						uuid: 'u2',
						metadata: { score: 0.95, distance: 0.1 },
						properties: { profile_url: 'https://instagram.com/dup/', platform: 'instagram' }
					}
				]
			});

		const onProgressUpdate = vi.fn(async () => {});
		const { performParallelHybridSearches } = await import('../dist/utils/weaviate-search.js');

		const out = await performParallelHybridSearches(['a', 'b'], [0.2], 1, null, null, null, undefined, onProgressUpdate);

		expect(onProgressUpdate).toHaveBeenCalledWith('embedding_generation');
		expect(onProgressUpdate).toHaveBeenCalledWith('searches_complete');

		expect(out.queriesExecuted).toBe(2);
		expect(out.deduplicatedResults).toHaveLength(1);
		expect(out.deduplicatedResults[0].score).toBe(0.95);
		vi.unstubAllGlobals();
	});

	it('performParallelHybridSearches tolerates progress update failures and records timing stages', async () => {
		const fetchOk = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({ data: [{ embedding: [0.1] }] })
		}));
		vi.stubGlobal('fetch', fetchOk as any);

		hybrid.mockResolvedValueOnce({ objects: [] });

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const timingTracker = {
			getPipelineStartTime: vi.fn(() => Date.now() / 1000),
			startSubStage: vi.fn(),
			endSubStage: vi.fn()
		};
		const onProgressUpdate = vi.fn(async () => {
			throw new Error('boom');
		});

		const { performParallelHybridSearches } = await import('../dist/utils/weaviate-search.js');
		await performParallelHybridSearches(['a'], [0.2], 1, null, null, null, timingTracker as any, onProgressUpdate, null);

		expect(timingTracker.startSubStage).toHaveBeenCalled();
		expect(timingTracker.endSubStage).toHaveBeenCalled();
		expectStructuredLogMessage(warnSpy, 'weaviate_progress_update_failed');

		warnSpy.mockRestore();
		vi.unstubAllGlobals();
	});

	it('performParallelHybridSearches records per-search errors and handles rejected batch promises', async () => {
		const fetchOk = vi.fn(async () => ({
			ok: true,
			status: 200,
			statusText: 'OK',
			json: async () => ({ data: [{ embedding: [0.1] }] })
		}));
		vi.stubGlobal('fetch', fetchOk as any);

		// Per-search failure: hybrid rejects and the catch returns {success:false}
		hybrid.mockRejectedValueOnce(new Error('hybrid boom'));

		const { performParallelHybridSearches } = await import('../dist/utils/weaviate-search.js');
		const out = await performParallelHybridSearches(['a'], [0.2], 1);
		expect(out.queriesExecuted).toBe(0);

		// Rejected batch promise: make the catch handler throw by throwing from console.error once.
		vi.resetModules();
		vi.clearAllMocks();
		process.env.WEAVIATE_URL = 'https://weaviate.example.test';
		process.env.WEAVIATE_API_KEY = 'wv-key';
		process.env.DEEPINFRA_API_KEY = 'di-key';

		hybrid.mockRejectedValueOnce(new Error('hybrid boom'));
		const errSpy = vi.spyOn(console, 'error').mockImplementationOnce(() => {
			throw new Error('console broke');
		});

		const mod2 = await import('../dist/utils/weaviate-search.js');
		await mod2.performParallelHybridSearches(['a'], [0.2], 1);
		errSpy.mockRestore();

		vi.unstubAllGlobals();
	});

	it('sleep resolves after the requested delay', async () => {
		vi.useFakeTimers();
		try {
			const { sleep } = await import('../dist/utils/weaviate-search.js');

			const promise = sleep(123).then(() => 'ok');
			await vi.advanceTimersByTimeAsync(123);
			await expect(promise).resolves.toBe('ok');
		} finally {
			vi.useRealTimers();
		}
	});
});
