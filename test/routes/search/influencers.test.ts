import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(options: { method: string; url: string; body?: unknown; uid?: string }) {
	const url = new URL(options.url);
	const headers = new Headers();
	headers.set('origin', url.origin);
	if (options.body !== undefined) headers.set('content-type', 'application/json');

	return {
		locals: {
			user: options.uid ? ({ uid: options.uid } as any) : null,
			requestId: 'req_local'
		},
		request: new Request(url.toString(), {
			method: options.method,
			headers,
			body: options.body !== undefined ? JSON.stringify(options.body) : undefined
		}),
		url
	} as any;
}

describe('routes/api/search/influencers', () => {
	it('POST validates business_description', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$lib/server/usage', () => ({
			getSearchUsage: vi.fn(async () => ({ count: 0, limit: 1000, remaining: 1000, resetDate: 'soon' })),
			incrementSearchUsage: vi.fn(async () => {})
		}));
		vi.doMock('$lib/server/firebase', () => ({
			getServiceAccountAccessToken: vi.fn(async () => 'token'),
			getCloudRunPipelineUrl: vi.fn(() => 'http://pipeline')
		}));
		vi.doMock('crypto', () => ({ randomUUID: () => 'req_1' }));

		const { POST } = await import('../../../src/routes/api/search/influencers/+server');
		const res = await POST(
			makeEvent({ method: 'POST', url: 'http://localhost/api/search/influencers', uid: 'u1', body: {} })
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe('INVALID_REQUEST');
	});

	it('POST validates top_n, follower bounds, and campaign_id', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$lib/server/usage', () => ({
			getSearchUsage: vi.fn(async () => ({ count: 0, limit: 1000, remaining: 1000, resetDate: 'soon' })),
			incrementSearchUsage: vi.fn(async () => {})
		}));
		vi.doMock('$lib/server/firebase', () => ({
			getServiceAccountAccessToken: vi.fn(async () => 'token'),
			getCloudRunPipelineUrl: vi.fn(() => 'http://pipeline')
		}));
		vi.doMock('crypto', () => ({ randomUUID: () => 'req_bounds' }));
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 202 })) as any);

		const { POST } = await import('../../../src/routes/api/search/influencers/+server');

		const badTopN = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid: 'u1',
				body: { business_description: 'coffee', top_n: 9 }
			})
		);
		expect(badTopN.status).toBe(400);

		const badMax = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid: 'u1',
				body: { business_description: 'coffee', top_n: 10, max_followers: -1 }
			})
		);
		expect(badMax.status).toBe(400);

		const badMin = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid: 'u1',
				body: { business_description: 'coffee', top_n: 10, min_followers: -1 }
			})
		);
		expect(badMin.status).toBe(400);

		const minGtMax = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid: 'u1',
				body: { business_description: 'coffee', top_n: 10, min_followers: 100, max_followers: 1 }
			})
		);
		expect(minGtMax.status).toBe(400);

		const badCampaignType = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid: 'u1',
				body: { business_description: 'coffee', top_n: 10, campaign_id: 123 }
			})
		);
		expect(badCampaignType.status).toBe(400);

		const emptyCampaignId = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid: 'u1',
				body: { business_description: 'coffee', top_n: 10, campaign_id: '   ' }
			})
		);
		expect(emptyCampaignId.status).toBe(400);
	});

	it('POST enforces search usage remaining', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$lib/server/usage', () => ({
			getSearchUsage: vi.fn(async () => ({ count: 0, limit: 10, remaining: 5, resetDate: 'soon' })),
			incrementSearchUsage: vi.fn(async () => {})
		}));
		vi.doMock('$lib/server/firebase', () => ({
			getServiceAccountAccessToken: vi.fn(async () => 'token'),
			getCloudRunPipelineUrl: vi.fn(() => 'http://pipeline')
		}));
		vi.doMock('crypto', () => ({ randomUUID: () => 'req_2' }));

		const { POST } = await import('../../../src/routes/api/search/influencers/+server');
		const res = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid: 'u1',
				body: { business_description: 'coffee', top_n: 10 }
			})
		);
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error.code).toBe('SEARCH_LIMIT_EXCEEDED');
	});

	it('POST maps usage check failures to 500', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$lib/server/usage', () => ({
			getSearchUsage: vi.fn(async () => {
				throw new Error('usage down');
			}),
			incrementSearchUsage: vi.fn(async () => {})
		}));
		vi.doMock('$lib/server/firebase', () => ({
			getServiceAccountAccessToken: vi.fn(async () => 'token'),
			getCloudRunPipelineUrl: vi.fn(() => 'http://pipeline')
		}));
		vi.doMock('crypto', () => ({ randomUUID: () => 'req_usage' }));

		const { POST } = await import('../../../src/routes/api/search/influencers/+server');
		const res = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid: 'u1',
				body: { business_description: 'coffee', top_n: 10 }
			})
		);
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('USAGE_CHECK_FAILED');
	});

	it('POST maps pipeline service call failures to 500', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$lib/server/usage', () => ({
			getSearchUsage: vi.fn(async () => ({ count: 0, limit: 1000, remaining: 1000, resetDate: 'soon' })),
			incrementSearchUsage: vi.fn(async () => {})
		}));
		vi.doMock('$lib/server/firebase', () => ({
			getServiceAccountAccessToken: vi.fn(async () => {
				throw new Error('iam down');
			}),
			getCloudRunPipelineUrl: vi.fn(() => 'http://pipeline')
		}));
		vi.doMock('crypto', () => ({ randomUUID: () => 'req_pipe' }));

		const { POST } = await import('../../../src/routes/api/search/influencers/+server');
		const res = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid: 'u1',
				body: { business_description: 'coffee', top_n: 10 }
			})
		);
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('PIPELINE_SERVICE_FAILED');
	});

	it('POST maps non-OK pipeline responses and can omit job_id', async () => {
		vi.resetModules();

		const uid = 'u1';
		const campaignId = 'c_missing';
		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const incrementSearchUsage = vi.fn(async () => {
			throw new Error('non-critical');
		});
		vi.doMock('$lib/server/usage', () => ({
			getSearchUsage: vi.fn(async () => ({ count: 0, limit: 1000, remaining: 1000, resetDate: 'soon' })),
			incrementSearchUsage
		}));
		vi.doMock('$lib/server/firebase', () => ({
			getServiceAccountAccessToken: vi.fn(async () => 'token'),
			getCloudRunPipelineUrl: vi.fn(() => 'http://pipeline')
		}));
		vi.doMock('crypto', () => ({ randomUUID: () => 'req_nonok' }));

		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ error: 'BAD', message: 'nope', request_id: 'req_fn' }), { status: 500 })
			)
			.mockResolvedValueOnce(new Response('not-json', { status: 202 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ job_id: 'job_3', request_id: 'req_fn_3' }), { status: 202 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ job_id: 'job_4', request_id: 'req_fn_4' }), { status: 202 }));
		vi.stubGlobal('fetch', fetchSpy as any);

		const { POST } = await import('../../../src/routes/api/search/influencers/+server');

		const nonOk = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid,
				body: { business_description: 'coffee', top_n: 10 }
			})
		);
		expect(nonOk.status).toBe(500);
		expect((await nonOk.json()).error.code).toBe('BAD');

		const missingJob = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid,
				body: { business_description: 'coffee', top_n: 10, campaign_id: campaignId, strict_location_matching: true }
			})
		);
		expect(missingJob.status).toBe(200);
		expect((await missingJob.json()).status).toBe('accepted');

		const missingCampaign = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid,
				body: {
					business_description: 'coffee',
					top_n: 10,
					campaign_id: campaignId,
					exclude_profile_urls: ['https://x.test']
				}
			})
		);
		expect(missingCampaign.status).toBe(200);
		expect((await missingCampaign.json()).campaign_binding_status).toBe('missing_campaign');

		// noop_same when campaign already bound to same pipeline id
		await adminDb.collection('users').doc(uid).collection('campaigns').doc('c_same').set({ pipeline_id: 'job_4' });
		const noopSame = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid,
				body: { business_description: 'coffee', top_n: 10, campaign_id: 'c_same' }
			})
		);
		expect(noopSame.status).toBe(200);
		expect((await noopSame.json()).campaign_binding_status).toBe('noop_same');
	});

	it('POST binds pipeline id when campaign exists without pipeline_id and includes follower bounds', async () => {
		vi.resetModules();

		const uid = 'u1';
		const campaignId = 'c_new';
		const firestore = new FakeFirestore({
			[`users/${uid}/campaigns/${campaignId}`]: { title: 'T' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/usage', () => ({
			getSearchUsage: vi.fn(async () => ({ count: 0, limit: 1000, remaining: 1000, resetDate: 'soon' })),
			incrementSearchUsage: vi.fn(async () => {})
		}));
		vi.doMock('$lib/server/firebase', () => ({
			getServiceAccountAccessToken: vi.fn(async () => 'token'),
			getCloudRunPipelineUrl: vi.fn(() => 'http://pipeline')
		}));
		vi.doMock('crypto', () => ({ randomUUID: () => 'req_bounds_ok' }));

		const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
			const payload = JSON.parse(String(init?.body ?? '{}'));
			expect(payload.min_followers).toBe(10);
			expect(payload.max_followers).toBe(20);
			return new Response(JSON.stringify({ job_id: 'job_ok', request_id: 'req_fn_ok' }), { status: 202 });
		});
		vi.stubGlobal('fetch', fetchSpy as any);

		const { POST } = await import('../../../src/routes/api/search/influencers/+server');
		const res = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid,
				body: {
					business_description: 'coffee',
					top_n: 10,
					min_followers: 10,
					max_followers: 20,
					campaign_id: campaignId
				}
			})
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.campaign_binding_status).toBe('updated');

		const snap = await adminDb.collection('users').doc(uid).collection('campaigns').doc(campaignId).get();
		expect(snap.get('pipeline_id')).toBe('job_ok');
	});

	it('POST falls back when exclusion list build fails (non-critical)', async () => {
		vi.resetModules();

		const uid = 'u1';
		const campaignId = 'c_exclusion_fail';
		const firestore = new FakeFirestore({
			[`users/${uid}/campaigns/${campaignId}`]: { title: 'T' }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		// Force the profiles query to throw inside buildExclusionList.
		const originalList = (firestore as any)._listDocsInCollectionPath.bind(firestore);
		(firestore as any)._listDocsInCollectionPath = (collectionPath: string) => {
			if (collectionPath === `users/${uid}/campaigns/${campaignId}/profiles`) {
				throw new Error('boom');
			}
			return originalList(collectionPath);
		};

		vi.doMock('$lib/server/usage', () => ({
			getSearchUsage: vi.fn(async () => ({ count: 0, limit: 1000, remaining: 1000, resetDate: 'soon' })),
			incrementSearchUsage: vi.fn(async () => {})
		}));
		vi.doMock('$lib/server/firebase', () => ({
			getServiceAccountAccessToken: vi.fn(async () => 'token'),
			getCloudRunPipelineUrl: vi.fn(() => 'http://pipeline')
		}));
		vi.doMock('crypto', () => ({ randomUUID: () => 'req_exclusion_fail' }));

		const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
			const payload = JSON.parse(String(init?.body ?? '{}'));
			expect('exclude_profile_urls' in payload).toBe(false);
			return new Response(JSON.stringify({ job_id: 'job_x', request_id: 'req_fn_x' }), { status: 202 });
		});
		vi.stubGlobal('fetch', fetchSpy as any);

		const { POST } = await import('../../../src/routes/api/search/influencers/+server');
		const res = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid,
				body: { business_description: 'coffee', top_n: 10, campaign_id: campaignId }
			})
		);
		expect(res.status).toBe(200);
	});

	it('POST uses pipeline error/message fallbacks when pipeline response omits them', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/usage', () => ({
			getSearchUsage: vi.fn(async () => ({ count: 0, limit: 1000, remaining: 1000, resetDate: 'soon' })),
			incrementSearchUsage: vi.fn(async () => {})
		}));
		vi.doMock('$lib/server/firebase', () => ({
			getServiceAccountAccessToken: vi.fn(async () => 'token'),
			getCloudRunPipelineUrl: vi.fn(() => 'http://pipeline')
		}));
		vi.doMock('crypto', () => ({ randomUUID: () => 'req_nonok_fallbacks' }));

		const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 500 }));
		vi.stubGlobal('fetch', fetchSpy as any);

		const { POST } = await import('../../../src/routes/api/search/influencers/+server');
		const res = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid: 'u1',
				body: { business_description: 'coffee', top_n: 10 }
			})
		);
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.error.code).toBe('PIPELINE_ERROR');
	});

	it('POST returns completed response when pipeline service responds 200', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/usage', () => ({
			getSearchUsage: vi.fn(async () => ({ count: 0, limit: 1000, remaining: 1000, resetDate: 'soon' })),
			incrementSearchUsage: vi.fn(async () => {})
		}));
		vi.doMock('$lib/server/firebase', () => ({
			getServiceAccountAccessToken: vi.fn(async () => 'token'),
			getCloudRunPipelineUrl: vi.fn(() => 'http://pipeline')
		}));
		vi.doMock('crypto', () => ({ randomUUID: () => 'req_sync' }));

		const fetchSpy = vi.fn(async () =>
			new Response(
				JSON.stringify({
					job_id: 'job_sync',
					request_id: 'req_fn_sync',
					status: 'completed',
					profiles_count: 1,
					profiles_storage_url: 'gs://bucket/file.json',
					pipeline_stats: { ok: true }
				}),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fetchSpy as any);

		const { POST } = await import('../../../src/routes/api/search/influencers/+server');
		const res = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid: 'u1',
				body: { business_description: 'coffee', top_n: 10 }
			})
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('completed');
		expect(body.job_id).toBe('job_sync');
		expect(body.profiles_count).toBe(1);
	});

	it('POST reports binding failed after retries (non-critical)', async () => {
		vi.resetModules();
		vi.useFakeTimers();

		const uid = 'u1';
		const campaignId = 'c_bind_fail';
		const firestore = new FakeFirestore({
			[`users/${uid}/campaigns/${campaignId}`]: { title: 'T' }
		});
		const originalRunTransaction = firestore.runTransaction.bind(firestore);
		firestore.runTransaction = vi.fn(async () => {
			throw new Error('boom');
		}) as any;

		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/usage', () => ({
			getSearchUsage: vi.fn(async () => ({ count: 0, limit: 1000, remaining: 1000, resetDate: 'soon' })),
			incrementSearchUsage: vi.fn(async () => {})
		}));
		vi.doMock('$lib/server/firebase', () => ({
			getServiceAccountAccessToken: vi.fn(async () => 'token'),
			getCloudRunPipelineUrl: vi.fn(() => 'http://pipeline')
		}));
		vi.doMock('crypto', () => ({ randomUUID: () => 'req_bind_fail' }));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ job_id: 'job_fail', request_id: 'req_fn_fail' }), { status: 202 })) as any
		);

		const { POST } = await import('../../../src/routes/api/search/influencers/+server');
			const event = makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid,
				body: { business_description: 'coffee', top_n: 10, campaign_id: campaignId }
			});

			const resPromise = POST(event);
			await vi.runAllTimersAsync();
			const res = await resPromise;
			const body = await res.json();
			expect(res.status, JSON.stringify(body)).toBe(200);
			expect(body.campaign_binding_status).toBe('failed');

		// Restore original method to keep FakeFirestore instance sane (test-local anyway).
		firestore.runTransaction = originalRunTransaction;
		vi.useRealTimers();
	});

		it('POST logs but does not fail when pipeline doc persistence fails (non-critical)', async () => {
			vi.resetModules();

			const uid = 'u1';
			const campaignId = 'c1';
			const pipelineId = 'job_doc_fail';

			const firestore = new FakeFirestore({
				[`users/${uid}/campaigns/${campaignId}`]: { title: 'T' }
			});
			const pipelineDocPath = `users/${uid}/campaigns/${campaignId}/pipelines/${pipelineId}`;
			const originalSet = firestore._set.bind(firestore);
			firestore._set = ((path: string, data: any, options: any) => {
				if (String(path).includes(pipelineDocPath)) {
					throw new Error('boom');
				}
				return originalSet(path, data, options);
			}) as any;
			const { adminDb } = createFirebaseAdminMock({ firestore });
			vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

			vi.doMock('$lib/server/usage', () => ({
				getSearchUsage: vi.fn(async () => ({ count: 0, limit: 1000, remaining: 1000, resetDate: 'soon' })),
			incrementSearchUsage: vi.fn(async () => {})
		}));
		vi.doMock('$lib/server/firebase', () => ({
			getServiceAccountAccessToken: vi.fn(async () => 'token'),
			getCloudRunPipelineUrl: vi.fn(() => 'http://pipeline')
			}));
			vi.doMock('crypto', () => ({ randomUUID: () => 'req_doc_fail' }));

			vi.stubGlobal(
				'fetch',
				vi.fn(async () => new Response(JSON.stringify({ job_id: pipelineId, request_id: 'req_fn' }), { status: 202 })) as any
			);

		const warn = vi.fn();
		const logger: any = { child: () => logger, warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() };

		const { POST } = await import('../../../src/routes/api/search/influencers/+server');
		const event = makeEvent({
			method: 'POST',
			url: 'http://localhost/api/search/influencers',
			uid,
			body: { business_description: 'coffee', top_n: 10, campaign_id: campaignId }
		});
		event.locals.logger = logger;

		const res = await POST(event);
		expect(res.status).toBe(200);

		// createPipelineDoc is fire-and-forget.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(warn.mock.calls.some(([msg]) => String(msg).includes('Failed to create pipeline doc'))).toBe(true);
	});

	it('POST catches binding exceptions (non-critical)', async () => {
		vi.resetModules();

		const uid = 'u1';
		const campaignId = 'c_throw';
		const firestore = new FakeFirestore({
			[`users/${uid}/campaigns/${campaignId}`]: { title: 'T' }
		});
		const originalRunTransaction = firestore.runTransaction.bind(firestore);
		let calls = 0;
		firestore.runTransaction = vi.fn(async (fn: any) => {
			calls++;
			if (calls === 1) {
				throw new Error('transient');
			}
			return originalRunTransaction(fn);
		}) as any;

		const originalSetTimeout = globalThis.setTimeout;
		(globalThis as any).setTimeout = (() => {
			throw new Error('timer broke');
		}) as any;

		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/usage', () => ({
			getSearchUsage: vi.fn(async () => ({ count: 0, limit: 1000, remaining: 1000, resetDate: 'soon' })),
			incrementSearchUsage: vi.fn(async () => {})
		}));
		vi.doMock('$lib/server/firebase', () => ({
			getServiceAccountAccessToken: vi.fn(async () => 'token'),
			getCloudRunPipelineUrl: vi.fn(() => 'http://pipeline')
		}));
		vi.doMock('crypto', () => ({ randomUUID: () => 'req_bind_throw' }));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ job_id: 'job_throw', request_id: 'req_fn_throw' }), { status: 202 })) as any
		);

		const { POST } = await import('../../../src/routes/api/search/influencers/+server');
			const event = makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid,
				body: { business_description: 'coffee', top_n: 10, campaign_id: campaignId }
			});

			const res = await POST(event);
			const body = await res.json();
			expect(res.status, JSON.stringify(body)).toBe(200);
			expect(body.campaign_binding_status).toBe('failed');

		(globalThis as any).setTimeout = originalSetTimeout;
		firestore.runTransaction = originalRunTransaction;
	});

	it('POST maps unexpected errors to INTERNAL_ERROR', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/usage', () => ({
			getSearchUsage: vi.fn(async () => ({ count: 0, limit: 1000, remaining: 1000, resetDate: 'soon' })),
			incrementSearchUsage: vi.fn(async () => {})
		}));
		vi.doMock('$lib/server/firebase', () => ({
			getServiceAccountAccessToken: vi.fn(async () => 'token'),
			getCloudRunPipelineUrl: vi.fn(() => 'http://pipeline')
		}));
		vi.doMock('crypto', () => ({ randomUUID: () => 'req_unexpected' }));

		const { POST } = await import('../../../src/routes/api/search/influencers/+server');
		const url = new URL('http://localhost/api/search/influencers');
		const res = await POST({
			locals: { user: ({ uid: 'u1' } as any), requestId: 'req_local' },
			request: {
				method: 'POST',
				headers: new Headers({ origin: url.origin, 'content-type': 'application/json' }),
				json: vi.fn(async () => {
					throw new Error('boom');
				})
			} as any,
			url
		} as any);

		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('INTERNAL_ERROR');
	});

	it('POST calls pipeline service and returns accepted response', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		const getSearchUsage = vi.fn(async () => ({ count: 0, limit: 1000, remaining: 1000, resetDate: 'soon' }));
		const incrementSearchUsage = vi.fn(async () => {});
		vi.doMock('$lib/server/usage', () => ({ getSearchUsage, incrementSearchUsage }));

		const getServiceAccountAccessToken = vi.fn(async () => 'token');
		const getCloudRunPipelineUrl = vi.fn(() => 'http://pipeline');
		vi.doMock('$lib/server/firebase', () => ({ getServiceAccountAccessToken, getCloudRunPipelineUrl }));

		vi.doMock('crypto', () => ({ randomUUID: () => 'req_3' }));

		const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ job_id: 'job_1', request_id: 'req_fn' }), { status: 202 }));
		vi.stubGlobal('fetch', fetchSpy as any);

		const { POST } = await import('../../../src/routes/api/search/influencers/+server');
		const res = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid: 'u1',
				body: { business_description: 'coffee', top_n: 10 }
			})
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.job_id).toBe('job_1');
		expect(body.status).toBe('accepted');
		expect(incrementSearchUsage).toHaveBeenCalledWith('u1', 10);

		const call = fetchSpy.mock.calls[0];
		expect(call?.[0]).toBe('http://pipeline/pipeline/start');
		const init = call?.[1] as RequestInit;
		expect((init.headers as any).Authorization).toContain('Bearer token');
	});

	it('POST builds exclusion list and updates campaign pipeline_id', async () => {
		vi.resetModules();

		const uid = 'u1';
		const campaignId = 'c1';
		const firestore = new FakeFirestore({
			[`users/${uid}/campaigns/${campaignId}`]: { pipeline_id: 'old_job', status: 'ready' },
			[`users/${uid}/campaigns/${campaignId}/profiles/p1`]: { profile_url: 'https://instagram.com/a', last_seen_at: 2 },
			[`users/${uid}/campaigns/${campaignId}/profiles/p2`]: { profile_url: 'https://tiktok.com/@b', last_seen_at: 3 }
		});
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/usage', () => ({
			getSearchUsage: vi.fn(async () => ({ count: 0, limit: 1000, remaining: 1000, resetDate: 'soon' })),
			incrementSearchUsage: vi.fn(async () => {})
		}));
		vi.doMock('$lib/server/firebase', () => ({
			getServiceAccountAccessToken: vi.fn(async () => 'token'),
			getCloudRunPipelineUrl: vi.fn(() => 'http://pipeline')
		}));
		vi.doMock('crypto', () => ({ randomUUID: () => 'req_4' }));

		const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ job_id: 'job_2', request_id: 'req_fn_2' }), { status: 202 }));
		vi.stubGlobal('fetch', fetchSpy as any);

		const { POST } = await import('../../../src/routes/api/search/influencers/+server');
		const res = await POST(
			makeEvent({
				method: 'POST',
				url: 'http://localhost/api/search/influencers',
				uid,
				body: { business_description: 'coffee', top_n: 10, campaign_id: campaignId }
			})
		);
		expect(res.status).toBe(200);

		// Campaign doc updated via transaction binding.
		const snap = await adminDb.collection('users').doc(uid).collection('campaigns').doc(campaignId).get();
		expect(snap.get('pipeline_id')).toBe('job_2');

		// Exclusion URLs were sent to pipeline service.
		const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
		const payload = JSON.parse(String(init.body));
		expect(payload.exclude_profile_urls).toEqual(['https://tiktok.com/@b', 'https://instagram.com/a']);
	});

	it('GET returns current usage', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));

		vi.doMock('$lib/server/usage', () => ({
			getSearchUsage: vi.fn(async () => ({ count: 1, limit: 2, remaining: 1, resetDate: 'soon' })),
			incrementSearchUsage: vi.fn(async () => {})
		}));

		vi.doMock('$lib/server/firebase', () => ({
			getServiceAccountAccessToken: vi.fn(),
			getCloudRunPipelineUrl: vi.fn()
		}));

		const { GET } = await import('../../../src/routes/api/search/influencers/+server');
		const res = await GET(makeEvent({ method: 'GET', url: 'http://localhost/api/search/influencers', uid: 'u1' }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ count: 1, limit: 2, remaining: 1, resetDate: 'soon' });
	});
});
