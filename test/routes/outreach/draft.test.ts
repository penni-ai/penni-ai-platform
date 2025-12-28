import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(options: { uid?: string; body?: unknown; rawBody?: string }) {
	const url = new URL('http://localhost/api/outreach/draft');
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

describe('routes/api/outreach/draft POST', () => {
	it('validates JSON and payload', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'test', OPENAI_MODEL: 'm' } }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn() }));
		vi.doMock('$lib/server/openai', () => ({ openaiClient: { responses: { create: vi.fn() } }, DEFAULT_MODEL: 'm' }));

		const { POST } = await import('../../../src/routes/api/outreach/draft/+server');

		const invalidJson = await POST(makeEvent({ uid: 'u1', rawBody: '{' }));
		expect(invalidJson.status).toBe(400);
		expect((await invalidJson.json()).error.code).toBe('INVALID_JSON');

		const invalidPayload = await POST(makeEvent({ uid: 'u1', body: 'nope' }));
		expect(invalidPayload.status).toBe(400);
	});

	it('requires campaignId', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'test' } }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn(async () => ({})) }));
		vi.doMock('$lib/server/openai', () => ({ openaiClient: { responses: { create: vi.fn() } }, DEFAULT_MODEL: 'm' }));

		const { POST } = await import('../../../src/routes/api/outreach/draft/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { tone: 'friendly' } }));
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('CAMPAIGN_ID_REQUIRED');
	});

	it('returns 404 when campaign missing', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'test', OPENAI_MODEL: 'm' } }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn(async () => ({})) }));
		vi.doMock('$lib/server/openai', () => ({ openaiClient: { responses: { create: vi.fn() } }, DEFAULT_MODEL: 'm' }));

		const { POST } = await import('../../../src/routes/api/outreach/draft/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { campaignId: 'c1', tone: 'business', platform: 'email' } }));
		expect(res.status).toBe(404);
		expect((await res.json()).error.code).toBe('CAMPAIGN_NOT_FOUND');
	});

	it('returns 500 when OpenAI key missing', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({ 'users/u1/campaigns/c1': { title: 'T' } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn(async () => ({ title: 'T' })) }));
		vi.doMock('$lib/server/openai', () => ({ openaiClient: { responses: { create: vi.fn() } }, DEFAULT_MODEL: 'm' }));

		const { POST } = await import('../../../src/routes/api/outreach/draft/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { campaignId: 'c1', tone: 'business', platform: 'email' } }));
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('OPENAI_API_KEY_MISSING');
	});

	it('extracts message content from structured output and includes platform/tone defaults', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({ 'users/u1/campaigns/c1': { title: 'T' } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'test' } }));

		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn(async () => ({})) }));

		const create = vi.fn(async (req: any) => ({
			output: [
				{
					type: 'message',
					content: [{ type: 'output_text', text: ' Hello IG ' }]
				}
			],
			_req: req
		}));
		vi.doMock('$lib/server/openai', () => ({ openaiClient: { responses: { create } }, DEFAULT_MODEL: 'default' }));

		const { POST } = await import('../../../src/routes/api/outreach/draft/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { campaignId: 'c1', tone: 'nope', platform: 'instagram' } }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.message).toBe('Hello IG');
		expect(body.platform).toBe('instagram');
		expect(body.tone).toBe('business'); // default when invalid tone provided

		const prompt = create.mock.calls[0]?.[0]?.input?.[0]?.content as string;
		expect(prompt).toContain('Instagram direct message');
		expect(prompt).toContain('Use emojis sparingly');
	});

	it('returns 500 when OpenAI produces no content and maps unexpected errors', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({ 'users/u1/campaigns/c1': { title: 'T' } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'test' } }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn(async () => ({ title: 'T' })) }));

		const create = vi.fn(async () => ({ output_text: '   ' }));
		vi.doMock('$lib/server/openai', () => ({ openaiClient: { responses: { create } }, DEFAULT_MODEL: 'm' }));

		const { POST } = await import('../../../src/routes/api/outreach/draft/+server');
		const missing = await POST(makeEvent({ uid: 'u1', body: { campaignId: 'c1', platform: 'email' } }));
		expect(missing.status).toBe(500);
		expect((await missing.json()).error.code).toBe('MESSAGE_GENERATION_FAILED');

		vi.resetModules();
		const firestore2 = new FakeFirestore({ 'users/u1/campaigns/c1': { title: 'T' } });
		const { adminDb: adminDb2 } = createFirebaseAdminMock({ firestore: firestore2 });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb: adminDb2 }));
		vi.doMock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'test' } }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn(async () => ({ title: 'T' })) }));
		vi.doMock('$lib/server/openai', () => ({
			openaiClient: { responses: { create: vi.fn(async () => { throw new Error('boom'); }) } },
			DEFAULT_MODEL: 'm'
		}));

		const route2 = await import('../../../src/routes/api/outreach/draft/+server');
		const err = await route2.POST(makeEvent({ uid: 'u1', body: { campaignId: 'c1', platform: 'email' } }));
		expect(err.status).toBe(500);
		expect((await err.json()).error.code).toBe('DRAFT_FAILED');
	});

	it('drafts a message using OpenAI output_text', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({ 'users/u1/campaigns/c1': { title: 'T' } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'test', OPENAI_MODEL: 'm' } }));

		vi.doMock('$lib/server/campaigns', () => ({
			serializeCampaignRecord: vi.fn(async () => ({
				title: 'Title',
				website: 'https://example.com',
				businessSummary: 'About',
				type_of_influencer: 'food',
				locations: 'NYC'
			}))
		}));

		const create = vi.fn(async () => ({ output_text: ' Hello {{influencer_name}} ' }));
		vi.doMock('$lib/server/openai', () => ({ openaiClient: { responses: { create } }, DEFAULT_MODEL: 'm' }));

		const { POST } = await import('../../../src/routes/api/outreach/draft/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { campaignId: 'c1', tone: 'friendly', platform: 'email' } }));
		expect(res.status).toBe(200);
		expect((await res.json()).message).toBe('Hello {{influencer_name}}');
		expect(create).toHaveBeenCalled();
	});

	it('supports TikTok prompts and string content output', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({ 'users/u1/campaigns/c1': { title: 'T' } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'test', OPENAI_MODEL: 'm' } }));

		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn(async () => ({ title: 'T' })) }));

		const create = vi.fn(async () => ({ output: [{ type: 'message', content: ' Hello TT ' }] }));
		vi.doMock('$lib/server/openai', () => ({ openaiClient: { responses: { create } }, DEFAULT_MODEL: 'm' }));

		const { POST } = await import('../../../src/routes/api/outreach/draft/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { campaignId: 'c1', tone: 'friendly', platform: 'tiktok' } }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.message).toBe('Hello TT');

		const prompt = create.mock.calls[0]?.[0]?.input?.[0]?.content as string;
		expect(prompt).toContain('TikTok direct message');
	});
});
