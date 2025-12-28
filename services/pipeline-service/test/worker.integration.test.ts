import { describe, expect, it, vi } from 'vitest';

function makeUrls(count: number, prefix: string): string[] {
	return Array.from({ length: count }, (_, i) => `https://instagram.com/${prefix}_${i}/`);
}

function makeWeaviateResults(urls: string[]): any[] {
	return urls.map((url, i) => ({
		id: `w_${i}`,
		data: {
			profile_url: url,
			platform: 'instagram',
			display_name: `User ${i}`,
			biography: `Bio ${i}`,
			followers: 1000 + i
		}
	}));
}

function makeInstagramRaw(url: string, i: number, prefix: string): any {
	return {
		account: `${prefix}_${i}`,
		fbid: `fb_${i}`,
		id: `ig_${i}`,
		followers: 1000 + i,
		posts_count: 10,
		is_business_account: false,
		is_professional_account: false,
		is_verified: false,
		avg_engagement: 0.01,
		external_url: null,
		biography: `Bio ${i}`,
		business_category_name: null,
		category_name: null,
		post_hashtags: null,
		following: 100,
		posts: [],
		profile_image_link: null,
		profile_url: url,
		profile_name: `User ${i}`,
		highlights_count: 0,
		highlights: null,
		full_name: `User ${i}`,
		is_private: false,
		bio_hashtags: null,
		url,
		is_joined_recently: false,
		has_channel: false,
		partner_id: 'p',
		business_address: null,
		related_accounts: [],
		email_address: null
	};
}

async function downloadJsonFromStorage(storage: any, storagePath: string): Promise<any> {
	const bucket = storage.bucket();
	const file = bucket.file(storagePath);
	const [buf] = await file.download();
	return JSON.parse(buf.toString('utf8'));
}

