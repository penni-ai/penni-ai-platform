import { randomBytes } from 'crypto';
import { serialize } from 'cookie';
import { handleApiRoute, requireUser } from '$lib/server/core';
import { getAuthUrl } from '$lib/server/gmail';

export const GET = handleApiRoute(async (event) => {
	requireUser(event);
	const connectionId = event.url.searchParams.get('connectionId');
	const makePrimary = event.url.searchParams.get('makePrimary') === '1';
	const accountType = (event.url.searchParams.get('accountType') || 'send') as 'draft' | 'send';
	const returnCampaignId = event.url.searchParams.get('returnCampaignId');

	// Generate state parameter for CSRF protection
	const state = randomBytes(32).toString('hex');
	const statePayload = JSON.stringify({ csrf: state, connectionId, makePrimary, accountType, returnCampaignId });

	const stateCookie = serialize('gmail_oauth_state', statePayload, {
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		path: '/',
		sameSite: 'lax',
		maxAge: 600 // 10 minutes
	});
	
	// Generate OAuth URL with account type
	const authUrl = getAuthUrl(state, accountType);
	
	// Redirect to Google OAuth consent screen + set state cookie
	return new Response(null, {
		status: 302,
		headers: {
			location: authUrl,
			'set-cookie': stateCookie
		}
	});
}, { component: 'gmail_oauth' });
