import { google } from 'googleapis';
import { getValidGmailTokens, createOAuth2Client } from './gmail-auth';
import { createLogger } from '$lib/server/core';

const gmailSenderLogger = createLogger({ component: 'gmail_sender' });

export interface SendEmailOptions {
	to: string;
	subject: string;
	htmlBody: string;
	from?: string; // Optional: will use authenticated user's email if not provided
}

function stripCrlf(value: string): string {
	return value.replace(/[\r\n]+/g, ' ').trim();
}

function requireSingleEmailAddress(value: string, field: string): string {
	const normalized = stripCrlf(value);
	if (!normalized) {
		throw new Error(`${field} is required.`);
	}

	// Disallow common header/address separators and unsafe characters to avoid multi-recipient injection.
	if (/[<>,;]/.test(normalized)) {
		throw new Error(`${field} must be a single email address.`);
	}

	// Very conservative check: single token containing "@", no whitespace.
	if (/\s/.test(normalized) || !normalized.includes('@')) {
		throw new Error(`${field} must be a valid email address.`);
	}

	return normalized;
}

function sanitizeSubject(value: string): string {
	const normalized = stripCrlf(value);
	if (!normalized) {
		throw new Error('Subject is required.');
	}
	return normalized.slice(0, 255);
}

function getEmailDomain(email: string): string | null {
	const at = email.lastIndexOf('@');
	if (at <= 0 || at >= email.length - 1) return null;
	return email.slice(at + 1).toLowerCase();
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

	const toEmail = requireSingleEmailAddress(to, 'To');
	const safeFrom = requireSingleEmailAddress(fromEmail, 'From');
	const safeSubject = sanitizeSubject(subject);
	
	// Create MIME message
	const message = [
		`To: ${toEmail}`,
		`From: ${safeFrom}`,
		`Subject: ${safeSubject}`,
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
 * Create a draft email via Gmail API
 */
export async function createDraftViaGmail(
	uid: string,
	options: SendEmailOptions,
	connectionId?: string | null
): Promise<string> {
	const { to, subject, htmlBody, from } = options;
	const logger = gmailSenderLogger.child({ uid, connectionId: connectionId ?? null });
	
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

	const toEmail = requireSingleEmailAddress(to, 'To');
	const safeFrom = requireSingleEmailAddress(fromEmail, 'From');
	const safeSubject = sanitizeSubject(subject);
	const toDomain = getEmailDomain(toEmail);
	const fromDomain = getEmailDomain(safeFrom);
	
	// Create MIME message
	const message = [
		`To: ${toEmail}`,
		`From: ${safeFrom}`,
		`Subject: ${safeSubject}`,
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
	
	// Create draft
	try {
		const draft = await gmail.users.drafts.create({
			userId: 'me',
			requestBody: {
				message: {
					raw: encodedMessage
				}
			}
			});
			
			const draftId = draft.data.id;
			if (!draftId) {
				logger.warn('gmail_draft_missing_id', {
					to_domain: toDomain,
					from_domain: fromDomain
				});
				throw new Error('Gmail API returned draft without ID');
			}
			
			return draftId;
		} catch (error: any) {
			// Handle specific Gmail API errors
			const status = typeof error?.response?.status === 'number' ? error.response.status : null;
			const googleStatus = error?.response?.data?.error?.status ?? null;

			if (error.response?.status === 429) {
				throw new Error('Gmail rate limit exceeded. Please try again later.');
			}
			if (error.response?.status === 403) {
				throw new Error('Gmail API access denied. Please reconnect your Gmail account.');
			}
			if (error.response?.status === 400) {
				logger.warn('gmail_draft_bad_request', {
					status,
					google_status: googleStatus,
					to_domain: toDomain,
					from_domain: fromDomain
				});
				throw new Error('Invalid email format or parameters.');
			}
			logger.error('gmail_draft_create_failed', {
				status,
				google_status: googleStatus,
				to_domain: toDomain,
				from_domain: fromDomain,
				error_message: typeof error?.message === 'string' ? error.message : null
			});
			throw new Error(`Failed to create draft via Gmail: ${error.message}`);
		}
	}

/**
 * Create multiple draft emails via Gmail API (with rate limiting)
 */
export async function createDraftsViaGmail(
	uid: string,
	emails: SendEmailOptions[],
	connectionId?: string | null
): Promise<{ created: number; failed: number; errors: string[]; draftIds: string[] }> {
	let created = 0;
	let failed = 0;
	const errors: string[] = [];
	const draftIds: string[] = [];
	
	// Create drafts sequentially to avoid rate limits
	for (const email of emails) {
		try {
			const draftId = await createDraftViaGmail(uid, email, connectionId ?? null);
			// Only count as created if we got a valid draft ID
			if (draftId && draftId.trim() !== '') {
			created++;
			draftIds.push(draftId);
			} else {
				failed++;
				errors.push(`${email.to}: Draft created but no draft ID returned`);
			}
			
			// Small delay between drafts to avoid rate limits
			if (emails.length > 1) {
				await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
			}
		} catch (error) {
			failed++;
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			errors.push(`${email.to}: ${errorMessage}`);
		}
	}
	
	return { created, failed, errors, draftIds };
}

/**
 * Send multiple emails via Gmail API (with rate limiting)
 * @deprecated Use createDraftsViaGmail instead
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
