import { adminAuth } from '$lib/firebase/admin';
import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/core';

export const GET = handleApiRoute(async (event) => {
	assertSameOrigin(event);
	const user = requireUser(event);
	const logger = event.locals.logger.child({ component: 'session', action: 'issue_custom_token' });

	try {
		const token = await adminAuth.createCustomToken(user.uid, { session: 'app_hosting' });
		logger.info('Issued custom token for Firebase client auth', { uid: user.uid });
		return apiOk({ token, uid: user.uid });
	} catch (error) {
		logger.error('Failed to mint Firebase custom token', { error, uid: user.uid });
		throw new ApiProblem({
			status: 500,
			code: 'CUSTOM_TOKEN_FAILED',
			message: 'Unable to mint Firebase credential for this session.',
			hint: 'Refresh the page and try again.',
			cause: error
		});
	}
}, { component: 'session' });
