import { randomBytes } from 'crypto';
import { redirect } from '@sveltejs/kit';
import { handleApiRoute } from '$lib/server/api';
import { requireUser } from '$lib/server/api';
import { getAuthUrl } from '$lib/server/gmail-auth';

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const connectionId = event.url.searchParams.get('connectionId');
	const makePrimary = event.url.searchParams.get('makePrimary') === '1';

	// Generate state parameter for CSRF protection
	const state = randomBytes(32).toString('hex');
	const statePayload = JSON.stringify({ csrf: state, connectionId, makePrimary });

	// Store state in session/cookie for verification in callback
	event.cookies.set('gmail_oauth_state', statePayload, {
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		path: '/',
		sameSite: 'lax',
		maxAge: 600 // 10 minutes
	});
	
	// Generate OAuth URL
	const authUrl = getAuthUrl(state);
	
	// Redirect to Google OAuth consent screen
	throw redirect(302, authUrl);
}, { component: 'gmail_oauth' });
