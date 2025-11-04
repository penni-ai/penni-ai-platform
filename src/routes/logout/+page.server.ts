import { redirect } from '@sveltejs/kit';
import { adminAuth } from '$lib/firebase/admin';

const SESSION_COOKIE_NAME = '__session';

export const load = async ({ cookies, locals }) => {
	if (locals.user?.uid) {
		try {
			await adminAuth.revokeRefreshTokens(locals.user.uid);
		} catch (error) {
			console.warn('[auth] revokeRefreshTokens failed during logout', error);
		}
	}

	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
	throw redirect(303, '/');
};
