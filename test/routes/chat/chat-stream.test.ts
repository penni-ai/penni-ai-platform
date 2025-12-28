import { describe, expect, it, vi } from 'vitest';

function makeEvent(options: { uid?: string; params?: Record<string, string>; body?: unknown; rawBody?: string }) {
	const url = new URL('http://localhost/api/chat/c1/stream');
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
	const body = res.body;
	if (!body) return '';
	const reader = body.getReader();
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

describe('routes/api/chat/[campaignId]/stream POST', () => {
	it('validates inputs before streaming', async () => {
		vi.resetModules();
		vi.doMock('$lib/server/chat/chatbot-client', () => ({ sendMessage: vi.fn() }));
		vi.doMock('$lib/server/chat/mapper', () => ({ mapConversationToUi: vi.fn((x: any) => x) }));

		const { POST } = await import('../../../src/routes/api/chat/[campaignId]/stream/+server');

		const missing = await POST(makeEvent({ uid: 'u1', params: {}, body: { message: 'hi' } }));
		expect(missing.status).toBe(400);

		const invalidJson = await POST(makeEvent({ uid: 'u1', params: { campaignId: 'c1' }, rawBody: '{' }));
		expect(invalidJson.status).toBe(400);

		const invalidPayload = await POST(makeEvent({ uid: 'u1', params: { campaignId: 'c1' }, body: 'nope' }));
		expect(invalidPayload.status).toBe(400);

		const missingMessage = await POST(makeEvent({ uid: 'u1', params: { campaignId: 'c1' }, body: { message: '  ' } }));
		expect(missingMessage.status).toBe(400);
	});

	it('streams deltas and final conversation', async () => {
		vi.resetModules();
		vi.useFakeTimers();

		const sendMessage = vi.fn(async () => ({
			campaignId: 'c1',
			userMessage: { role: 'user', content: 'hi' },
			assistantMessages: [
				{
					role: 'assistant',
					type: 'message',
					content: 'This is a reply that is longer than twenty four characters.'
				}
			],
			conversation: { status: 'active', messages: [] }
		}));
		vi.doMock('$lib/server/chat/chatbot-client', () => ({ sendMessage }));
		vi.doMock('$lib/server/chat/mapper', () => ({ mapConversationToUi: vi.fn(() => ({ mapped: true })) }));

		const { POST } = await import('../../../src/routes/api/chat/[campaignId]/stream/+server');
		const res = await POST(makeEvent({ uid: 'u1', params: { campaignId: 'c1' }, body: { message: 'hi' } }));

		const readPromise = readAll(res);
		await vi.runAllTimersAsync();
		const text = await readPromise;

		expect(text).toContain('event: ack');
		expect(text).toContain('"campaignId":"c1"');
		expect(text).toContain('event: delta');
		expect(text).toContain('event: final');

		vi.useRealTimers();
	});

	it('skips delta replay when no primary assistant reply exists', async () => {
		vi.resetModules();

		vi.doMock('$lib/server/chat/chatbot-client', () => ({
			sendMessage: vi.fn(async () => ({
				campaignId: 'c1',
				userMessage: { role: 'user', content: 'hi' },
				assistantMessages: [{ role: 'assistant', type: 'summary', content: 'summary' }],
				conversation: { status: 'active', messages: [] }
			}))
		}));
		vi.doMock('$lib/server/chat/mapper', () => ({ mapConversationToUi: vi.fn(() => ({ mapped: true })) }));

		const { POST } = await import('../../../src/routes/api/chat/[campaignId]/stream/+server');
		const res = await POST(makeEvent({ uid: 'u1', params: { campaignId: 'c1' }, body: { message: 'hi' } }));
		const text = await readAll(res);
		expect(text).toContain('event: final');
		expect(text).not.toContain('event: delta');
	});

	it('streams error event for Error instances', async () => {
		vi.resetModules();

		vi.doMock('$lib/server/chat/chatbot-client', () => ({
			sendMessage: vi.fn(async () => {
				throw new Error('boom');
			})
		}));
		vi.doMock('$lib/server/chat/mapper', () => ({ mapConversationToUi: vi.fn((x: any) => x) }));

		const { POST } = await import('../../../src/routes/api/chat/[campaignId]/stream/+server');
		const res = await POST(makeEvent({ uid: 'u1', params: { campaignId: 'c1' }, body: { message: 'hi' } }));
		const text = await readAll(res);
		expect(text).toContain('event: error');
		expect(text).toContain('boom');
	});

	it('streams error event for string throws', async () => {
		vi.resetModules();

		vi.doMock('$lib/server/chat/chatbot-client', () => ({
			sendMessage: vi.fn(async () => {
				throw 'oops';
			})
		}));
		vi.doMock('$lib/server/chat/mapper', () => ({ mapConversationToUi: vi.fn((x: any) => x) }));

		const { POST } = await import('../../../src/routes/api/chat/[campaignId]/stream/+server');
		const res = await POST(makeEvent({ uid: 'u1', params: { campaignId: 'c1' }, body: { message: 'hi' } }));
		const text = await readAll(res);
		expect(text).toContain('oops');
	});

	it('streams error event for status+code objects', async () => {
		vi.resetModules();

		vi.doMock('$lib/server/chat/chatbot-client', () => ({
			sendMessage: vi.fn(async () => {
				throw { status: 502, code: 'CHATBOT_DOWN', message: 'service down' };
			})
		}));
		vi.doMock('$lib/server/chat/mapper', () => ({ mapConversationToUi: vi.fn((x: any) => x) }));

		const { POST } = await import('../../../src/routes/api/chat/[campaignId]/stream/+server');
		const res = await POST(makeEvent({ uid: 'u1', params: { campaignId: 'c1' }, body: { message: 'hi' } }));
		const text = await readAll(res);
		expect(text).toContain('service down');
	});

	it('aborts in-flight work when the client cancels the stream', async () => {
		vi.resetModules();

		let capturedSignal: AbortSignal | undefined;
		const sendMessage = vi.fn(async (_campaignId: string, _message: string, opts: any) => {
			capturedSignal = opts.signal as AbortSignal | undefined;
			return await new Promise(() => {});
		});
		vi.doMock('$lib/server/chat/chatbot-client', () => ({ sendMessage }));
		vi.doMock('$lib/server/chat/mapper', () => ({ mapConversationToUi: vi.fn((x: any) => x) }));

		const { POST } = await import('../../../src/routes/api/chat/[campaignId]/stream/+server');
		const res = await POST(makeEvent({ uid: 'u1', params: { campaignId: 'c1' }, body: { message: 'hi' } }));

		await res.body?.cancel();
		expect(capturedSignal?.aborted).toBe(true);
	});
});
