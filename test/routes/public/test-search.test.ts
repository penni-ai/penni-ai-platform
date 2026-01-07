import { describe, expect, it, vi } from 'vitest';

function makeEvent(body: unknown) {
	const url = new URL('http://localhost/api/public/test-search');
	return {
		locals: { user: null, requestId: 'req_test' },
		request: new Request(url.toString(), {
			method: 'POST',
			headers: { origin: url.origin, 'content-type': 'application/json' },
			body: typeof body === 'string' ? body : JSON.stringify(body)
		}),
		url
	} as any;
}

describe('routes/api/public/test-search', () => {
	it('blocks access outside emulator/E2E mode', async () => {
		vi.resetModules();
		vi.stubEnv('E2E_TESTING', '');
		vi.doMock('$lib/server/firebase', () => ({ invokeSearchPipeline: vi.fn() }));

		const { POST } = await import('../../../src/routes/api/public/test-search/+server');
		const res = await POST(makeEvent({ search: { query: 'coffee' } }));
		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe('TEST_SEARCH_DISABLED');
	});

	it('rejects invalid JSON and invalid payload', async () => {
		vi.resetModules();
		vi.stubEnv('E2E_TESTING', 'true');
		vi.doMock('$lib/server/firebase', () => ({ invokeSearchPipeline: vi.fn() }));

		const { POST } = await import('../../../src/routes/api/public/test-search/+server');

		const badJson = {
			...makeEvent({}),
			request: new Request('http://localhost/api/public/test-search', {
				method: 'POST',
				headers: { origin: 'http://localhost', 'content-type': 'application/json' },
				body: '{'
			})
		} as any;
		const res1 = await POST(badJson);
		expect(res1.status).toBe(400);
		expect((await res1.json()).error.code).toBe('INVALID_JSON');

		const res2 = await POST(makeEvent(JSON.stringify('not an object')));
		expect(res2.status).toBe(400);
		expect((await res2.json()).error.code).toBe('INVALID_PAYLOAD');
	});

	it('validates search.query', async () => {
		vi.resetModules();
		vi.stubEnv('E2E_TESTING', 'true');
		vi.doMock('$lib/server/firebase', () => ({ invokeSearchPipeline: vi.fn() }));

		const { POST } = await import('../../../src/routes/api/public/test-search/+server');
		const res = await POST(makeEvent({ search: { query: '' } }));
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('INVALID_SEARCH_QUERY');
	});

	it('returns stage results and includes raw when requested', async () => {
		vi.resetModules();
		vi.stubEnv('E2E_TESTING', 'true');
		const invokeSearchPipeline = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					result: { success: true, results: [], count: 0, stages: [], brightdata_results: [], profile_fit: [], pipeline_id: 'p1' }
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			);
		});
		vi.doMock('$lib/server/firebase', () => ({ invokeSearchPipeline }));

		const { POST } = await import('../../../src/routes/api/public/test-search/+server');
		const res = await POST(makeEvent({ include_raw: true, search: { query: 'coffee' } }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.stages).toEqual(['LIVE_ANALYSIS']);
		expect(body.results[0].ok).toBe(true);
		expect(body.results[0].response_summary.pipeline_id).toBe('p1');
		expect(body.results[0].raw_response).toBeTruthy();
	});

	it('reports function errors and stops', async () => {
		vi.resetModules();
		vi.stubEnv('E2E_TESTING', 'true');
		const invokeSearchPipeline = vi.fn(async () => {
			return new Response(JSON.stringify({ error: { message: 'bad' } }), {
				status: 500,
				headers: { 'content-type': 'application/json' }
			});
		});
		vi.doMock('$lib/server/firebase', () => ({ invokeSearchPipeline }));

		const { POST } = await import('../../../src/routes/api/public/test-search/+server');
		const res = await POST(makeEvent({ search: { query: 'coffee' } }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.results[0].ok).toBe(false);
		expect(body.results[0].error).toContain('bad');
	});

	it('handles requested stages, JSON parsing failures, request errors, and generic function errors', async () => {
		vi.resetModules();
		vi.stubEnv('E2E_TESTING', 'true');

		const invokeSearchPipeline = vi
			.fn()
			.mockResolvedValueOnce(new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }))
			.mockRejectedValueOnce(new Error('network down'))
			.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500, headers: { 'content-type': 'application/json' } }));

		vi.doMock('$lib/server/firebase', () => ({ invokeSearchPipeline }));

		const { POST } = await import('../../../src/routes/api/public/test-search/+server');

		const badJson = await POST(makeEvent({ stages: ['SEARCH'], search: { query: 'coffee' } }));
		expect(badJson.status).toBe(200);
		const body1 = await badJson.json();
		expect(body1.stages).toEqual(['LIVE_ANALYSIS']);
		expect(body1.results[0].ok).toBe(false);
		expect(body1.results[0].error).toBeTruthy();

		const requestFailed = await POST(makeEvent({ search: { query: 'coffee' } }));
		expect(requestFailed.status).toBe(200);
		const body2 = await requestFailed.json();
		expect(body2.results[0].error).toContain('network down');

		const generic = await POST(makeEvent({ search: { query: 'coffee' } }));
		expect(generic.status).toBe(200);
		const body3 = await generic.json();
		expect(body3.results[0].error).toContain('Function error');
	});
});
