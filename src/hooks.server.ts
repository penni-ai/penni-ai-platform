import { randomUUID } from 'crypto';
import type { Handle } from '@sveltejs/kit';
import { adminAuth } from '$lib/firebase/admin';
import { apiError } from '$lib/server/core';
import { createLogger } from '$lib/server/core';

const SESSION_COOKIE_NAME = '__session';
const SECURITY_HEADERS = {
	'X-Frame-Options': 'DENY',
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'strict-origin-when-cross-origin'
} as const;

// Log Firestore configuration on server startup
let firestoreStartupLogged = false;
if (!firestoreStartupLogged) {
	firestoreStartupLogged = true;
	const firestoreProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'unknown';
	const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST || 'none';
	console.info('[SvelteKit] Firestore configuration', {
		projectId: firestoreProjectId,
		emulatorHost: firestoreEmulatorHost,
		isEmulator: firestoreEmulatorHost !== 'none'
	});
}

export const handle: Handle = async ({ event, resolve }) => {
	const requestId = randomUUID();
	event.locals.requestId = requestId;
	const baseLogger = createLogger({ requestId, component: 'request', path: event.url.pathname });
	event.locals.logger = baseLogger;

	const applySecurityHeaders = (response: Response): Response => {
		response.headers.set('X-Request-Id', requestId);

		for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
			response.headers.set(key, value);
		}

		// Remove common fingerprinting headers where possible.
		response.headers.delete('server');
		response.headers.delete('Server');
		response.headers.delete('x-powered-by');
		response.headers.delete('X-Powered-By');

		// Only emit HSTS when the original request was HTTPS.
		const forwardedProto = event.request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
		const isHttps =
			(forwardedProto ? forwardedProto === 'https' : event.url.protocol === 'https:') &&
			event.url.hostname !== 'localhost' &&
			event.url.hostname !== '127.0.0.1';
		if (isHttps) {
			response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
		} else {
			response.headers.delete('Strict-Transport-Security');
		}

		// Default caching posture: avoid shared caches for app content.
		const path = event.url.pathname;
		const isApiRequest = path.startsWith('/api/');
		const isImmutableAsset =
			path.startsWith('/_app/immutable/') ||
			(path.startsWith('/_app/') && (path.endsWith('.js') || path.endsWith('.css') || path.endsWith('.map')));
		const isStaticAsset =
			isImmutableAsset ||
			path.startsWith('/images/') ||
			path.endsWith('.png') ||
			path.endsWith('.jpg') ||
			path.endsWith('.jpeg') ||
			path.endsWith('.webp') ||
			path.endsWith('.svg') ||
			path.endsWith('.ico') ||
			path.endsWith('.css') ||
			path.endsWith('.js');

		if (isApiRequest || !isStaticAsset) {
			response.headers.set('Cache-Control', 'no-store, max-age=0');
			response.headers.set('Pragma', 'no-cache');
			response.headers.set('Expires', '0');
		} else {
			// Allow browser caching for static assets, but prevent shared caches.
			response.headers.set('Cache-Control', isImmutableAsset ? 'private, max-age=31536000, immutable' : 'private, max-age=86400');
		}

		return response;
	};

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

	// Block proxy-debugging and rarely used methods.
	if (method === 'TRACE' || method === 'TRACK') {
		return applySecurityHeaders(new Response('Method Not Allowed', { status: 405 }));
	}

	// Disable OPTIONS on non-API routes (reduces proxy fingerprinting surface).
	if (method === 'OPTIONS' && !isApiRequest) {
		return applySecurityHeaders(new Response('Method Not Allowed', { status: 405 }));
	}

	if (isApiRequest && !skipAuthCheck && !event.locals.user) {
		return applySecurityHeaders(
			apiError({
				status: 401,
				code: 'AUTH_REQUIRED',
				message: 'You must be signed in to access this API.',
				hint: 'Sign in and retry.',
				logger: event.locals.logger
			})
		);
	}

	const response = await resolve(event);
	return applySecurityHeaders(response);
};
