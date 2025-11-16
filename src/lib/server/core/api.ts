import { json, type HttpError, type Redirect, type RequestEvent } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { createLogger, type Logger } from './logger';

interface ApiErrorOptions {
	status: number;
	code: string;
	message: string;
	hint?: string;
	details?: Record<string, unknown>;
	logger?: Logger;
	cause?: unknown;
}

interface ApiProblemOptions extends Omit<ApiErrorOptions, 'logger'> {}

export class ApiProblem extends Error {
	readonly status: number;
	readonly code: string;
	readonly hint?: string;
	readonly details?: Record<string, unknown>;
	readonly cause?: unknown;

	constructor(options: ApiProblemOptions) {
		super(options.message);
		this.status = options.status;
		this.code = options.code;
		this.hint = options.hint;
		this.details = options.details;
		this.cause = options.cause;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

const toBody = (options: ApiErrorOptions) => ({
	error: {
		code: options.code,
		message: options.message,
		hint: options.hint ?? null,
		details: options.details ?? null
	}
});

export function apiError(options: ApiErrorOptions): Response {
	const logger = options.logger;
	if (logger) {
		const level = options.status >= 500 ? 'error' : 'warn';
		logger[level]('API error', {
			status: options.status,
			code: options.code,
			hint: options.hint ?? null,
			details: options.details ?? null,
			cause: options.cause
		});
	}

	return json(toBody(options), { status: options.status });
}

export function apiProblemResponse(problem: ApiProblem, logger?: Logger): Response {
	return apiError({
		status: problem.status,
		code: problem.code,
		message: problem.message,
		hint: problem.hint,
		details: problem.details,
		cause: problem.cause,
		logger
	});
}

export function apiOk<T>(payload: T, init?: ResponseInit): Response {
	return json(payload, init);
}

export function requireUser(event: RequestEvent): DecodedIdToken {
	const user = event.locals.user;
	if (!user) {
		throw new ApiProblem({
			status: 401,
			code: 'AUTH_REQUIRED',
			message: 'You must be signed in to access this resource.',
			hint: 'Sign in and retry.'
		});
	}
	return user;
}

export function assertSameOrigin(event: RequestEvent): void {
	const method = event.request.method.toUpperCase();
	if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
		return;
	}

	const origin = event.request.headers.get('origin');
	if (!origin) {
		throw new ApiProblem({
			status: 403,
			code: 'CSRF_ORIGIN_REQUIRED',
			message: 'Requests must include an Origin header.',
			hint: `Send the request from ${event.url.origin}.`
		});
	}

	const allowedOrigins = new Set<string>();
	const requestOrigin = normalizeOrigin(origin);
	const urlOrigin = normalizeOrigin(event.url.origin);
	const forwardedOrigin = resolveForwardedOrigin(event);
	const configuredOrigin = normalizeOrigin(publicEnv.PUBLIC_SITE_URL ?? null);

	if (urlOrigin) allowedOrigins.add(urlOrigin);
	if (forwardedOrigin) allowedOrigins.add(forwardedOrigin);
	if (configuredOrigin) allowedOrigins.add(configuredOrigin);

	if (!requestOrigin || !Array.from(allowedOrigins).includes(requestOrigin)) {
		throw new ApiProblem({
			status: 403,
			code: 'CSRF_ORIGIN_MISMATCH',
			message: 'Cross-origin requests are not allowed for this endpoint.',
			hint: `Allowed origins: ${Array.from(allowedOrigins).join(', ') || 'none'}.`
		});
	}
}

function normalizeOrigin(value: string | URL | null): string | null {
	if (!value) return null;
	try {
		const url = typeof value === 'string' ? new URL(value) : value;
		return `${url.protocol}//${url.host}`;
	} catch {
		return null;
	}
}

function resolveForwardedOrigin(event: RequestEvent): string | null {
	const forwardedHost = event.request.headers.get('x-forwarded-host');
	if (!forwardedHost) return null;
	const host = forwardedHost.split(',')[0]?.trim();
	if (!host) return null;
	const forwardedProto = event.request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
	const proto = forwardedProto || (event.url.protocol ? event.url.protocol.replace(/:$/, '') : 'https');
	const protocol = proto.endsWith(':') ? proto : `${proto}:`;
	return normalizeOrigin(`${protocol}//${host}`);
}

const ensureLogger = (event: RequestEvent): Logger => {
	if (event.locals.logger) {
		return event.locals.logger;
	}
	const fallback = createLogger({
		requestId: event.locals.requestId ?? undefined,
		component: 'api'
	});
	event.locals.logger = fallback;
	return fallback;
};

function isRedirectError(error: unknown): error is Redirect {
	return (
		typeof error === 'object' &&
		error !== null &&
		'location' in error &&
		typeof (error as { location?: unknown }).location === 'string' &&
		'status' in error
	);
}

function isHttpError(error: unknown): error is HttpError {
	return (
		typeof error === 'object' &&
		error !== null &&
		'status' in error &&
		typeof (error as { status?: unknown }).status === 'number' &&
		'body' in error
	);
}

export function handleApiRoute(
	handler: (event: RequestEvent) => Promise<Response> | Response,
	options?: { component?: string }
) {
	return async (event: RequestEvent) => {
		const parentLogger = event.locals.logger;
		const baseLogger = ensureLogger(event);
		const logger = options?.component
			? baseLogger.child({ component: options.component })
			: baseLogger.child({ component: 'api' });
		event.locals.logger = logger;

		try {
			return await handler(event);
		} catch (error) {
			if (isRedirectError(error) || isHttpError(error)) {
				throw error;
			}
			if (error instanceof ApiProblem) {
				return apiProblemResponse(error, logger);
			}
			logger.error('Unhandled API error', { error, path: event.url.pathname });
			return apiError({
				status: 500,
				code: 'INTERNAL_SERVER_ERROR',
				message: 'Something went wrong while processing this request.',
				hint: 'Please retry later.',
				logger,
				cause: error
			});
		} finally {
			event.locals.logger = parentLogger ?? baseLogger;
		}
	};
}