describe('pipeline worker (integration, emulators)', () => {
	it('cache-first: scores cached profiles and skips BrightData', async () => {
		vi.resetModules();

		const urls = makeUrls(40, 'cached_user');
		const weaviateResults = makeWeaviateResults(urls);

		vi.doMock('../dist/utils/search-query-generator.js', () => ({
			generateSearchQueriesFromDescription: vi.fn(async () => ({
				description: 'test',
				queries: ['q1', 'q2'],
				rawResponse: 'q1\nq2',
				prompt: 'prompt'
			}))
		}));

		vi.doMock('../dist/utils/weaviate-search.js', () => ({
			performParallelHybridSearches: vi.fn(async () => ({
				allSearchResults: [],
				deduplicatedResults: weaviateResults,
				queriesExecuted: 2,
				batchTimings: [],
				totalRuntimeMs: 1
			}))
		}));

		vi.doMock('../dist/utils/llm-analysis.js', () => ({
			analyzeProfileFitBatch: vi.fn(async (profiles: any[]) =>
				profiles.map((_p: any, idx: number) => ({
					fit_score: idx < 10 ? 90 : 0,
					fit_rationale: 'r',
					fit_summary: 's'
				}))
			)
		}));

		const brightdataInternal = {
			getBrightDataApiKey: vi.fn(() => 'test'),
			getBrightDataBaseUrl: vi.fn(() => 'https://example.test'),
			triggerCollection: vi.fn(async () => []),
			checkProgress: vi.fn(async () => ({ snapshot_id: 'x', dataset_id: 'ds', status: 'ready' as const })),
			downloadResults: vi.fn(async () => [])
		};
		vi.doMock('../dist/utils/brightdata-internal.js', () => brightdataInternal);

		const { createPipelineJob } = await import('../dist/utils/firestore-tracker.js');
		const { setCachedProfilesBatch } = await import('../dist/utils/brightdata-cache.js');
		const { getFirestoreInstance, getStorageInstance } = await import('../dist/utils/firebase-admin.js');

		const jobId = await createPipelineJob('desc', 10, { uid: 'user_1', weaviateTopN: 500 });

		// Prepopulate cache for first 20 urls (one batch).
		await setCachedProfilesBatch(
			urls.slice(0, 20).map((url, i) => ({
				url,
				platform: 'instagram' as const,
				data: makeInstagramRaw(url, i, 'cached_user')
			}))
		);

		const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

		await handlePipelineExecution({
			job_id: jobId,
			uid: 'user_1',
			business_description: 'desc',
			top_n: 10,
			weaviate_top_n: 500,
			llm_top_n: 10,
			request_id: 'req_cache_only'
		});

		expect(brightdataInternal.triggerCollection).not.toHaveBeenCalled();
		expect(brightdataInternal.downloadResults).not.toHaveBeenCalled();

		const db = getFirestoreInstance();
		const storage = getStorageInstance();
		const snap = await db.collection('pipeline_jobs').doc(jobId).get();
		const job = snap.data() as any;

		expect(job.status).toBe('completed');
		expect(job.candidates_storage_path).toBeTruthy();
		expect(job.progressive_profiles_storage_path).toBeTruthy();
		expect(job.profiles_storage_path).toBeTruthy();

		const progressive = await downloadJsonFromStorage(storage, job.progressive_profiles_storage_path);
		expect(Array.isArray(progressive)).toBe(true);
		expect(progressive).toHaveLength(10);
		expect(progressive.every((p: any) => (p.fit_score ?? 0) >= 90)).toBe(true);

		const finalProfiles = await downloadJsonFromStorage(storage, job.profiles_storage_path);
		expect(Array.isArray(finalProfiles)).toBe(true);
		expect(finalProfiles).toHaveLength(10); // final is top_n

		const remaining = await downloadJsonFromStorage(storage, job.remaining_profiles_storage_path);
		expect(Array.isArray(remaining)).toBe(true);
		expect(remaining).toHaveLength(10);
	});

	it('runs BrightData for cache misses, keeps 5 batches in-flight, and stops early', async () => {
		vi.resetModules();

		const urls = makeUrls(120, 'uncached_user'); // 6 batches @ 20 → can keep 5 in-flight
		const weaviateResults = makeWeaviateResults(urls);

		vi.doMock('../dist/utils/search-query-generator.js', () => ({
			generateSearchQueriesFromDescription: vi.fn(async () => ({
				description: 'test',
				queries: ['q1', 'q2'],
				rawResponse: 'q1\nq2',
				prompt: 'prompt'
			}))
		}));

		vi.doMock('../dist/utils/weaviate-search.js', () => ({
			performParallelHybridSearches: vi.fn(async () => ({
				allSearchResults: [],
				deduplicatedResults: weaviateResults,
				queriesExecuted: 2,
				batchTimings: [],
				totalRuntimeMs: 1
			}))
		}));

		vi.doMock('../dist/utils/llm-analysis.js', () => ({
			analyzeProfileFitBatch: vi.fn(async (profiles: any[]) =>
				profiles.map(() => ({
					fit_score: 90,
					fit_rationale: 'r',
					fit_summary: 's'
				}))
			)
		}));

		let snapshotCounter = 0;
		const downloadCallUrls: string[][] = [];

		const brightdataInternal = {
			getBrightDataApiKey: vi.fn(() => 'test'),
			getBrightDataBaseUrl: vi.fn(() => 'https://example.test'),
			triggerCollection: vi.fn(async (batchUrls: string[]) => [
				{ snapshot_id: `snap_${++snapshotCounter}`, platform: 'instagram' as const }
			]),
			checkProgress: vi.fn(async (snapshotId: string) => ({
				snapshot_id: snapshotId,
				dataset_id: 'ds',
				status: 'ready' as const
			})),
			downloadResults: vi.fn(async (_snapshotId: string) => {
				// Always return the next 20 urls (simulate snapshot content for that batch)
				const start = downloadCallUrls.length * 20;
				const batch = urls.slice(start, start + 20);
				downloadCallUrls.push(batch);
				return batch.map((url, i) => makeInstagramRaw(url, start + i, 'uncached_user'));
			})
		};
		vi.doMock('../dist/utils/brightdata-internal.js', () => brightdataInternal);

		const { createPipelineJob } = await import('../dist/utils/firestore-tracker.js');
		const { getCachedProfilesBatch } = await import('../dist/utils/brightdata-cache.js');
		const { getFirestoreInstance, getStorageInstance } = await import('../dist/utils/firebase-admin.js');

		const jobId = await createPipelineJob('desc', 10, { uid: 'user_1', weaviateTopN: 500 });

		const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

		await handlePipelineExecution({
			job_id: jobId,
			uid: 'user_1',
			business_description: 'desc',
			top_n: 10,
			weaviate_top_n: 500,
			llm_top_n: 10,
			request_id: 'req_brightdata_stop'
		});

		// Should trigger at least 5 batches initially (in-flight cap).
		expect(brightdataInternal.triggerCollection.mock.calls.length).toBeGreaterThanOrEqual(5);

		// But should only download/analyze one batch before early-stopping.
		expect(brightdataInternal.downloadResults).toHaveBeenCalledTimes(1);

		// Verify write-through cache eventually contains downloaded urls (best-effort async in worker).
		const cached = await (async () => {
			for (let attempt = 0; attempt < 10; attempt++) {
				const map = await getCachedProfilesBatch(downloadCallUrls[0] || []);
				if (map.size === 20) return map;
				await new Promise((r) => setTimeout(r, 100));
			}
			return await getCachedProfilesBatch(downloadCallUrls[0] || []);
		})();
		expect(cached.size).toBe(20);

		const db = getFirestoreInstance();
		const storage = getStorageInstance();
		const snap = await db.collection('pipeline_jobs').doc(jobId).get();
		const job = snap.data() as any;

		expect(job.status).toBe('completed');
		expect(job.profiles_storage_path).toBeTruthy();
		expect(job.remaining_profiles_storage_path).toBeTruthy();

		const finalProfiles = await downloadJsonFromStorage(storage, job.profiles_storage_path);
		expect(Array.isArray(finalProfiles)).toBe(true);
		expect(finalProfiles.length).toBeGreaterThan(0);

		const remaining = await downloadJsonFromStorage(storage, job.remaining_profiles_storage_path);
		expect(Array.isArray(remaining)).toBe(true);
		expect(remaining).toHaveLength(10);
	});
});
