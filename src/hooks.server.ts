import type { Handle } from '@sveltejs/kit';
import { adminAuth } from '$lib/firebase/admin';

const SESSION_COOKIE_NAME = '__session';

export const handle: Handle = async ({ event, resolve }) => {
	const sessionCookie = event.cookies.get(SESSION_COOKIE_NAME);
	let user = null;

	if (sessionCookie) {
		try {
			user = await adminAuth.verifySessionCookie(sessionCookie, true);
		} catch (error) {
			console.warn('[auth] session verification failed', error);
			event.cookies.delete(SESSION_COOKIE_NAME, {
				path: '/'
			});
		}
	}

	event.locals.user = user;

	return resolve(event);
};
