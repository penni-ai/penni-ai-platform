import { describe, expect, it } from 'vitest';

import { getFirestoreInstance, getStorageInstance } from '../dist/utils/firebase-admin.js';
import {
	appendBatchResults,
	createPipelineJob,
	mergeBatchResults,
	saveWeaviateCandidates,
	updateProgressiveTopN
} from '../dist/utils/firestore-tracker.js';

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

describe('firestore-tracker (integration, emulators)', () => {
	it('writes candidates, batch files, progressive results, and merges into final profiles.json', async () => {
		const db = getFirestoreInstance();
		const storage = getStorageInstance();

		const jobId = await createPipelineJob('desc', 2, {
			uid: 'user_1',
			campaignId: 'campaign_1',
			weaviateTopN: 500
		});

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

		// Append batches out-of-order to validate completed_batch_indices + robust merging.
		await appendBatchResults(jobId, 2, [
			makeAnalyzedProfile('https://instagram.com/example_user_2/', 80),
			makeAnalyzedProfile('https://instagram.com/example_user_3/', 70)
		] as any);

		await appendBatchResults(jobId, 0, [makeAnalyzedProfile('https://instagram.com/example_user_4/', 95)] as any);

		await updateProgressiveTopN(jobId, 2, 1);

		const jobSnap = await db.collection('pipeline_jobs').doc(jobId).get();
		expect(jobSnap.exists).toBe(true);

		const job = jobSnap.data() as any;
		expect(job.candidates_storage_path).toBeTruthy();
		expect(job.progressive_profiles_storage_path).toBeTruthy();

		// Validate progressive file contains the highest fit_score profile.
		{
			const bucket = storage.bucket();
			const file = bucket.file(job.progressive_profiles_storage_path);
			const [buf] = await file.download();
			const profiles = JSON.parse(buf.toString('utf8'));
			expect(Array.isArray(profiles)).toBe(true);
			expect(profiles).toHaveLength(1);
			expect(profiles[0].fit_score).toBe(95);
		}

		const merged = await mergeBatchResults(jobId);
		expect(merged.map((p: any) => p.fit_score)).toEqual([95, 80, 70]);

		const mergedSnap = await db.collection('pipeline_jobs').doc(jobId).get();
		const mergedJob = mergedSnap.data() as any;
		expect(mergedJob.profiles_storage_path).toBeTruthy();
		expect(mergedJob.profiles_count).toBe(3);

		// Validate final profiles.json exists and matches merged results (order not guaranteed).
		{
			const bucket = storage.bucket();
			const file = bucket.file(mergedJob.profiles_storage_path);
			const [buf] = await file.download();
			const profiles = JSON.parse(buf.toString('utf8'));
			expect(Array.isArray(profiles)).toBe(true);
			expect(profiles).toHaveLength(3);
			const scores = profiles.map((p: any) => p.fit_score).sort((a: number, b: number) => b - a);
			expect(scores).toEqual([95, 80, 70]);
		}
	});
});
