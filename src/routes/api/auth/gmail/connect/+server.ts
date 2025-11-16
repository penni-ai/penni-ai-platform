import { randomBytes } from 'crypto';
import { redirect } from '@sveltejs/kit';
import { handleApiRoute } from '$lib/server/core';
import { requireUser } from '$lib/server/core';
import { getAuthUrl } from '$lib/server/gmail';

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const connectionId = event.url.searchParams.get('connectionId');
	const makePrimary = event.url.searchParams.get('makePrimary') === '1';
	const accountType = (event.url.searchParams.get('accountType') || 'send') as 'draft' | 'send';

	// Generate state parameter for CSRF protection
	const state = randomBytes(32).toString('hex');
	const statePayload = JSON.stringify({ csrf: state, connectionId, makePrimary, accountType });

	// Store state in session/cookie for verification in callback
	event.cookies.set('gmail_oauth_state', statePayload, {
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		path: '/',
		sameSite: 'lax',
		maxAge: 600 // 10 minutes
	});
	
	// Generate OAuth URL with account type
	const authUrl = getAuthUrl(state, accountType);
	
	// Redirect to Google OAuth consent screen
	throw redirect(302, authUrl);
}, { component: 'gmail_oauth' });
