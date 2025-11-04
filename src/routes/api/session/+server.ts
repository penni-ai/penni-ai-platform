import { json } from '@sveltejs/kit';
import { adminAuth } from '$lib/firebase/admin';

const SESSION_COOKIE_NAME = '__session';
const WEEK = 1000 * 60 * 60 * 24 * 7;
const FORTNIGHT = 1000 * 60 * 60 * 24 * 14;

export const POST = async ({ request, cookies }) => {
	try {
		const body = await request.json();
		const idToken = String(body.idToken ?? '');
		const remember = Boolean(body.remember);

		if (!idToken) {
			return json({ error: 'Missing idToken' }, { status: 400 });
		}

		const expiresIn = remember ? FORTNIGHT : WEEK;
		const decoded = await adminAuth.verifyIdToken(idToken);

		if (!decoded.email_verified) {
			return json({ error: 'Email not verified. Please verify before signing in.' }, { status: 403 });
		}
		const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn });

		cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
			httpOnly: true,
			secure: process.env.NODE_ENV === 'production',
			path: '/',
			sameSite: 'lax',
			maxAge: Math.floor(expiresIn / 1000)
		});

		return json({
			status: 'ok',
			uid: decoded.uid,
			email: decoded.email ?? null
		});
	} catch (error) {
		console.error('[auth] failed to create session cookie', error);
		const message = error instanceof Error ? error.message : 'Invalid authentication token.';
		return json({ error: message }, { status: 401 });
	}
};

export const DELETE = async ({ cookies, locals }) => {
	if (locals.user?.uid) {
		try {
			await adminAuth.revokeRefreshTokens(locals.user.uid);
		} catch (error) {
			console.warn('[auth] revokeRefreshTokens failed', error);
		}
	}

	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
	return json({ status: 'cleared' });
};
