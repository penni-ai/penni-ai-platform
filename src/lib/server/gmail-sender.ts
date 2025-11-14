import { google } from 'googleapis';
import { getValidGmailTokens, createOAuth2Client } from './gmail-auth';

export interface SendEmailOptions {
	to: string;
	subject: string;
	htmlBody: string;
	from?: string; // Optional: will use authenticated user's email if not provided
}

/**
 * Send email via Gmail API
 */
export async function sendEmailViaGmail(
	uid: string,
	options: SendEmailOptions,
	connectionId?: string | null
): Promise<void> {
	const { to, subject, htmlBody, from } = options;
	
	// Get valid tokens (refresh if needed)
	const connection = await getValidGmailTokens(uid, connectionId ?? null);
	
	// Create OAuth2 client and set credentials
	const oauth2Client = createOAuth2Client();
	oauth2Client.setCredentials({
		access_token: connection.access_token,
		refresh_token: connection.refresh_token
	});
	
	// Create Gmail API client
	const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
	
	// Get user's email if not provided
	let fromEmail = from;
	if (!fromEmail) {
		fromEmail = connection.email;
	}
	
	// Create MIME message
	const message = [
		`To: ${to}`,
		`From: ${fromEmail}`,
		`Subject: ${subject}`,
		'Content-Type: text/html; charset=utf-8',
		'',
		htmlBody
	].join('\n');
	
	// Encode message in base64url format
	const encodedMessage = Buffer.from(message)
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
	
	// Send email
	try {
		await gmail.users.messages.send({
			userId: 'me',
			requestBody: {
				raw: encodedMessage
			}
		});
	} catch (error: any) {
		// Handle specific Gmail API errors
		if (error.response?.status === 429) {
			throw new Error('Gmail rate limit exceeded. Please try again later.');
		}
		if (error.response?.status === 403) {
			throw new Error('Gmail API access denied. Please reconnect your Gmail account.');
		}
		if (error.response?.status === 400) {
			throw new Error('Invalid email format or parameters.');
		}
		throw new Error(`Failed to send email via Gmail: ${error.message}`);
	}
}

/**
 * Send multiple emails via Gmail API (with rate limiting)
 */
export async function sendEmailsViaGmail(
	uid: string,
	emails: SendEmailOptions[],
	connectionId?: string | null
): Promise<{ sent: number; failed: number; errors: string[] }> {
	let sent = 0;
	let failed = 0;
	const errors: string[] = [];
	
	// Gmail free accounts have a limit of 500 emails per day
	// We'll send sequentially to avoid rate limits
	for (const email of emails) {
		try {
			await sendEmailViaGmail(uid, email, connectionId ?? null);
			sent++;
			
			// Small delay between emails to avoid rate limits
			if (emails.length > 1) {
				await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
			}
		} catch (error) {
			failed++;
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			errors.push(`${email.to}: ${errorMessage}`);
		}
	}
	
	return { sent, failed, errors };
}
