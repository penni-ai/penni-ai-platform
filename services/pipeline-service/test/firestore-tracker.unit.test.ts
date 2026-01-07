import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeFirestore, FakeStorage, FakeStorageBucket, FakeStorageFile } from './helpers/fake-firebase';

let db: FakeFirestore;
let storage: FakeStorage;

vi.mock('../dist/utils/firebase-admin.js', () => ({
	getFirestoreInstance: () => db,
	getStorageInstance: () => storage,
	resolvedStorageBucketName: 'test-bucket'
}));

function makeAnalyzedProfile(url: string, fitScore: number) {
	return {
		platform: url.includes('tiktok.com') ? 'tiktok' : 'instagram',
		account_id: url,
		id: url,
		profile_url: url,
		url,
		display_name: url,
		biography: null,
		profile_image_url: null,
		followers: 123,
		following: 10,
		posts_count: 1,
		avg_engagement_rate: null,
		external_url: null,
		email_address: null,
		hashtags: null,
		fit_score: fitScore,
		fit_rationale: 'r',
		fit_summary: 's'
	};
}

describe('firestore-tracker (unit)', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		db = new FakeFirestore();
		storage = new FakeStorage('test-bucket');
	});

	it('calculates progress milestones', async () => {
		const { calculateProgress } = await import('../dist/utils/firestore-tracker.js');

		expect(calculateProgress('query_expansion')).toBe(10);
		expect(calculateProgress('weaviate_search', 'embedding_generation')).toBe(20);
		expect(calculateProgress('weaviate_search', 'searches_complete')).toBe(50);
		expect(calculateProgress('brightdata_collection')).toBe(50);
		expect(calculateProgress('brightdata_collection', undefined, { completed: 1, total: 4 })).toBe(60);
		expect(calculateProgress(null)).toBe(100);
	});

	it('creates job, updates stages, cancels, and returns job documents', async () => {
		const {
			cancelPipelineJob,
			createPipelineJob,
			getPipelineJob,
			isJobCancelled,
			updateLLMAnalysisStage,
			updatePipelineJobStatus,
			updateQueryExpansionStage,
			updateWeaviateSearchStage
		} = await import('../dist/utils/firestore-tracker.js');

		const jobId = await createPipelineJob('desc', 3, {
			uid: 'user_1',
			campaignId: 'campaign_1',
			weaviateTopN: 500
		});

		const job = await getPipelineJob(jobId);
		expect(job?.job_id).toBe(jobId);
		expect(job?.status).toBe('pending');
		expect(job?.uid).toBe('user_1');
		expect(job?.campaign_id).toBe('campaign_1');
		expect(job?.top_n).toBe(3);
		expect(job?.llm_top_n).toBe(3);
		expect(job?.weaviate_top_n).toBe(500);

		await updateQueryExpansionStage(jobId, 'completed', ['q1', 'q2'], null, 'prompt');
		await updateWeaviateSearchStage(jobId, 'completed', 10, 8, 2);
		await updateLLMAnalysisStage(jobId, 'running', 12);
		await updatePipelineJobStatus(jobId, 'running');

		expect(await isJobCancelled(jobId)).toBe(false);
		await cancelPipelineJob(jobId);
		expect(await isJobCancelled(jobId)).toBe(true);

		const jobAfter = await getPipelineJob(jobId);
		expect(jobAfter?.status).toBe('cancelled');
		expect(jobAfter?.query_expansion?.queries).toEqual(['q1', 'q2']);
		expect(jobAfter?.weaviate_search?.deduplicated_results).toBe(8);
		expect(jobAfter?.llm_analysis?.profiles_analyzed).toBe(12);
	});

	it('stores candidates, batches, progressive top-N, final results, and remaining profiles in Storage', async () => {
		const {
			appendBatchResults,
			createPipelineJob,
			finalizeProgressiveResults,
			mergeBatchResults,
			saveWeaviateCandidates,
			storePipelineResults,
			storeRemainingProfiles,
			updateProgressiveTopN
		} = await import('../dist/utils/firestore-tracker.js');

		const jobId = await createPipelineJob('desc', 2, { uid: 'user_1', weaviateTopN: 500 });

		await saveWeaviateCandidates(jobId, [
			{
				id: 'w1',
				profile_url: 'https://instagram.com/example_user_1/',
				platform: 'instagram',
				display_name: 'Example User',
				biography: 'Bio',
				followers: 100,
				score: 0.1,
				distance: 0.2
			}
		]);

		await appendBatchResults(jobId, 1, [
			makeAnalyzedProfile('https://instagram.com/example_user_2/', 80),
			makeAnalyzedProfile('https://instagram.com/example_user_3/', 70)
		] as any);

		await appendBatchResults(jobId, 0, [makeAnalyzedProfile('https://instagram.com/example_user_4/', 95)] as any);

		await updateProgressiveTopN(jobId, 2, 2);

		// Validate progressive file contains highest fit scores (order desc).
		{
			const snap = await db.collection('pipeline_jobs').doc(jobId).get();
			const data = snap.data() as any;
			expect(data.progressive_profiles_storage_path).toBe(`pipeline_jobs/${jobId}/profiles_progressive.json`);

			const file = storage.bucket('test-bucket').file(data.progressive_profiles_storage_path);
			const [buf] = await file.download();
			const profiles = JSON.parse(buf.toString('utf8'));
			expect(profiles.map((p: any) => p.fit_score)).toEqual([95, 80]);
		}

		await finalizeProgressiveResults(jobId);

		const merged = await mergeBatchResults(jobId);
		expect(merged.map((p: any) => p.fit_score)).toEqual([95, 80, 70]);

		await storePipelineResults(jobId, merged as any);
		await storeRemainingProfiles(jobId, [makeAnalyzedProfile('https://tiktok.com/@u', 60)] as any);

		const finalSnap = await db.collection('pipeline_jobs').doc(jobId).get();
		const final = finalSnap.data() as any;

		expect(final.candidates_storage_path).toBe(`pipeline_jobs/${jobId}/candidates.json`);
		expect(final.candidates_storage_url).toBeUndefined();
		expect(final.profiles_storage_path).toBe(`pipeline_jobs/${jobId}/profiles.json`);
		expect(final.profiles_count).toBe(3);
		expect(final.remaining_profiles_storage_path).toBe(`pipeline_jobs/${jobId}/profiles_remaining.json`);
		expect(final.remaining_profiles_count).toBe(1);
		expect(final.progressive_is_complete).toBe(true);

		// Validate final merged profiles.json exists.
		{
			const file = storage.bucket('test-bucket').file(final.profiles_storage_path);
			const [buf] = await file.download();
			const profiles = JSON.parse(buf.toString('utf8'));
			expect(profiles).toHaveLength(3);
		}
	});

	it('updateProgressiveTopN short-circuits for missing jobs/indices/empty batches', async () => {
		const { createPipelineJob, updateProgressiveTopN } = await import('../dist/utils/firestore-tracker.js');

		// batchesCompleted===0 should never throw (even if job is missing).
		await expect(updateProgressiveTopN('missing_job', 0, 10)).resolves.toBeUndefined();

		// Missing job should just log + return.
		await expect(updateProgressiveTopN('missing_job', 1, 10)).resolves.toBeUndefined();

		const jobId = await createPipelineJob('desc', 2, { uid: 'user_1', weaviateTopN: 500 });

		// No completed indices -> return.
		await expect(updateProgressiveTopN(jobId, 1, 10)).resolves.toBeUndefined();

		// Completed indices but batch file missing -> return (no profiles).
		await db.collection('pipeline_jobs').doc(jobId).update({
			'brightdata_collection.completed_batch_indices': [0]
		});
		await expect(updateProgressiveTopN(jobId, 1, 10)).resolves.toBeUndefined();
	});

	it('mergeBatchResults can use totalBatches fallback and warns on count mismatch', async () => {
		const { createPipelineJob, mergeBatchResults } = await import('../dist/utils/firestore-tracker.js');

		const jobId = await createPipelineJob('desc', 2, { uid: 'user_1', weaviateTopN: 500 });

		// Manually write batch files without updating completed indices.
		await storage
			.bucket('test-bucket')
			.file(`pipeline_jobs/${jobId}/profiles_batch_0.json`)
			.save(Buffer.from(JSON.stringify([makeAnalyzedProfile('https://instagram.com/a/', 50)])));
		await storage
			.bucket('test-bucket')
			.file(`pipeline_jobs/${jobId}/profiles_batch_1.json`)
			.save(Buffer.from(JSON.stringify([makeAnalyzedProfile('https://tiktok.com/@b', 60)])));

		// Force an expected-count mismatch to hit the warning branch.
		await db.collection('pipeline_jobs').doc(jobId).update({
			'brightdata_collection.profiles_collected': 999
		});

		const merged = await mergeBatchResults(jobId, 2);
		expect(merged.map((p: any) => p.fit_score)).toEqual([50, 60]);

		const job = await db.collection('pipeline_jobs').doc(jobId).get();
		expect(job.get('profiles_count')).toBe(2);
	});

	it('covers updateProgress/updatePipelineStage/completeStage/updateBrightDataStage', async () => {
		const {
			completeStage,
			createPipelineJob,
			updateBrightDataStage,
			updatePipelineStage,
			updateProgress
		} = await import('../dist/utils/firestore-tracker.js');

		const jobId = await createPipelineJob('desc', 2, { uid: 'user_1', weaviateTopN: 500 });

		await updateProgress(jobId, 'query_expansion');
		const afterProgress = await db.collection('pipeline_jobs').doc(jobId).get();
		expect(afterProgress.get('overall_progress')).toBe(10);
		expect(afterProgress.get('current_stage')).toBe('query_expansion');

		await updatePipelineStage(jobId, 'weaviate_search', 999);
		const afterLegacyStage = await db.collection('pipeline_jobs').doc(jobId).get();
		expect(afterLegacyStage.get('overall_progress')).toBe(100);
		expect(afterLegacyStage.get('current_stage')).toBe('weaviate_search');

		await expect(completeStage('missing_job', 'query_expansion')).rejects.toThrow(/not found/);

		await completeStage(jobId, 'query_expansion');
		const afterComplete1 = await db.collection('pipeline_jobs').doc(jobId).get();
		expect(afterComplete1.get('completed_stages')).toEqual(expect.arrayContaining(['query_expansion']));
		expect(afterComplete1.get('overall_progress')).toBe(25);

		await updateBrightDataStage(jobId, 'completed', 123, 45, null, 7, 8);
		const afterBright = await db.collection('pipeline_jobs').doc(jobId).get();
		expect(afterBright.get('brightdata_collection.profiles_requested')).toBe(123);
		expect(afterBright.get('brightdata_collection.profiles_collected')).toBe(45);
		expect(afterBright.get('brightdata_collection.cache_hits')).toBe(7);
		expect(afterBright.get('brightdata_collection.api_calls')).toBe(8);
		expect(afterBright.get('brightdata_collection.completed_at')).toBeTruthy();
	});

	it('covers loadBatchFromStorage defensive branches and updateBatchCounters/finalizePipelineProgress', async () => {
		const {
			createPipelineJob,
			finalizePipelineProgress,
			updateBatchCounters,
			updateProgressiveTopN
		} = await import('../dist/utils/firestore-tracker.js');

		const jobId = await createPipelineJob('desc', 2, { uid: 'user_1', weaviateTopN: 500 });

		// Non-array JSON should return [] from the loader.
		await storage
			.bucket('test-bucket')
			.file(`pipeline_jobs/${jobId}/profiles_batch_0.json`)
			.save(Buffer.from(JSON.stringify({ not: 'an array' })));
		await db.collection('pipeline_jobs').doc(jobId).update({
			'brightdata_collection.completed_batch_indices': [0]
		});
		await expect(updateProgressiveTopN(jobId, 1, 10)).resolves.toBeUndefined();

		// Invalid JSON should hit the loader catch path and return [].
		await storage
			.bucket('test-bucket')
			.file(`pipeline_jobs/${jobId}/profiles_batch_1.json`)
			.save(Buffer.from('{not json'));
		await db.collection('pipeline_jobs').doc(jobId).update({
			'brightdata_collection.completed_batch_indices': [1]
		});
		await expect(updateProgressiveTopN(jobId, 1, 10)).resolves.toBeUndefined();

		// If the loader throws before its own try/catch, updateProgressiveTopN should warn + continue.
		const originalBucket = storage.bucket.bind(storage);
		(storage as any).bucket = () => {
			throw new Error('bucket down');
		};
		await db.collection('pipeline_jobs').doc(jobId).update({
			'brightdata_collection.completed_batch_indices': [0]
		});
		await expect(updateProgressiveTopN(jobId, 1, 10)).resolves.toBeUndefined();
		(storage as any).bucket = originalBucket;

		await updateBatchCounters(jobId, 1, 2, 3, 4);
		const afterCounters = await db.collection('pipeline_jobs').doc(jobId).get();
		expect(afterCounters.get('brightdata_collection.batches_completed')).toBe(1);
		expect(afterCounters.get('brightdata_collection.batches_processing')).toBe(2);
		expect(afterCounters.get('brightdata_collection.batches_failed')).toBe(3);
		expect(afterCounters.get('brightdata_collection.total_batches')).toBe(4);

		await finalizePipelineProgress(jobId);
		const afterFinalize = await db.collection('pipeline_jobs').doc(jobId).get();
		expect(afterFinalize.get('overall_progress')).toBe(100);
		expect(afterFinalize.get('current_stage')).toBe(null);
	});

	it('covers missing-doc branches, status updates, and stage error fields', async () => {
		const {
			calculateProgress,
			createPipelineJob,
			getPipelineJob,
			isJobCancelled,
			updateLLMAnalysisStage,
			updatePipelineJobStatus,
			updateQueryExpansionStage,
			updateWeaviateSearchStage
		} = await import('../dist/utils/firestore-tracker.js');

		expect(await isJobCancelled('missing_job')).toBe(false);
		expect(await getPipelineJob('missing_job')).toBe(null);
		expect(calculateProgress('weaviate_search', 'unknown_substage')).toBe(0);

		// Create job with no uid to hit the warning branch.
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const jobId = await createPipelineJob('desc', 1, { weaviateTopN: 500 });
		expect(warnSpy).toHaveBeenCalled();

		await updatePipelineJobStatus(jobId, 'completed');
		await updatePipelineJobStatus(jobId, 'cancelled', 'bye');
		await updatePipelineJobStatus(jobId, 'error', 'boom');

		await updateQueryExpansionStage(jobId, 'error', [], 'qfail', 'prompt');
		await updateWeaviateSearchStage(jobId, 'error', 1, 1, 1, 'wfail');
		await updateLLMAnalysisStage(jobId, 'error', 0, 'lfail');

		const snap = await db.collection('pipeline_jobs').doc(jobId).get();
		expect(snap.get('cancel_requested')).toBe(true);
		expect(snap.get('error_message')).toBe('boom');
		expect(snap.get('weaviate_search.error')).toBe('wfail');
		expect(snap.get('llm_analysis.error')).toBe('lfail');
	});

	it('covers storage validation error branches and pipeline_stats updates', async () => {
		const { appendBatchResults, createPipelineJob, mergeBatchResults, storePipelineResults, storeRemainingProfiles } =
			await import('../dist/utils/firestore-tracker.js');

		const jobId = await createPipelineJob('desc', 2, { uid: 'user_1', weaviateTopN: 500 });

		// storeRemainingProfiles early return for empty input.
		await expect(storeRemainingProfiles(jobId, [] as any)).resolves.toBe('');

		// storePipelineResults rejects on non-array input.
		await expect(storePipelineResults(jobId, null as any)).rejects.toThrow(/expected array/);

		// Force storeRemainingProfiles to fail its validation by lying about download contents.
		const originalDownload = FakeStorageFile.prototype.download;
		FakeStorageFile.prototype.download = async () => [Buffer.from(JSON.stringify([]))];
		await expect(storeRemainingProfiles(jobId, [makeAnalyzedProfile('https://instagram.com/a/', 1)] as any)).rejects.toThrow(
			/mismatch/
		);
		FakeStorageFile.prototype.download = originalDownload;

		// Force storePipelineResults to fail by making exists() return false during validation.
		const originalExists = FakeStorageFile.prototype.exists;
		FakeStorageFile.prototype.exists = async () => [false];
		await expect(storePipelineResults(jobId, [makeAnalyzedProfile('https://instagram.com/a/', 1)] as any)).rejects.toThrow(
			/was not created/
		);
		FakeStorageFile.prototype.exists = originalExists;

		// Cover mergeBatchResults inference from batches_completed.
		await storage
			.bucket('test-bucket')
			.file(`pipeline_jobs/${jobId}/profiles_batch_0.json`)
			.save(Buffer.from(JSON.stringify([makeAnalyzedProfile('https://instagram.com/a/', 50)])));
		await storage
			.bucket('test-bucket')
			.file(`pipeline_jobs/${jobId}/profiles_batch_1.json`)
			.save(Buffer.from(JSON.stringify([makeAnalyzedProfile('https://instagram.com/b/', 60)])));
		await db.collection('pipeline_jobs').doc(jobId).update({
			'brightdata_collection.batches_completed': 2,
			'brightdata_collection.completed_batch_indices': null,
			'brightdata_collection.profiles_collected': 2
		});

		const merged = await mergeBatchResults(jobId);
		expect(merged).toHaveLength(2);

		// Ensure mergeBatchResults warns when loadBatchFromStorage throws before its internal try/catch.
		const originalFile = FakeStorageBucket.prototype.file;
		FakeStorageBucket.prototype.file = function (path: string) {
			if (String(path).includes('profiles_batch_')) {
				throw new Error('bucket down');
			}
			return originalFile.call(this, path);
		};
		await expect(mergeBatchResults(jobId)).resolves.toEqual([]);
		FakeStorageBucket.prototype.file = originalFile;

		// Exercise pipeline_stats update path.
		await storePipelineResults(jobId, merged as any, {
			queries_generated: 1,
			total_search_results: 2,
			deduplicated_results: 2,
			profiles_collected: 2,
			profiles_analyzed: 2,
			cache_hits: 1,
			api_calls: 0,
			brightdata_cost: 0,
			openai_cost: 0,
			total_cost: 0
		});

		const finalSnap = await db.collection('pipeline_jobs').doc(jobId).get();
		expect(finalSnap.get('pipeline_stats.queries_generated')).toBe(1);

		// Append to missing job should throw.
		await expect(appendBatchResults('missing_job', 0, [] as any)).rejects.toThrow(/not found/);
	});

	it('covers remaining storage validation + transaction branches', async () => {
		const { appendBatchResults, createPipelineJob, mergeBatchResults, storePipelineResults, storeRemainingProfiles } =
			await import('../dist/utils/firestore-tracker.js');

		const jobId = await createPipelineJob('desc', 1, { uid: 'user_1', weaviateTopN: 500 });

		// storeRemainingProfiles fails when exists() is false.
		const originalExists = FakeStorageFile.prototype.exists;
		FakeStorageFile.prototype.exists = async () => [false];
		await expect(storeRemainingProfiles(jobId, [makeAnalyzedProfile('https://instagram.com/a/', 1)] as any)).rejects.toThrow(
			/was not created/
		);
		FakeStorageFile.prototype.exists = originalExists;

		// storePipelineResults fails when the downloaded file doesn't match the expected count.
		const originalDownload = FakeStorageFile.prototype.download;
		FakeStorageFile.prototype.download = async () => [Buffer.from(JSON.stringify([]))];
		await expect(storePipelineResults(jobId, [makeAnalyzedProfile('https://instagram.com/a/', 1)] as any)).rejects.toThrow(
			/Profile count mismatch/
		);
		FakeStorageFile.prototype.download = originalDownload;

		// appendBatchResults throws if the job disappears between initial get() and transaction.get().
		const jobId2 = await createPipelineJob('desc', 1, { uid: 'user_2', weaviateTopN: 500 });
		const originalRunTransaction = db.runTransaction.bind(db);
		db.runTransaction = async (fn: any) => {
			(db as any)._delete(`pipeline_jobs/${jobId2}`);
			db.runTransaction = originalRunTransaction;
			return originalRunTransaction(fn);
		};
		await expect(appendBatchResults(jobId2, 0, [makeAnalyzedProfile('https://instagram.com/a/', 1)] as any)).rejects.toThrow(
			/not found/
		);

		// mergeBatchResults covers the missing-doc + totalBatches fallback branch before failing on update().
		await expect(mergeBatchResults('missing_job_for_merge', 2)).rejects.toThrow(/No document to update/);
	});
});
