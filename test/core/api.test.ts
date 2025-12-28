import { describe, expect, it, vi } from 'vitest';

import { ApiProblem, apiError, assertSameOrigin, handleApiRoute, requireUser } from '../../src/lib/server/core/api';

function makeEvent(options: {
	method: string;
	url: string;
	origin?: string;
	forwardedHost?: string;
	forwardedProto?: string;
	user?: any;
	logger?: any;
	requestId?: string;
	body?: unknown;
}) {
	const url = new URL(options.url);
	const headers = new Headers();
	if (options.origin) headers.set('origin', options.origin);
	if (options.forwardedHost) headers.set('x-forwarded-host', options.forwardedHost);
	if (options.forwardedProto) headers.set('x-forwarded-proto', options.forwardedProto);

	const init: RequestInit = { method: options.method, headers };
	if (options.body !== undefined) {
		init.body = JSON.stringify(options.body);
		headers.set('content-type', 'application/json');
	}

	return {
		locals: {
			user: options.user ?? null,
			logger: options.logger,
			requestId: options.requestId ?? 'req_test'
		},
		request: new Request(url.toString(), init),
		url
	} as any;
}

describe('core/api', () => {
	it('ApiProblem carries status, code, hint, details, cause', () => {
		const err = new ApiProblem({
			status: 400,
			code: 'BAD',
			message: 'nope',
			hint: 'try again',
			details: { a: 1 },
			cause: new Error('root')
		});
		expect(err).toBeInstanceOf(Error);
		expect(err.status).toBe(400);
		expect(err.code).toBe('BAD');
		expect(err.hint).toBe('try again');
		expect(err.details).toEqual({ a: 1 });
		expect(err.cause).toBeInstanceOf(Error);
	});

	it('apiError logs warn for 4xx and returns JSON response', async () => {
		const logger = {
			warn: vi.fn(),
			error: vi.fn()
		};
		const res = apiError({ status: 401, code: 'AUTH', message: 'no', logger });
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error.code).toBe('AUTH');
		expect(logger.warn).toHaveBeenCalledTimes(1);
		expect(logger.error).toHaveBeenCalledTimes(0);
	});

	it('apiError logs error for 5xx', () => {
		const logger = {
			warn: vi.fn(),
			error: vi.fn()
		};
		apiError({ status: 500, code: 'BOOM', message: 'bad', logger });
		expect(logger.error).toHaveBeenCalledTimes(1);
	});

	it('requireUser throws ApiProblem when missing', () => {
		expect(() => requireUser(makeEvent({ method: 'GET', url: 'http://localhost/api/x' }))).toThrow(
			ApiProblem
		);
	});

	it('assertSameOrigin allows GET without origin', () => {
		expect(() => assertSameOrigin(makeEvent({ method: 'GET', url: 'http://localhost/api/x' }))).not.toThrow();
	});

	it('assertSameOrigin rejects non-GET without origin', () => {
		expect(() =>
			assertSameOrigin(makeEvent({ method: 'POST', url: 'http://localhost/api/x', body: {} }))
		).toThrowError(/Origin header/);
	});

	it('assertSameOrigin allows when origin matches url.origin', () => {
		expect(() =>
			assertSameOrigin(
				makeEvent({
					method: 'POST',
					url: 'http://localhost/api/x',
					origin: 'http://localhost',
					body: {}
				})
			)
		).not.toThrow();
	});

	it('assertSameOrigin allows forwarded origin', () => {
		expect(() =>
			assertSameOrigin(
				makeEvent({
					method: 'POST',
					url: 'http://internal/api/x',
					origin: 'https://example.com',
					forwardedHost: 'example.com',
					forwardedProto: 'https',
					body: {}
				})
			)
		).not.toThrow();
	});

	it('assertSameOrigin rejects mismatched origin', () => {
		expect(() =>
			assertSameOrigin(
				makeEvent({
					method: 'POST',
					url: 'http://localhost/api/x',
					origin: 'https://evil.com',
					body: {}
				})
			)
		).toThrow(ApiProblem);
	});

	it('assertSameOrigin rejects invalid Origin header values', () => {
		expect(() =>
			assertSameOrigin(
				makeEvent({
					method: 'POST',
					url: 'http://localhost/api/x',
					origin: 'not a url',
					body: {}
				})
			)
		).toThrow(ApiProblem);
	});

	it('handleApiRoute wraps ApiProblem into JSON response', async () => {
		const handler = handleApiRoute(() => {
			throw new ApiProblem({ status: 400, code: 'BAD', message: 'no' });
		});
		const res = await handler(makeEvent({ method: 'GET', url: 'http://localhost/api/x', user: { uid: 'u' } }));
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe('BAD');
	});

	it('handleApiRoute returns 500 on unknown errors and restores parent logger', async () => {
		const parentLogger = { child: vi.fn(() => parentLogger), error: vi.fn(), warn: vi.fn(), info: vi.fn() };
		const handler = handleApiRoute(() => {
			throw new Error('boom');
		});
		const event = makeEvent({
			method: 'GET',
			url: 'http://localhost/api/x',
			user: { uid: 'u' },
			logger: parentLogger
		});
		const res = await handler(event);
		expect(res.status).toBe(500);
		expect(event.locals.logger).toBe(parentLogger);
	});

	it('handleApiRoute rethrows redirect-like errors', async () => {
		const handler = handleApiRoute(() => {
			throw { status: 302, location: '/next' };
		});
		await expect(handler(makeEvent({ method: 'GET', url: 'http://localhost/api/x', user: { uid: 'u' } }))).rejects.toMatchObject({
			status: 302,
			location: '/next'
		});
	});
});
