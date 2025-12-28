import { describe, expect, it, vi } from 'vitest';

import { createFirebaseAdminMock, FakeFirestore } from '../../helpers/fake-firebase';

function makeEvent(options: { uid?: string; params?: Record<string, string>; body?: unknown; rawBody?: string }) {
	const url = new URL('http://localhost/api/outreach/draft/stream');
	return {
		locals: { user: options.uid ? ({ uid: options.uid, email: 'u@test.com' } as any) : null, requestId: 'req_test' },
		params: options.params ?? {},
		request: new Request(url.toString(), {
			method: 'POST',
			headers: { origin: url.origin, 'content-type': 'application/json' },
			body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined)
		}),
		url
	} as any;
}

async function readAll(res: Response) {
	const reader = res.body?.getReader();
	if (!reader) return '';
	const decoder = new TextDecoder();
	let out = '';
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		out += decoder.decode(value, { stream: true });
	}
	out += decoder.decode();
	return out;
}

describe('routes/api/outreach/draft/stream POST', () => {
	it('validates required campaignId', async () => {
		vi.resetModules();
		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'test', OPENAI_MODEL: 'm' } }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn() }));
		vi.doMock('$lib/server/openai', () => ({ openaiClient: { responses: { create: vi.fn() } }, DEFAULT_MODEL: 'm' }));

		const { POST } = await import('../../../src/routes/api/outreach/draft/stream/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { tone: 'business' } }));
		expect(res.status).toBe(400);
	});

	it('validates JSON and payload shape', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'test' } }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn() }));
		vi.doMock('$lib/server/openai', () => ({ openaiClient: { responses: { create: vi.fn() } }, DEFAULT_MODEL: 'm' }));

		const { POST } = await import('../../../src/routes/api/outreach/draft/stream/+server');
		const invalidJson = await POST(makeEvent({ uid: 'u1', rawBody: '{' }));
		expect(invalidJson.status).toBe(400);
		expect((await invalidJson.json()).error.code).toBe('INVALID_JSON');

		const invalidPayload = await POST(makeEvent({ uid: 'u1', body: 'nope' }));
		expect(invalidPayload.status).toBe(400);
		expect((await invalidPayload.json()).error.code).toBe('INVALID_PAYLOAD');
	});

	it('streams error events for missing campaign and missing OpenAI key', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore();
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn(async () => ({})) }));
		vi.doMock('$lib/server/openai', () => ({ openaiClient: { responses: { create: vi.fn() } }, DEFAULT_MODEL: 'm' }));

		const { POST } = await import('../../../src/routes/api/outreach/draft/stream/+server');
		const missingCampaign = await POST(makeEvent({ uid: 'u1', body: { campaignId: 'c1' } }));
		expect(missingCampaign.status).toBe(200);
		expect(await readAll(missingCampaign)).toContain('Campaign not found.');
	});

	it('streams error when OpenAI key missing and when no message is generated', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({ 'users/u1/campaigns/c1': { title: 'T' } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn(async () => ({ title: 'T' })) }));

		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		vi.doMock('$lib/server/openai', () => ({ openaiClient: { responses: { create: vi.fn() } }, DEFAULT_MODEL: 'm' }));

		const { POST } = await import('../../../src/routes/api/outreach/draft/stream/+server');
		const missingKey = await POST(makeEvent({ uid: 'u1', body: { campaignId: 'c1' } }));
		expect(await readAll(missingKey)).toContain('OpenAI API key is not configured.');

		vi.resetModules();
		const firestore2 = new FakeFirestore({ 'users/u1/campaigns/c1': { title: 'T' } });
		const { adminDb: adminDb2 } = createFirebaseAdminMock({ firestore: firestore2 });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb: adminDb2 }));
		vi.doMock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'test' } }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn(async () => ({ title: 'T' })) }));
		vi.doMock('$lib/server/openai', () => ({
			openaiClient: { responses: { create: vi.fn(async () => ({ output_text: '   ' })) } },
			DEFAULT_MODEL: 'm'
		}));

		const route2 = await import('../../../src/routes/api/outreach/draft/stream/+server');
		const noContent = await route2.POST(makeEvent({ uid: 'u1', body: { campaignId: 'c1' } }));
		expect(await readAll(noContent)).toContain('Failed to generate email message content.');
	});

	it('streams deltas and final message', async () => {
		vi.resetModules();
		vi.useFakeTimers();

		const firestore = new FakeFirestore({ 'users/u1/campaigns/c1': { title: 'T' } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'test', OPENAI_MODEL: 'm' } }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn(async () => ({ title: 'T' })) }));
		vi.doMock('$lib/server/openai', () => ({
			openaiClient: { responses: { create: vi.fn(async () => ({ output_text: 'Hello world' })) } },
			DEFAULT_MODEL: 'm'
		}));

		const { POST } = await import('../../../src/routes/api/outreach/draft/stream/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { campaignId: 'c1', platform: 'email', tone: 'friendly' } }));

		const readPromise = readAll(res);
		await vi.runAllTimersAsync();
		const text = await readPromise;

		expect(text).toContain('event: delta');
		expect(text).toContain('event: final');
		expect(text).toContain('Hello world');

		vi.useRealTimers();
	});

	it('supports customInstructions and structured OpenAI responses', async () => {
		vi.resetModules();
		vi.useFakeTimers();

		const firestore = new FakeFirestore({ 'users/u1/campaigns/c1': { title: 'T' } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'test' } }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn(async () => ({})) }));

		const create = vi.fn(async () => ({
			output: [
				{
					type: 'message',
					content: [{ type: 'output_text', text: 'abc' }]
				}
			]
		}));
		vi.doMock('$lib/server/openai', () => ({ openaiClient: { responses: { create } }, DEFAULT_MODEL: 'm' }));

		const { POST } = await import('../../../src/routes/api/outreach/draft/stream/+server');
		const longInstructions = 'x'.repeat(600);
		const res = await POST(
			makeEvent({
				uid: 'u1',
				body: { campaignId: 'c1', platform: 'tiktok', customInstructions: longInstructions }
			})
		);

		const readPromise = readAll(res);
		await vi.runAllTimersAsync();
		const text = await readPromise;
		expect(text).toContain('event: delta');
		expect(text).toContain('event: final');

		const prompt = create.mock.calls[0]?.[0]?.input?.[0]?.content as string;
		expect(prompt).toContain('Additional User Requirements');
		expect(prompt).toContain('x'.repeat(500));

		vi.useRealTimers();
	});

	it('includes campaign context for instagram, supports string output content, and cancels streams', async () => {
		vi.resetModules();
		vi.useFakeTimers();

		const firestore = new FakeFirestore({ 'users/u1/campaigns/c1': { title: 'T' } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'test', OPENAI_MODEL: 'm' } }));
		vi.doMock('$lib/server/campaigns', () => ({
			serializeCampaignRecord: vi.fn(async () => ({
				title: 'T',
				website: 'https://acme.test',
				businessSummary: 'Coffee brand',
				type_of_influencer: 'Food creators',
				locations: 'US'
			}))
		}));

		const create = vi
			.fn()
			.mockResolvedValueOnce({ output: [{ type: 'message', content: 'Hello from IG' }] })
			.mockResolvedValueOnce({ output_text: 'Hello from IG' });
		vi.doMock('$lib/server/openai', () => ({ openaiClient: { responses: { create } }, DEFAULT_MODEL: 'm' }));

		const { POST } = await import('../../../src/routes/api/outreach/draft/stream/+server');

		const res = await POST(makeEvent({ uid: 'u1', body: { campaignId: 'c1', platform: 'instagram', tone: 'friendly' } }));
		const readPromise = readAll(res);
		await vi.runAllTimersAsync();
		const text = await readPromise;
		expect(text).toContain('Hello from IG');

		const prompt = create.mock.calls[0]?.[0]?.input?.[0]?.content as string;
		expect(prompt).toContain('Website: https://acme.test');
		expect(prompt).toContain('Business Description: Coffee brand');
		expect(prompt).toContain('Type of Influencer: Food creators');
		expect(prompt).toContain('Target Locations: US');
		expect(prompt).toContain('Instagram direct message');

		const res2 = await POST(makeEvent({ uid: 'u1', body: { campaignId: 'c1', platform: 'instagram' } }));
		await res2.body?.cancel();
		await vi.runAllTimersAsync();

		vi.useRealTimers();
	});

	it('streams error message when OpenAI throws', async () => {
		vi.resetModules();

		const firestore = new FakeFirestore({ 'users/u1/campaigns/c1': { title: 'T' } });
		const { adminDb } = createFirebaseAdminMock({ firestore });
		vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
		vi.doMock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'test', OPENAI_MODEL: 'm' } }));
		vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn(async () => ({ title: 'T' })) }));
		vi.doMock('$lib/server/openai', () => ({
			openaiClient: { responses: { create: vi.fn(async () => { throw new Error('boom'); }) } },
			DEFAULT_MODEL: 'm'
		}));

		const { POST } = await import('../../../src/routes/api/outreach/draft/stream/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { campaignId: 'c1' } }));
		expect(await readAll(res)).toContain('boom');
	});

	it('swallows enqueue errors when the stream controller rejects writes', async () => {
		vi.resetModules();

		const originalEnqueue = (globalThis as any).ReadableStreamDefaultController.prototype.enqueue;
		(globalThis as any).ReadableStreamDefaultController.prototype.enqueue = () => {
			throw new Error('enqueue failed');
		};

		try {
			const firestore = new FakeFirestore({ 'users/u1/campaigns/c1': { title: 'T' } });
			const { adminDb } = createFirebaseAdminMock({ firestore });
			vi.doMock('$lib/firebase/admin', () => ({ adminDb }));
			vi.doMock('$env/dynamic/private', () => ({ env: { OPENAI_API_KEY: 'test', OPENAI_MODEL: 'm' } }));
			vi.doMock('$lib/server/campaigns', () => ({ serializeCampaignRecord: vi.fn(async () => ({ title: 'T' })) }));
			vi.doMock('$lib/server/openai', () => ({
				openaiClient: { responses: { create: vi.fn(async () => { throw new Error('boom'); }) } },
				DEFAULT_MODEL: 'm'
			}));

			const { POST } = await import('../../../src/routes/api/outreach/draft/stream/+server');
			const res = await POST(makeEvent({ uid: 'u1', body: { campaignId: 'c1' } }));
			expect(res.status).toBe(200);
			// No output expected (enqueue throws), but request should still complete.
			await readAll(res);
		} finally {
			(globalThis as any).ReadableStreamDefaultController.prototype.enqueue = originalEnqueue;
		}
	});
});
