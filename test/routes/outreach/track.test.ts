import { describe, expect, it, vi } from 'vitest';

function makeEvent(options: { uid?: string; url?: string; body?: unknown; rawBody?: string }) {
	const url = new URL(options.url ?? 'http://localhost/api/outreach/track');
	return {
		locals: { user: options.uid ? ({ uid: options.uid, email: 'u@test.com' } as any) : null, requestId: 'req_test' },
		params: {},
		request: new Request(url.toString(), {
			method: 'POST',
			headers: { origin: url.origin, 'content-type': 'application/json' },
			body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined)
		}),
		url
	} as any;
}

describe('routes/api/outreach/track POST', () => {
	it('validates payload', async () => {
		vi.resetModules();

		vi.doMock('$lib/server/usage', () => ({ incrementOutreachUsage: vi.fn() }));
		vi.doMock('$lib/server/outreach/clear-selections', () => ({ clearSelectionsAfterSend: vi.fn() }));

		const { POST } = await import('../../../src/routes/api/outreach/track/+server');

		const badJson = await POST(makeEvent({ uid: 'u1', rawBody: '{' }));
		expect(badJson.status).toBe(400);

		const badPlatform = await POST(makeEvent({ uid: 'u1', body: { platform: 'gmail', count: 1 } }));
		expect(badPlatform.status).toBe(400);

		const badCount = await POST(makeEvent({ uid: 'u1', body: { platform: 'instagram', count: 0 } }));
		expect(badCount.status).toBe(400);
	});

	it('tracks usage and swallows tracking/clear failures', async () => {
		vi.resetModules();

		const incrementOutreachUsage = vi.fn(async () => {});
		const clearSelectionsAfterSend = vi.fn(async () => {
			throw new Error('clear failed');
		});

		const contactsSet = vi.fn(async (contact: any) => {
			if (String(contact?.influencerId).includes('/')) {
				throw new Error('write failed');
			}
		});
		const profileSet = vi.fn(async () => {});

		vi.doMock('$lib/server/usage', () => ({ incrementOutreachUsage }));
		vi.doMock('$lib/server/outreach/clear-selections', () => ({ clearSelectionsAfterSend }));
		vi.doMock('$lib/server/core/firestore', () => ({
			contactsCollectionRef: vi.fn(() => ({
				doc: vi.fn(() => ({ set: contactsSet }))
			})),
			campaignProfilesCollectionRef: vi.fn(() => ({
				doc: vi.fn(() => ({ set: profileSet }))
			}))
		}));

		const { POST } = await import('../../../src/routes/api/outreach/track/+server');
		const res = await POST(
			makeEvent({
				uid: 'u1',
				body: {
					platform: 'instagram',
					count: 2,
					campaignId: 'c1',
					influencers: [
						{ influencerId: 'inf/1', name: 'Bad Id', profileUrl: 'https://ig.test/bad' },
						{ influencerId: '   ', name: 'Whitespace', profileUrl: 'https://ig.test/ok' }
					]
				}
			})
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ success: true, platform: 'instagram', count: 2 });
		expect(incrementOutreachUsage).toHaveBeenCalledWith('u1', 2);

		// One influencer write fails, but the other should still attempt profile set and selection clear.
		expect(profileSet).toHaveBeenCalled();
		expect(clearSelectionsAfterSend).toHaveBeenCalled();
	});
});

