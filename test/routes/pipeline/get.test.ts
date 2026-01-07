import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore, FakeStorage } from '../../helpers/fake-firebase';

function makeEvent(options: { pipelineId?: string; uid: string }) {
	const url = new URL(`http://localhost/api/pipeline/${options.pipelineId}`);
	return {
		params: { pipelineId: options.pipelineId },
		locals: { user: { uid: options.uid } as any, requestId: 'req_local' },
		request: new Request(url.toString(), { method: 'GET' }),
		url
	} as any;
}

async function writeJson(storage: FakeStorage, path: string, data: unknown) {
	const bucket = storage.bucket();
	await bucket.file(path).save(Buffer.from(JSON.stringify(data)));
}

async function writeRaw(storage: FakeStorage, path: string, raw: string) {
	const bucket = storage.bucket();
	await bucket.file(path).save(Buffer.from(raw));
}

describe('routes/api/pipeline/[pipelineId] GET', () => {
	it('returns 400 when pipeline id is missing', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const storage = new FakeStorage('test-bucket');
		const { adminDb, adminStorage } = createFirebaseAdminMock({ firestore, storage });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminStorage }));

		const { GET } = await import('../../../src/routes/api/pipeline/[pipelineId]/+server');
		const res = await GET(makeEvent({ pipelineId: undefined, uid: 'u1' }));
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe('PIPELINE_ID_REQUIRED');
	});

	it('returns 404 when pipeline job is missing', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const storage = new FakeStorage('test-bucket');
		const { adminDb, adminStorage } = createFirebaseAdminMock({ firestore, storage });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminStorage }));

		vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'other-project');

		const { GET } = await import('../../../src/routes/api/pipeline/[pipelineId]/+server');
		const res = await GET(makeEvent({ pipelineId: 'missing', uid: 'u1' }));
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe('PIPELINE_NOT_FOUND');
	});

	it('returns 404 when user does not own pipeline', async () => {
		vi.resetModules();

		const pipelineId = 'job_forbidden';
			const firestore = new FakeFirestore({
				[`pipeline_jobs/${pipelineId}`]: {
					job_id: pipelineId,
					status: 'running',
					uid: 'other_user',
					created_at: 'not-a-timestamp'
				}
			});
		const storage = new FakeStorage('test-bucket');
		const { adminDb, adminStorage } = createFirebaseAdminMock({ firestore, storage });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminStorage }));

		const { GET } = await import('../../../src/routes/api/pipeline/[pipelineId]/+server');
		const res = await GET(makeEvent({ pipelineId, uid: 'u1' }));
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe('PIPELINE_NOT_FOUND');
	});

	it('converts Timestamp-like fields via toMillis and handles toMillis errors', async () => {
		vi.resetModules();

		const pipelineId = 'job_timefields';
		const uid = 'u1';
		const firestore = new FakeFirestore({
			[`pipeline_jobs/${pipelineId}`]: {
				job_id: pipelineId,
				status: 'running',
				current_stage: 'weaviate_search',
				completed_stages: [],
				overall_progress: 10,
				uid,
				created_at: Date.now(),
				start_time: { toMillis: () => 1234 },
				end_time: { toMillis: () => { throw new Error('boom'); } }
			}
		});
		const storage = new FakeStorage('test-bucket');
		const { adminDb, adminStorage } = createFirebaseAdminMock({ firestore, storage });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminStorage }));

		const { GET } = await import('../../../src/routes/api/pipeline/[pipelineId]/+server');
		const res = await GET(makeEvent({ pipelineId, uid }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.start_time).toBe(1234);
		expect(body.end_time).toBeNull();
	});

	it('returns 404 when pipeline uid is missing', async () => {
		vi.resetModules();

		const pipelineId = 'job_fix_uid';
		const uid = 'u1';
		const campaignId = 'c1';
		const firestore = new FakeFirestore({
			[`pipeline_jobs/${pipelineId}`]: {
				job_id: pipelineId,
				status: 'running',
				uid: null,
				campaign_id: campaignId,
				created_at: Date.now()
			},
			[`users/${uid}/campaigns/${campaignId}`]: { pipeline_id: pipelineId, title: 't' }
		});
		const storage = new FakeStorage('test-bucket');
		const { adminDb, adminStorage } = createFirebaseAdminMock({ firestore, storage });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminStorage }));

		const { GET } = await import('../../../src/routes/api/pipeline/[pipelineId]/+server');
		const res = await GET(makeEvent({ pipelineId, uid }));
		expect(res.status).toBe(404);

		const snap = await adminDb.collection('pipeline_jobs').doc(pipelineId).get();
		expect(snap.get('uid')).toBeNull();
	});

	it('returns preliminary candidates when only candidates are available', async () => {
		vi.resetModules();

		const pipelineId = 'job_prelim';
		const uid = 'u1';
		const candidatesPath = `pipeline_jobs/${pipelineId}/candidates.json`;

		const firestore = new FakeFirestore({
			[`pipeline_jobs/${pipelineId}`]: {
				job_id: pipelineId,
				status: 'running',
				current_stage: 'weaviate_search',
				completed_stages: [],
				overall_progress: 10,
				uid,
				candidates_storage_path: candidatesPath,
				created_at: Date.now(),
				updated_at: Date.now()
			}
		});
		const storage = new FakeStorage('test-bucket');
		await writeJson(storage, candidatesPath, [
			{ id: 'w_1', profile_url: 'https://instagram.com/example_user_1/', platform: 'instagram' }
		]);

		const { adminDb, adminStorage } = createFirebaseAdminMock({ firestore, storage });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminStorage }));

		const { GET } = await import('../../../src/routes/api/pipeline/[pipelineId]/+server');
		const res = await GET(makeEvent({ pipelineId, uid }));
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.pipeline_id).toBe(pipelineId);
		expect(body.is_progressive).toBe(false);
		expect(Array.isArray(body.profiles)).toBe(true);
		expect(body.profiles).toHaveLength(0);
		expect(Array.isArray(body.preliminary_candidates)).toBe(true);
		expect(body.preliminary_candidates).toHaveLength(1);
		expect(body.preliminary_candidates[0].display_name).toBe('example_user_1');
	});

	it('handles storage edge cases for candidates (missing file, invalid JSON, non-array)', async () => {
		vi.resetModules();

		const pipelineId = 'job_candidates_storage';
		const uid = 'u1';

		const missingPath = `pipeline_jobs/${pipelineId}/missing.json`;
		const invalidJsonPath = `pipeline_jobs/${pipelineId}/invalid.json`;
		const nonArrayPath = `pipeline_jobs/${pipelineId}/object.json`;

		const storage = new FakeStorage('test-bucket');
		await writeRaw(storage, invalidJsonPath, '{');
		await writeJson(storage, nonArrayPath, { ok: true });

		const firestore = new FakeFirestore({
			[`pipeline_jobs/${pipelineId}`]: {
				job_id: pipelineId,
				status: 'running',
				uid,
				current_stage: 'weaviate_search',
				completed_stages: [],
				overall_progress: 10,
				created_at: { toMillis: () => Date.now() },
				candidates_storage_path: missingPath
			}
		});

		const { adminDb, adminStorage } = createFirebaseAdminMock({ firestore, storage });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminStorage }));

		const { GET } = await import('../../../src/routes/api/pipeline/[pipelineId]/+server');

		const resMissing = await GET(makeEvent({ pipelineId, uid }));
		expect(resMissing.status).toBe(200);
		expect('preliminary_candidates' in (await resMissing.json())).toBe(false);

		await adminDb.collection('pipeline_jobs').doc(pipelineId).update({ candidates_storage_path: invalidJsonPath });
		const resInvalid = await GET(makeEvent({ pipelineId, uid }));
		expect(resInvalid.status).toBe(200);
		expect('preliminary_candidates' in (await resInvalid.json())).toBe(false);

		await adminDb.collection('pipeline_jobs').doc(pipelineId).update({ candidates_storage_path: nonArrayPath });
		const resNonArray = await GET(makeEvent({ pipelineId, uid }));
		expect(resNonArray.status).toBe(200);
		expect('preliminary_candidates' in (await resNonArray.json())).toBe(false);
	});

	it('extracts candidate display name from URL via regex fallback when URL parsing fails', async () => {
		vi.resetModules();

		const pipelineId = 'job_prelim_bad_url';
		const uid = 'u1';
		const candidatesPath = `pipeline_jobs/${pipelineId}/candidates.json`;

		const firestore = new FakeFirestore({
			[`pipeline_jobs/${pipelineId}`]: {
				job_id: pipelineId,
				status: 'running',
				current_stage: 'weaviate_search',
				completed_stages: [],
				overall_progress: 10,
				uid,
				candidates_storage_path: candidatesPath,
				created_at: Date.now(),
				updated_at: Date.now()
			}
		});
		const storage = new FakeStorage('test-bucket');
		await writeJson(storage, candidatesPath, [
			{ id: 'w_1', profile_url: 'instagram.com/example_user_1/', platform: 'instagram' }
		]);

		const { adminDb, adminStorage } = createFirebaseAdminMock({ firestore, storage });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminStorage }));

		const { GET } = await import('../../../src/routes/api/pipeline/[pipelineId]/+server');
		const res = await GET(makeEvent({ pipelineId, uid }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.preliminary_candidates).toHaveLength(1);
		expect(body.preliminary_candidates[0].display_name).toBe('example_user_1');
	});

	it('returns progressive profiles and hides preliminary candidates while running', async () => {
		vi.resetModules();

		const pipelineId = 'job_progress';
		const uid = 'u1';
		const candidatesPath = `pipeline_jobs/${pipelineId}/candidates.json`;
		const progressivePath = `pipeline_jobs/${pipelineId}/profiles_progressive.json`;

		const firestore = new FakeFirestore({
			[`pipeline_jobs/${pipelineId}`]: {
				job_id: pipelineId,
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
			}
		});
		const storage = new FakeStorage('test-bucket');
		await writeJson(storage, candidatesPath, [{ id: 'w_1', profile_url: 'https://instagram.com/a/', platform: 'instagram' }]);
		await writeJson(storage, progressivePath, [
			{ _id: 'p1', profile_url: 'https://instagram.com/a/', platform: 'instagram', fit_score: 95 },
			{ _id: 'p2', profile_url: 'https://tiktok.com/@b', platform: 'tiktok', fit_score: 90 }
		]);

		const { adminDb, adminStorage } = createFirebaseAdminMock({ firestore, storage });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminStorage }));

		const { GET } = await import('../../../src/routes/api/pipeline/[pipelineId]/+server');
		const res = await GET(makeEvent({ pipelineId, uid }));
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.is_progressive).toBe(true);
		expect(Array.isArray(body.profiles)).toBe(true);
		expect(body.profiles).toHaveLength(2);
		expect('preliminary_candidates' in body).toBe(false);
	});

	it('returns remaining profiles and stage metadata when available', async () => {
		vi.resetModules();

		const pipelineId = 'job_with_remaining';
		const uid = 'u1';
		const campaignId = 'c1';
		const profilesPath = `pipeline_jobs/${pipelineId}/profiles.json`;
		const remainingPath = `pipeline_jobs/${pipelineId}/remaining.json`;

		const firestore = new FakeFirestore({
			[`pipeline_jobs/${pipelineId}`]: {
				job_id: pipelineId,
				status: 'completed',
				current_stage: null,
				completed_stages: ['query_expansion', 'weaviate_search', 'brightdata_collection', 'llm_analysis'],
				overall_progress: 100,
				uid,
				campaign_id: campaignId,
				profiles_storage_path: profilesPath,
				remaining_profiles_storage_path: remainingPath,
				query_expansion: { status: 'completed', queries: ['q1'], prompt: 'p', completed_at: { toMillis: () => 1 } },
				weaviate_search: { status: 'completed', total_results: 2, deduplicated_results: 2, queries_executed: 1, completed_at: 2 },
				brightdata_collection: { status: 'completed', profiles_requested: 2, profiles_collected: 2, total_batches: 1, batches_completed: 1, completed_at: 3 },
				llm_analysis: { status: 'completed', profiles_analyzed: 2, completed_at: 4 }
			}
		});
		const storage = new FakeStorage('test-bucket');
		await writeJson(storage, profilesPath, [{ _id: 'p1', fit_score: 99 }]);
		await writeJson(storage, remainingPath, [{ _id: 'p2', fit_score: 50 }]);

		const { adminDb, adminStorage } = createFirebaseAdminMock({ firestore, storage });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminStorage }));

		const { GET } = await import('../../../src/routes/api/pipeline/[pipelineId]/+server');
		const res = await GET(makeEvent({ pipelineId, uid }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.remaining_profiles).toHaveLength(1);
		expect(body.stages.query_expansion.status).toBe('completed');
		expect(body.stages.weaviate_search.total_results).toBe(2);
		expect(body.stages.brightdata_collection.total_batches).toBe(1);
		expect(body.stages.llm_analysis.profiles_analyzed).toBe(2);
	});

	it('ingests completed profiles into campaign index once', async () => {
		vi.resetModules();

		const pipelineId = 'job_done';
		const uid = 'u1';
		const campaignId = 'c1';
		const profilesPath = `pipeline_jobs/${pipelineId}/profiles.json`;

		const firestore = new FakeFirestore({
			[`pipeline_jobs/${pipelineId}`]: {
				job_id: pipelineId,
				status: 'completed',
				current_stage: null,
				completed_stages: ['weaviate_search', 'brightdata_collection', 'llm_analysis'],
				overall_progress: 100,
				uid,
				campaign_id: campaignId,
				profiles_storage_path: profilesPath,
				profiles_count: 1,
				created_at: Date.now(),
				updated_at: Date.now()
			}
		});
		const storage = new FakeStorage('test-bucket');
		await writeJson(storage, profilesPath, [
			{
				_id: 'p_ingest',
				profile_url: 'https://instagram.com/a/',
				platform: 'instagram',
				display_name: 'a',
				followers: 123,
				fit_score: 99,
				email_address: 'a@example.com'
			}
		]);

		const { adminDb, adminStorage } = createFirebaseAdminMock({ firestore, storage });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminStorage }));

		const { GET } = await import('../../../src/routes/api/pipeline/[pipelineId]/+server');
		const res = await GET(makeEvent({ pipelineId, uid }));
		expect(res.status).toBe(200);

		const pipelineDoc = await adminDb.collection('users').doc(uid).collection('campaigns').doc(campaignId).collection('pipelines').doc(pipelineId).get();
		expect(pipelineDoc.get('ingested')).toBe(true);

		const campaignProfile = await adminDb.collection('users').doc(uid).collection('campaigns').doc(campaignId).collection('profiles').doc('p_ingest').get();
		expect(campaignProfile.exists).toBe(true);
		expect(campaignProfile.get('best_fit_score')).toBe(99);
	});

		it('swallows ingestion errors and still returns a pipeline snapshot', async () => {
			vi.resetModules();

			const pipelineId = 'job_ingest_warn';
			const uid = 'u1';
			const campaignId = 'c1';
			const profilesPath = `pipeline_jobs/${pipelineId}/profiles.json`;

		const firestore = new FakeFirestore({
			[`pipeline_jobs/${pipelineId}`]: {
				job_id: pipelineId,
				status: 'completed',
				uid,
				campaign_id: campaignId,
				profiles_storage_path: profilesPath,
				profiles_count: 1,
				created_at: Date.now(),
				updated_at: Date.now()
			}
		});
		const storage = new FakeStorage('test-bucket');
		await writeJson(storage, profilesPath, [{ _id: 'p1', fit_score: 99 }]);

			const { adminDb, adminStorage } = createFirebaseAdminMock({ firestore, storage });
			vi.doMock('$lib/firebase/admin', () => ({ adminDb, adminStorage }));

			// Spy before importing core/logger so the logger binds to the mocked console writer.
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

			const core = await import('../../../src/lib/server/core');
			vi.spyOn(core.firestore as any, 'batch').mockImplementation(() => {
				throw new Error('boom');
			});

			const { GET } = await import('../../../src/routes/api/pipeline/[pipelineId]/+server');
			const res = await GET(makeEvent({ pipelineId, uid }));
			expect(res.status).toBe(200);
			expect(warn).toHaveBeenCalled();
			warn.mockRestore();
		});
	});
