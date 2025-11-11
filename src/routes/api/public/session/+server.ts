import { adminAuth } from '$lib/firebase/admin';
import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute } from '$lib/server/api';

const SESSION_COOKIE_NAME = '__session';
const WEEK = 1000 * 60 * 60 * 24 * 7;
const FORTNIGHT = 1000 * 60 * 60 * 24 * 14;

type SessionBody = {
	idToken?: string;
	remember?: boolean;
};

export const POST = handleApiRoute(async (event) => {
	assertSameOrigin(event);
	let body: SessionBody;
	try {
		body = await event.request.json();
	} catch (error) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_JSON',
			message: 'Request body must be valid JSON.',
			hint: 'Send a JSON payload containing the Firebase ID token.',
			cause: error
		});
	}

	const idToken = typeof body.idToken === 'string' ? body.idToken.trim() : '';
	const remember = Boolean(body.remember);

	if (!idToken) {
		throw new ApiProblem({
			status: 400,
			code: 'MISSING_ID_TOKEN',
			message: 'Firebase ID token is required.',
			hint: 'Pass the ID token from Firebase authentication in the "idToken" field.'
		});
	}

	const expiresIn = remember ? FORTNIGHT : WEEK;
	const logger = event.locals.logger.child({ component: 'auth', action: 'create_session' });

	try {
		const decoded = await adminAuth.verifyIdToken(idToken);

		if (!decoded.email_verified) {
			throw new ApiProblem({
				status: 403,
				code: 'EMAIL_NOT_VERIFIED',
				message: 'Email is not verified. Please verify before creating a session.',
				hint: 'Check your inbox for a verification link and try again.'
			});
		}

		const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn });
		event.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
			httpOnly: true,
			secure: process.env.NODE_ENV === 'production',
			path: '/',
			sameSite: 'lax',
			maxAge: Math.floor(expiresIn / 1000)
		});

		logger.info('Session cookie issued', { uid: decoded.uid });

		return apiOk({
			status: 'ok',
			uid: decoded.uid,
			email: decoded.email ?? null
		});
	} catch (error) {
		if (error instanceof ApiProblem) {
			throw error;
		}
		logger.error('Failed to create session cookie', { error });
		throw new ApiProblem({
			status: 401,
			code: 'ID_TOKEN_INVALID',
			message: 'Invalid or expired authentication token.',
			hint: 'Refresh your Firebase ID token and try again.',
			cause: error
		});
	}
}, { component: 'auth' });
