import { adminAuth } from '$lib/firebase/admin';
import { apiOk, assertSameOrigin, handleApiRoute } from '$lib/server/api';

const SESSION_COOKIE_NAME = '__session';

export const DELETE = handleApiRoute(async (event) => {
	assertSameOrigin(event);
	const logger = event.locals.logger.child({ component: 'auth', action: 'clear_session' });

	const userId = event.locals.user?.uid ?? null;
	if (userId) {
		try {
			await adminAuth.revokeRefreshTokens(userId);
			logger.info('Revoked refresh tokens for user');
		} catch (error) {
			logger.warn('Failed to revoke refresh tokens', { error });
		}
	}

	event.cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
	return apiOk({ status: 'cleared' });
}, { component: 'auth' });
