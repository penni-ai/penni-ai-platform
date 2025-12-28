import { describe, expect, it } from 'vitest';

import { adminDb, adminStorage } from '$lib/firebase/admin';

import { GET as getPipeline } from '../../src/routes/api/pipeline/[pipelineId]/+server';
import { POST as cancelPipeline } from '../../src/routes/api/pipeline/[pipelineId]/cancel/+server';

function makeEvent(options: {
	method: string;
	url: string;
	pipelineId: string;
	userUid: string;
	origin?: string;
}): any {
	const url = new URL(options.url);
	const headers = new Headers();
	if (options.origin) headers.set('origin', options.origin);
	const request = new Request(url.toString(), { method: options.method, headers });

	return {
		params: { pipelineId: options.pipelineId },
		locals: {
			user: { uid: options.userUid } as any,
			requestId: `req_${Date.now()}`
		},
		request,
		url
	};
}

async function writeJsonObject(storagePath: string, data: unknown): Promise<void> {
	const bucketName =
		process.env.STORAGE_BUCKET ||
		process.env.FIREBASE_STORAGE_BUCKET ||
		adminStorage.app.options.storageBucket ||
		`${adminStorage.app.options.projectId || 'penni-ai-platform'}.firebasestorage.app`;

	const bucket = adminStorage.bucket(bucketName);
	const file = bucket.file(storagePath);
	await file.save(Buffer.from(JSON.stringify(data, null, 2)), {
		contentType: 'application/json'
	});
}

describe('pipeline API routes (Firestore + Storage emulator)', () => {
	it('GET returns preliminary candidates when only candidates.json exists', async () => {
		const pipelineId = `job_prelim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const uid = 'user_test_prelim';
		const candidatesPath = `pipeline_jobs/${pipelineId}/candidates.json`;

		await writeJsonObject(candidatesPath, [
			{
				id: 'w_1',
				profile_url: 'https://instagram.com/example_user_1/',
				platform: 'instagram',
				display_name: 'Example User 1',
				biography: 'Bio 1',
				followers: 123,
				score: 0.9,
				distance: 0.1
			},
			{
				id: 'w_2',
				profile_url: 'https://tiktok.com/@example_user_2',
				platform: 'tiktok',
				display_name: 'Example User 2',
				biography: 'Bio 2',
				followers: 456,
				score: 0.8,
				distance: 0.2
			}
		]);

		await adminDb.collection('pipeline_jobs').doc(pipelineId).set({
			job_id: pipelineId,
			business_description: 'desc',
			status: 'running',
			current_stage: 'weaviate_search',
			completed_stages: [],
			overall_progress: 50,
			uid,
			candidates_storage_path: candidatesPath,
			created_at: Date.now(),
			updated_at: Date.now()
		});

		const res = await getPipeline(
			makeEvent({
				method: 'GET',
				url: `http://localhost/api/pipeline/${pipelineId}`,
				pipelineId,
				userUid: uid
			})
		);

		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.pipeline_id).toBe(pipelineId);
		expect(body.status).toBe('running');
		expect(body.is_progressive).toBe(false);
		expect(Array.isArray(body.profiles)).toBe(true);
		expect(body.profiles).toHaveLength(0);
		expect(Array.isArray(body.preliminary_candidates)).toBe(true);
		expect(body.preliminary_candidates).toHaveLength(2);
	});

	it('GET returns progressive top-N and hides preliminary candidates while running', async () => {
		const pipelineId = `job_progress_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const uid = 'user_test_progress';
		const candidatesPath = `pipeline_jobs/${pipelineId}/candidates.json`;
		const progressivePath = `pipeline_jobs/${pipelineId}/profiles_progressive.json`;

		await writeJsonObject(candidatesPath, [
			{
				id: 'w_1',
				profile_url: 'https://instagram.com/example_user_1/',
				platform: 'instagram',
				display_name: 'Example User 1'
			}
		]);

		await writeJsonObject(progressivePath, [
			{
				profile_url: 'https://instagram.com/example_user_1/',
				platform: 'instagram',
				display_name: 'Example User 1',
				followers: 123,
				fit_score: 95,
				fit_rationale: 'Great fit',
				fit_summary: 'Great fit'
			},
			{
				profile_url: 'https://tiktok.com/@example_user_2',
				platform: 'tiktok',
				display_name: 'Example User 2',
				followers: 456,
				fit_score: 90,
				fit_rationale: 'Good fit',
				fit_summary: 'Good fit'
			}
		]);

		await adminDb.collection('pipeline_jobs').doc(pipelineId).set({
			job_id: pipelineId,
			business_description: 'desc',
			status: 'running',
			current_stage: 'llm_analysis',
			completed_stages: ['weaviate_search'],
			overall_progress: 70,
			uid,
			candidates_storage_path: candidatesPath,
			progressive_profiles_storage_path: progressivePath,
			progressive_profiles_count: 2,
			brightdata_collection: { batches_completed: 1, total_batches: 25 },
			created_at: Date.now(),
			updated_at: Date.now()
		});

		const res = await getPipeline(
			makeEvent({
				method: 'GET',
				url: `http://localhost/api/pipeline/${pipelineId}`,
				pipelineId,
				userUid: uid
			})
		);

		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.is_progressive).toBe(true);
		expect(Array.isArray(body.profiles)).toBe(true);
		expect(body.profiles).toHaveLength(2);
		expect(body.profiles[0].fit_score).toBeGreaterThanOrEqual(body.profiles[1].fit_score);
		expect('preliminary_candidates' in body).toBe(false);
	});

	it('POST /cancel marks running pipelines as cancelled', async () => {
		const pipelineId = `job_cancel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const uid = 'user_test_cancel';

		await adminDb.collection('pipeline_jobs').doc(pipelineId).set({
			job_id: pipelineId,
			business_description: 'desc',
			status: 'running',
			current_stage: 'llm_analysis',
			completed_stages: [],
			overall_progress: 60,
			uid,
			created_at: Date.now(),
			updated_at: Date.now()
		});

		const res = await cancelPipeline(
			makeEvent({
				method: 'POST',
				url: `http://localhost/api/pipeline/${pipelineId}/cancel`,
				pipelineId,
				userUid: uid,
				origin: 'http://localhost'
			})
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('cancelled');
		expect(body.cancel_requested).toBe(true);

		const jobSnap = await adminDb.collection('pipeline_jobs').doc(pipelineId).get();
		expect(jobSnap.exists).toBe(true);
		expect(jobSnap.get('status')).toBe('cancelled');
		expect(jobSnap.get('cancel_requested')).toBe(true);
	});

	it('POST /cancel returns 403 when user does not own the pipeline', async () => {
		const pipelineId = `job_forbidden_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		await adminDb.collection('pipeline_jobs').doc(pipelineId).set({
			job_id: pipelineId,
			business_description: 'desc',
			status: 'running',
			uid: 'other_user'
		});

		const res = await cancelPipeline(
			makeEvent({
				method: 'POST',
				url: `http://localhost/api/pipeline/${pipelineId}/cancel`,
				pipelineId,
				userUid: 'user_test_forbidden',
				origin: 'http://localhost'
			})
		);

		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error?.code).toBe('PIPELINE_FORBIDDEN');
	});
});

