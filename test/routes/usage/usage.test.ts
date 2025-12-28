import { describe, expect, it, vi } from 'vitest';

function makeEvent(uid?: string) {
	const url = new URL('http://localhost/api/usage');
	return {
		locals: { user: uid ? ({ uid } as any) : null, requestId: 'req_test' },
		request: new Request(url.toString(), { method: 'GET', headers: { origin: url.origin } }),
		url
	} as any;
}

describe('routes/api/usage', () => {
	it('GET returns search + outreach usage', async () => {
		vi.resetModules();

		vi.doMock('$lib/server/usage', () => ({
			getSearchUsage: vi.fn(async () => ({ count: 1, limit: 2, remaining: 1, resetDate: 'soon' })),
			getOutreachUsage: vi.fn(async () => ({ count: 3, remaining: 4 }))
		}));

		const { GET } = await import('../../../src/routes/api/usage/+server');
		const res = await GET(makeEvent('u1'));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			influencersFound: { count: 1, limit: 2, remaining: 1, resetDate: 'soon' },
			outreachSent: { count: 3, remaining: 4 }
		});
	});

	it('GET requires auth', async () => {
		vi.resetModules();
		vi.doMock('$lib/server/usage', () => ({ getSearchUsage: vi.fn(), getOutreachUsage: vi.fn() }));

		const { GET } = await import('../../../src/routes/api/usage/+server');
		const res = await GET(makeEvent());
		expect(res.status).toBe(401);
	});
});

