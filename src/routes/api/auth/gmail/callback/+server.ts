import { serialize } from 'cookie';
import { handleApiRoute, requireUser } from '$lib/server/core';
import { exchangeCodeForTokens, storeGmailTokens } from '$lib/server/gmail';

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const url = event.url;

	const clearStateCookie = serialize('gmail_oauth_state', '', {
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		path: '/',
		sameSite: 'lax',
		maxAge: 0
	});

	const redirectWithCookie = (location: string) =>
		new Response(null, {
			status: 302,
			headers: {
				location,
				'set-cookie': clearStateCookie
			}
		});
	
	// Get authorization code and state from query params
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const error = url.searchParams.get('error');
	
	// Check for OAuth errors
	if (error) {
		const errorDescription = url.searchParams.get('error_description') || 'Unknown error';
		return redirectWithCookie(`/my-account/gmail?gmail_error=${encodeURIComponent(error)}&message=${encodeURIComponent(errorDescription)}`);
	}

	if (!code) {
		return redirectWithCookie('/my-account/gmail?gmail_error=missing_code&message=Authorization code not provided');
	}
	
	// Verify state parameter (CSRF protection)
	const storedState = event.cookies.get('gmail_oauth_state');
	let statePayload: { csrf: string; connectionId?: string | null; makePrimary?: boolean; accountType?: 'draft' | 'send'; returnCampaignId?: string | null } | null = null;
	if (storedState) {
		try {
			statePayload = JSON.parse(storedState);
		} catch (error) {
			statePayload = null;
		}
	}
	if (!statePayload || !state || statePayload.csrf !== state) {
		return redirectWithCookie('/my-account/gmail?gmail_error=invalid_state&message=Invalid state parameter');
	}
	
	try {
		// Exchange code for tokens
		const tokens = await exchangeCodeForTokens(code);
		
		// Store tokens in Firestore
		await storeGmailTokens(user.uid, tokens, {
			connectionId: statePayload.connectionId,
			makePrimary: statePayload.makePrimary,
			accountType: statePayload.accountType || 'send'
		});

		// Redirect back to campaign if returnCampaignId was provided, otherwise to settings
		const redirectUrl = statePayload.returnCampaignId
			? `/campaign/${statePayload.returnCampaignId}?gmail_connected=1`
			: '/my-account/gmail?gmail_connected=1';
		return redirectWithCookie(redirectUrl);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Failed to connect Gmail';
		return redirectWithCookie(`/my-account/gmail?gmail_error=token_exchange&message=${encodeURIComponent(errorMessage)}`);
	}
}, { component: 'gmail_oauth' });
