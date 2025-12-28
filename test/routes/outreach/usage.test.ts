import { describe, expect, it, vi } from 'vitest';

function makeEvent(options: { uid?: string; url: string }) {
	const url = new URL(options.url);
	return {
		locals: { user: options.uid ? ({ uid: options.uid, email: 'u@test.com' } as any) : null, requestId: 'req_test' },
		params: {},
		request: new Request(url.toString(), { method: 'GET' }),
		url
	} as any;
}

describe('routes/api/outreach/usage GET', () => {
	it('requires auth', async () => {
		vi.resetModules();
		vi.doMock('$lib/server/usage', () => ({ getOutreachUsage: vi.fn() }));
		const { GET } = await import('../../../src/routes/api/outreach/usage/+server');
		const res = await GET(makeEvent({ url: 'http://localhost/api/outreach/usage' }));
		expect(res.status).toBe(401);
	});

	it('returns usage payload', async () => {
		vi.resetModules();
		vi.doMock('$lib/server/usage', () => ({ getOutreachUsage: vi.fn(async () => ({ remaining: 3 })) }));
		const { GET } = await import('../../../src/routes/api/outreach/usage/+server');
		const res = await GET(makeEvent({ url: 'http://localhost/api/outreach/usage', uid: 'u1' }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ remaining: 3 });
	});
});

