import { describe, expect, it, vi } from 'vitest';

describe('server/chat/chatbot-client', () => {
	it('sends message in emulator mode with Firebase token auth', async () => {
		vi.resetModules();

		const mintIdToken = vi.fn(async () => 'firebase_token');
		vi.doMock('$lib/server/firebase/functions-client', () => ({
			mintIdToken,
			getServiceAccountAccessToken: vi.fn(async () => 'cloud_token')
		}));
		vi.doMock('../../../src/lib/server/chat/config', () => ({
			getChatbotServiceUrl: () => 'http://chat',
			isUsingEmulator: () => true
		}));

		const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
			const headers = init?.headers as Record<string, string>;
			expect(headers.Authorization).toBe('Bearer firebase_token');
			expect(headers['X-Firebase-Token']).toBe('firebase_token');
			return new Response(
				JSON.stringify({
					campaignId: 'c1',
					userMessage: { id: 'm1', role: 'user', content: 'hi', createdAt: 'now' },
					assistantMessages: [],
					conversation: { id: 'c1', status: 'ready', collected: {}, messages: [] }
				}),
				{ status: 200 }
			);
		});
		vi.stubGlobal('fetch', fetchSpy as any);

		const { sendMessage } = await import('../../../src/lib/server/chat/chatbot-client');
		const result = await sendMessage('c1', 'hi', { uid: 'u1' });
		expect(result.campaignId).toBe('c1');
		expect(mintIdToken).toHaveBeenCalledWith('u1');
	});

	it('uses Cloud Run service account auth in production mode when available', async () => {
		vi.resetModules();

		const mintIdToken = vi.fn(async () => 'firebase_token');
		const getServiceAccountAccessToken = vi.fn(async () => 'cloud_token');
		vi.doMock('$lib/server/firebase/functions-client', () => ({
			mintIdToken,
			getServiceAccountAccessToken
		}));
		vi.doMock('../../../src/lib/server/chat/config', () => ({
			getChatbotServiceUrl: () => 'http://chat',
			isUsingEmulator: () => false
		}));

		const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
			const headers = init?.headers as Record<string, string>;
			expect(headers.Authorization).toBe('Bearer cloud_token');
			expect(headers['X-Firebase-Token']).toBe('firebase_token');
			return new Response(JSON.stringify({ conversation: { id: 'c1', status: 'ready', collected: {}, messages: [] } }), {
				status: 200
			});
		});
		vi.stubGlobal('fetch', fetchSpy as any);

		const { getConversation } = await import('../../../src/lib/server/chat/chatbot-client');
		const res = await getConversation('c1', { uid: 'u1' });
		expect(res.conversation.id).toBe('c1');
		expect(getServiceAccountAccessToken).toHaveBeenCalledWith('http://chat');
	});

	it('falls back to Firebase token when service account auth fails (production mode)', async () => {
		vi.resetModules();

		const mintIdToken = vi.fn(async () => 'firebase_token');
		const getServiceAccountAccessToken = vi.fn(async () => {
			throw new Error('no adc');
		});

		vi.doMock('$lib/server/firebase/functions-client', () => ({
			mintIdToken,
			getServiceAccountAccessToken
		}));
		vi.doMock('../../../src/lib/server/chat/config', () => ({
			getChatbotServiceUrl: () => 'http://chat',
			isUsingEmulator: () => false
		}));

		const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
			const headers = init?.headers as Record<string, string>;
			expect(headers.Authorization).toBe('Bearer firebase_token');
			return new Response(JSON.stringify({ conversation: { id: 'c1', status: 'ready', collected: {}, messages: [] } }), {
				status: 200
			});
		});
		vi.stubGlobal('fetch', fetchSpy as any);

		const logger = { debug: vi.fn(), error: vi.fn() } as any;

		const { getConversation } = await import('../../../src/lib/server/chat/chatbot-client');
		const res = await getConversation('c1', { uid: 'u1', logger });
		expect(res.conversation.id).toBe('c1');
		expect(getServiceAccountAccessToken).toHaveBeenCalled();
		expect(logger.error).toHaveBeenCalled();
	});

	it('throws ChatbotClientError for non-OK responses', async () => {
		vi.resetModules();
		vi.doMock('$lib/server/firebase/functions-client', () => ({
			mintIdToken: vi.fn(async () => 'firebase_token'),
			getServiceAccountAccessToken: vi.fn(async () => 'cloud_token')
		}));
		vi.doMock('../../../src/lib/server/chat/config', () => ({
			getChatbotServiceUrl: () => 'http://chat',
			isUsingEmulator: () => true
		}));
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ detail: 'bad request' }), { status: 400 }))
		);

		const { sendMessage } = await import('../../../src/lib/server/chat/chatbot-client');
		await expect(sendMessage('c1', 'hi', { uid: 'u1' })).rejects.toMatchObject({
			name: 'ChatbotClientError',
			status: 400
		});
	});

	it('uses statusText fallback for non-JSON error bodies', async () => {
		vi.resetModules();
		vi.doMock('$lib/server/firebase/functions-client', () => ({
			mintIdToken: vi.fn(async () => 'firebase_token'),
			getServiceAccountAccessToken: vi.fn(async () => 'cloud_token')
		}));
		vi.doMock('../../../src/lib/server/chat/config', () => ({
			getChatbotServiceUrl: () => 'http://chat',
			isUsingEmulator: () => true
		}));
		vi.stubGlobal('fetch', vi.fn(async () => new Response('service down', { status: 500, statusText: 'Down' })) as any);

		const { getConversation } = await import('../../../src/lib/server/chat/chatbot-client');
		await expect(getConversation('c1', { uid: 'u1' })).rejects.toMatchObject({
			name: 'ChatbotClientError',
			status: 500
		});
	});

	it('throws REQUEST_TIMEOUT when request exceeds timeout', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.doMock('$lib/server/firebase/functions-client', () => ({
			mintIdToken: vi.fn(async () => 'firebase_token'),
			getServiceAccountAccessToken: vi.fn(async () => 'cloud_token')
		}));
		vi.doMock('../../../src/lib/server/chat/config', () => ({
			getChatbotServiceUrl: () => 'http://chat',
			isUsingEmulator: () => true
		}));

		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				return await new Promise((_resolve, reject) => {
					const signal = init?.signal as AbortSignal | undefined;
					if (signal?.aborted) {
						reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
						return;
					}
					signal?.addEventListener('abort', () => {
						reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
					});
				});
			})
		);

		const { getConversation } = await import('../../../src/lib/server/chat/chatbot-client');
		const p = getConversation('c1', { uid: 'u1', timeout: 10 });
		const expectation = expect(p).rejects.toMatchObject({ status: 504, code: 'REQUEST_TIMEOUT' });
		await vi.advanceTimersByTimeAsync(20);
		await expectation;
		vi.useRealTimers();
	});

	it('throws REQUEST_CANCELLED when external signal aborts', async () => {
		vi.resetModules();
		vi.useFakeTimers();
		vi.doMock('$lib/server/firebase/functions-client', () => ({
			mintIdToken: vi.fn(async () => 'firebase_token'),
			getServiceAccountAccessToken: vi.fn(async () => 'cloud_token')
		}));
		vi.doMock('../../../src/lib/server/chat/config', () => ({
			getChatbotServiceUrl: () => 'http://chat',
			isUsingEmulator: () => true
		}));

		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init?: RequestInit) => {
				return await new Promise((_resolve, reject) => {
					const signal = init?.signal as AbortSignal | undefined;
					if (signal?.aborted) {
						reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
						return;
					}
					signal?.addEventListener('abort', () => {
						reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
					});
				});
			})
		);

		const controller = new AbortController();
		const { getConversation } = await import('../../../src/lib/server/chat/chatbot-client');
		const p = getConversation('c1', { uid: 'u1', signal: controller.signal, timeout: 60_000 });
		const expectation = expect(p).rejects.toMatchObject({ status: 504, code: 'REQUEST_CANCELLED' });
		controller.abort();
		await expectation;
		vi.useRealTimers();
	});

	it('wraps network errors into ApiProblem', async () => {
		vi.resetModules();
		vi.doMock('$lib/server/firebase/functions-client', () => ({
			mintIdToken: vi.fn(async () => 'firebase_token'),
			getServiceAccountAccessToken: vi.fn(async () => 'cloud_token')
		}));
		vi.doMock('../../../src/lib/server/chat/config', () => ({
			getChatbotServiceUrl: () => 'http://chat',
			isUsingEmulator: () => true
		}));
		vi.stubGlobal('fetch', vi.fn(async () => {
			throw new Error('network');
		}));

		const { getConversation } = await import('../../../src/lib/server/chat/chatbot-client');
		await expect(getConversation('c1', { uid: 'u1' })).rejects.toMatchObject({
			status: 500,
			code: 'CHATBOT_SERVICE_ERROR'
		});
	});
});
