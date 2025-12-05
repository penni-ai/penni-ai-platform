import { redirect, isRedirect } from '@sveltejs/kit';
import { handleApiRoute } from '$lib/server/core';
import { requireUser } from '$lib/server/core';
import { ApiProblem } from '$lib/server/core';
import { exchangeCodeForTokens, storeGmailTokens } from '$lib/server/gmail';

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const url = event.url;
	
	// Get authorization code and state from query params
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const error = url.searchParams.get('error');
	
	// Check for OAuth errors
	if (error) {
		const errorDescription = url.searchParams.get('error_description') || 'Unknown error';
		throw redirect(302, `/my-account/gmail?gmail_error=${encodeURIComponent(error)}&message=${encodeURIComponent(errorDescription)}`);
	}

	if (!code) {
		throw redirect(302, '/my-account/gmail?gmail_error=missing_code&message=Authorization code not provided');
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
		throw redirect(302, '/my-account/gmail?gmail_error=invalid_state&message=Invalid state parameter');
	}
	
	// Clear state cookie
	event.cookies.delete('gmail_oauth_state', { path: '/' });
	
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
		throw redirect(302, redirectUrl);
	} catch (error) {
		// Re-throw redirects - they're not actual errors
		if (isRedirect(error)) {
			throw error;
		}
		const errorMessage = error instanceof Error ? error.message : 'Failed to connect Gmail';
		throw redirect(302, `/my-account/gmail?gmail_error=token_exchange&message=${encodeURIComponent(errorMessage)}`);
	}
}, { component: 'gmail_oauth' });
