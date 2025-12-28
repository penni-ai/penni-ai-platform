import { describe, expect, it, vi } from 'vitest';

function makeEvent(options: {
	uid?: string;
	body?: unknown;
	rawBody?: string;
	logger?: any;
}): any {
	const url = new URL('http://localhost/api/campaigns/prefill-from-website');
	return {
		locals: {
			user: options.uid ? ({ uid: options.uid, email: 'u@test.com' } as any) : null,
			requestId: 'req_test',
			logger: options.logger
		},
		params: {},
		request: new Request(url.toString(), {
			method: 'POST',
			headers: { origin: url.origin, 'content-type': 'application/json' },
			body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined)
		}),
		url
	};
}

describe('routes/api/campaigns/prefill-from-website', () => {
	it('validates request body', async () => {
		vi.resetModules();

		const create = vi.fn();
		vi.doMock('$lib/server/openai', () => ({
			openaiClient: { chat: { completions: { create } } },
			DEFAULT_MODEL: 'gpt-test'
		}));
		vi.stubGlobal('fetch', vi.fn(async () => new Response('<html />', { status: 200 })) as any);

		const { POST } = await import('../../../src/routes/api/campaigns/prefill-from-website/+server');

		const invalidJson = await POST(makeEvent({ uid: 'u1', rawBody: '{' }));
		expect(invalidJson.status).toBe(400);
		expect((await invalidJson.json()).error.code).toBe('INVALID_JSON');

		const invalidPayload = await POST(makeEvent({ uid: 'u1', rawBody: JSON.stringify('x') }));
		expect(invalidPayload.status).toBe(400);
		expect((await invalidPayload.json()).error.code).toBe('INVALID_PAYLOAD');

		const missingUrl = await POST(makeEvent({ uid: 'u1', body: {} }));
		expect(missingUrl.status).toBe(400);
		expect((await missingUrl.json()).error.code).toBe('WEBSITE_URL_REQUIRED');

		const invalidUrl = await POST(makeEvent({ uid: 'u1', body: { websiteUrl: 'not a url' } }));
		expect(invalidUrl.status).toBe(400);
		expect((await invalidUrl.json()).error.code).toBe('INVALID_URL');
	});

	it('maps website fetch failures to WEBSITE_FETCH_FAILED', async () => {
		vi.resetModules();

		const create = vi.fn();
		vi.doMock('$lib/server/openai', () => ({
			openaiClient: { chat: { completions: { create } } },
			DEFAULT_MODEL: 'gpt-test'
		}));
		vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500, statusText: 'Bad' })) as any);

		const { POST } = await import('../../../src/routes/api/campaigns/prefill-from-website/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { websiteUrl: 'http://example.test' } }));
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('WEBSITE_FETCH_FAILED');
	});

	it('maps OpenAI failures to WEBSITE_ANALYSIS_FAILED', async () => {
		vi.resetModules();

		const create = vi.fn();
		vi.doMock('$lib/server/openai', () => ({
			openaiClient: { chat: { completions: { create } } },
			DEFAULT_MODEL: 'gpt-test'
		}));
		vi.stubGlobal('fetch', vi.fn(async () => new Response('<html />', { status: 200 })) as any);

		const { POST } = await import('../../../src/routes/api/campaigns/prefill-from-website/+server');

		create.mockResolvedValueOnce({ choices: [{ message: { content: '' } }] });
		const empty = await POST(makeEvent({ uid: 'u1', body: { websiteUrl: 'http://example.test' } }));
		expect(empty.status).toBe(500);
		expect((await empty.json()).error.code).toBe('WEBSITE_ANALYSIS_FAILED');

		create.mockResolvedValueOnce({ choices: [{ message: { content: 'not json' } }] });
		const invalidJson = await POST(makeEvent({ uid: 'u1', body: { websiteUrl: 'http://example.test' } }));
		expect(invalidJson.status).toBe(500);
		expect((await invalidJson.json()).error.code).toBe('WEBSITE_ANALYSIS_FAILED');

		create.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify('not-an-object') } }] });
		const invalidFormat = await POST(makeEvent({ uid: 'u1', body: { websiteUrl: 'http://example.test' } }));
		expect(invalidFormat.status).toBe(500);
		expect((await invalidFormat.json()).error.code).toBe('WEBSITE_ANALYSIS_FAILED');
	});

	it('truncates HTML, sanitizes OpenAI JSON fields, and returns 200', async () => {
		vi.resetModules();

		const create = vi.fn();
		vi.doMock('$lib/server/openai', () => ({
			openaiClient: { chat: { completions: { create } } },
			DEFAULT_MODEL: 'gpt-test'
		}));

		const longHtml = 'a'.repeat(50_000) + 'TAIL_MARKER';
		vi.stubGlobal('fetch', vi.fn(async () => new Response(longHtml, { status: 200 })) as any);

		create.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: JSON.stringify({
							brand: 123,
							website: 456,
							about: 'About text',
							influencerType: null
						})
					}
				}
			]
		});

		const { POST } = await import('../../../src/routes/api/campaigns/prefill-from-website/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { websiteUrl: 'http://example.test' } }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			brand: '',
			website: 'http://example.test',
			about: 'About text',
			influencerType: ''
		});

		const args = create.mock.calls[0]?.[0];
		const userMessage = args?.messages?.[1]?.content as string;
		expect(userMessage).not.toContain('TAIL_MARKER');
	});

	it('returns INTERNAL_ERROR when a non-ApiProblem error occurs after analysis', async () => {
		vi.resetModules();

		const create = vi.fn();
		vi.doMock('$lib/server/openai', () => ({
			openaiClient: { chat: { completions: { create } } },
			DEFAULT_MODEL: 'gpt-test'
		}));
		vi.stubGlobal('fetch', vi.fn(async () => new Response('<html />', { status: 200 })) as any);
		create.mockResolvedValueOnce({
			choices: [
				{ message: { content: JSON.stringify({ brand: 'Acme', website: 'http://example.test', about: 'A', influencerType: 'B' }) } }
			]
		});

		const logger = {
			child: vi.fn(function () {
				return this;
			}),
			info: vi.fn((message: string) => {
				if (message === 'Website analysis complete') throw new Error('logger broke');
			}),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn()
		};

		const { POST } = await import('../../../src/routes/api/campaigns/prefill-from-website/+server');
		const res = await POST(makeEvent({ uid: 'u1', body: { websiteUrl: 'http://example.test' }, logger }));
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('INTERNAL_ERROR');
	});
});
