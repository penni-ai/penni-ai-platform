import { describe, expect, it, vi } from 'vitest';

function makeEvent(options: {
	url: string;
	uid?: string;
	method: string;
	params?: Record<string, string>;
	body?: unknown;
	rawBody?: string;
}) {
	const url = new URL(options.url);
	return {
		locals: { user: options.uid ? ({ uid: options.uid, email: 'u@test.com' } as any) : null, requestId: 'req_test' },
		params: options.params ?? {},
		request: new Request(url.toString(), {
			method: options.method,
			headers: { origin: url.origin, 'content-type': 'application/json' },
			body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined)
		}),
		url
	} as any;
}

describe('routes/api/chat/[campaignId]', () => {
	it('GET returns 400 when campaignId missing', async () => {
		vi.resetModules();

		vi.doMock('$lib/server/chat/chatbot-client', () => ({
			getConversation: vi.fn(),
			sendMessage: vi.fn()
		}));
		vi.doMock('$lib/server/chat/mapper', () => ({ mapConversationToUi: vi.fn((x: any) => x) }));

		const { GET } = await import('../../../src/routes/api/chat/[campaignId]/+server');
		const res = await GET(makeEvent({ url: 'http://localhost/api/chat', uid: 'u1', method: 'GET', params: {} }));
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('CAMPAIGN_ID_REQUIRED');
	});

		it('GET maps conversation and handles known ApiProblem statuses', async () => {
			vi.resetModules();

			const getConversation = vi.fn(async () => ({
				conversation: { status: 'active', messages: [{ role: 'assistant', content: 'hi' }] }
			}));
			const mapConversationToUi = vi.fn((conv: any) => ({ mapped: true, status: conv.status }));
			vi.doMock('$lib/server/chat/chatbot-client', () => ({ getConversation, sendMessage: vi.fn() }));
			vi.doMock('$lib/server/chat/mapper', () => ({ mapConversationToUi }));

			const { ApiProblem } = await import('$lib/server/core/api');
			const { GET } = await import('../../../src/routes/api/chat/[campaignId]/+server');

		const ok = await GET(
			makeEvent({ url: 'http://localhost/api/chat/c1', uid: 'u1', method: 'GET', params: { campaignId: 'c1' } })
		);
		expect(ok.status).toBe(200);
		expect((await ok.json()).conversation).toEqual({ mapped: true, status: 'active' });

		getConversation.mockRejectedValueOnce(new ApiProblem({ status: 404, code: 'NOT_FOUND', message: 'nope' }));
		const notFound = await GET(
			makeEvent({ url: 'http://localhost/api/chat/c1', uid: 'u1', method: 'GET', params: { campaignId: 'c1' } })
		);
		expect(notFound.status).toBe(404);
		expect((await notFound.json()).error.code).toBe('CONVERSATION_NOT_FOUND');

		getConversation.mockRejectedValueOnce(new ApiProblem({ status: 504, code: 'TIMEOUT', message: 'timeout' }));
		const timeout = await GET(
			makeEvent({ url: 'http://localhost/api/chat/c1', uid: 'u1', method: 'GET', params: { campaignId: 'c1' } })
		);
		expect(timeout.status).toBe(504);

		getConversation.mockRejectedValueOnce(new ApiProblem({ status: 400, code: 'BAD', message: 'bad' }));
		const bad = await GET(
			makeEvent({ url: 'http://localhost/api/chat/c1', uid: 'u1', method: 'GET', params: { campaignId: 'c1' } })
		);
		expect(bad.status).toBe(400);
	});

	it('POST validates payload and wraps send errors', async () => {
		vi.resetModules();

		const sendMessage = vi.fn(async () => ({
			campaignId: 'c1',
			userMessage: { role: 'user', content: 'hi' },
			assistantMessages: [{ role: 'assistant', type: 'message', content: 'hello' }],
			conversation: { status: 'active', messages: [] }
		}));
		const mapConversationToUi = vi.fn((conv: any) => ({ mapped: true, status: conv.status }));
		vi.doMock('$lib/server/chat/chatbot-client', () => ({ getConversation: vi.fn(), sendMessage }));
		vi.doMock('$lib/server/chat/mapper', () => ({ mapConversationToUi }));

		const { POST } = await import('../../../src/routes/api/chat/[campaignId]/+server');

		const missingCampaign = await POST(makeEvent({ url: 'http://localhost/api/chat', uid: 'u1', method: 'POST', params: {}, body: {} }));
		expect(missingCampaign.status).toBe(400);

		const invalidJson = await POST(
			makeEvent({ url: 'http://localhost/api/chat/c1', uid: 'u1', method: 'POST', params: { campaignId: 'c1' }, rawBody: '{' })
		);
		expect(invalidJson.status).toBe(400);

		const invalidPayload = await POST(
			makeEvent({ url: 'http://localhost/api/chat/c1', uid: 'u1', method: 'POST', params: { campaignId: 'c1' }, body: 'nope' })
		);
		expect(invalidPayload.status).toBe(400);

		const missingMessage = await POST(
			makeEvent({ url: 'http://localhost/api/chat/c1', uid: 'u1', method: 'POST', params: { campaignId: 'c1' }, body: { message: '  ' } })
		);
		expect(missingMessage.status).toBe(400);

		const ok = await POST(
			makeEvent({ url: 'http://localhost/api/chat/c1', uid: 'u1', method: 'POST', params: { campaignId: 'c1' }, body: { message: 'hi' } })
		);
		expect(ok.status).toBe(200);
		expect((await ok.json()).conversation).toEqual({ mapped: true, status: 'active' });

		sendMessage.mockRejectedValueOnce(new Error('boom'));
		const failed = await POST(
			makeEvent({ url: 'http://localhost/api/chat/c1', uid: 'u1', method: 'POST', params: { campaignId: 'c1' }, body: { message: 'hi' } })
		);
		expect(failed.status).toBe(500);
		expect((await failed.json()).error.code).toBe('ASSISTANT_TURN_FAILED');
	});
});
