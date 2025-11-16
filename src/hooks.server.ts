import { randomUUID } from 'crypto';
import type { Handle } from '@sveltejs/kit';
import { adminAuth } from '$lib/firebase/admin';
import { apiError } from '$lib/server/core';
import { createLogger } from '$lib/server/core';

const SESSION_COOKIE_NAME = '__session';

export const handle: Handle = async ({ event, resolve }) => {
	const requestId = randomUUID();
	event.locals.requestId = requestId;
	const baseLogger = createLogger({ requestId, component: 'request', path: event.url.pathname });
	event.locals.logger = baseLogger;

	const sessionCookie = event.cookies.get(SESSION_COOKIE_NAME);
	let user = null;

	if (sessionCookie) {
		try {
			user = await adminAuth.verifySessionCookie(sessionCookie, true);
		} catch (error) {
			baseLogger.warn('Session verification failed', { error });
			event.cookies.delete(SESSION_COOKIE_NAME, {
				path: '/'
			});
		}
	}

	event.locals.user = user;
	if (user?.uid) {
		event.locals.logger = baseLogger.child({ userId: user.uid });
	} else {
		event.locals.logger = baseLogger.child({ userId: null });
	}

	const pathname = event.url.pathname;
	const method = event.request.method.toUpperCase();
	const isApiRequest = pathname.startsWith('/api/');
	const isPublicApi = pathname.startsWith('/api/public/');
	const isSessionDelete = pathname === '/api/session' && method === 'DELETE';
	const skipAuthCheck = isPublicApi || method === 'OPTIONS' || isSessionDelete;

	if (isApiRequest && !skipAuthCheck && !event.locals.user) {
		return apiError({
			status: 401,
			code: 'AUTH_REQUIRED',
			message: 'You must be signed in to access this API.',
			hint: 'Sign in and retry.',
			logger: event.locals.logger
		});
	}

	const response = await resolve(event);

	response.headers.set('X-Request-Id', requestId);
	if (process.env.NODE_ENV === 'production') {
		response.headers.set('X-Frame-Options', 'DENY');
		response.headers.set('X-Content-Type-Options', 'nosniff');
		response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}

	return response;
};
