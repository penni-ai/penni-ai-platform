import { ApiProblem, apiOk, handleApiRoute, requireUser } from '$lib/server/core';
import { userDocRef } from '$lib/server/core/firestore';
import type { UserEmailSettings } from '$lib/server/core/firestore';

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	
	try {
		const userDoc = await userDocRef(user.uid).get();
		const userData = userDoc.data();
		const emailSettings = userData?.emailSettings as UserEmailSettings | undefined;
		
		return apiOk({
			footer: emailSettings?.footer || { enabled: false, html: '' },
			branding: emailSettings?.branding || {},
			directSend: emailSettings?.directSend ?? false
		});
	} catch (error) {
		throw new ApiProblem({
			status: 500,
			code: 'SETTINGS_FETCH_FAILED',
			message: 'Failed to fetch email settings.',
			cause: error
		});
	}
}, { component: 'email-settings' });

export const PUT = handleApiRoute(async (event) => {
	const user = requireUser(event);
	
	let body: { footer?: { enabled: boolean; html?: string; text?: string }; branding?: UserEmailSettings['branding']; directSend?: boolean };
	try {
		body = await event.request.json();
	} catch (error) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_JSON',
			message: 'Request body must be valid JSON.',
			cause: error
		});
	}
	
	try {
		const emailSettings: UserEmailSettings = {
			footer: body.footer,
			branding: body.branding,
			directSend: body.directSend ?? false,
			updatedAt: Date.now()
		};
		
		await userDocRef(user.uid).update({
			emailSettings
		});
		
		return apiOk({ success: true });
	} catch (error) {
		throw new ApiProblem({
			status: 500,
			code: 'SETTINGS_UPDATE_FAILED',
			message: 'Failed to update email settings.',
			cause: error
		});
	}
}, { component: 'email-settings' });

