import { ApiProblem, apiOk, handleApiRoute, requireUser } from '$lib/server/api';
import { getOutreachUsage, incrementOutreachUsage } from '$lib/server/outreach-usage';
import { sendEmailsViaGmail } from '$lib/server/gmail-sender';
import { getGmailConnection } from '$lib/server/gmail-auth';

export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	
	let body: { influencerIds: string[]; emailContent: string; platform?: string; senderConnectionId?: string | null };
	try {
		body = await event.request.json();
	} catch (error) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_JSON',
			message: 'Request body must be valid JSON.',
			hint: 'Send a JSON payload with influencerIds, emailContent, and optional platform.',
			cause: error
		});
	}

	if (!Array.isArray(body.influencerIds) || body.influencerIds.length === 0) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_INFLUENCER_IDS',
			message: 'influencerIds must be a non-empty array.'
		});
	}

	if (!body.emailContent || typeof body.emailContent !== 'string') {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_EMAIL_CONTENT',
			message: 'emailContent is required and must be a string.'
		});
	}

	const platform = body.platform || 'gmail';
	
	const senderConnectionId = body.senderConnectionId ?? null;
	if (platform === 'gmail') {
		try {
			await getGmailConnection(user.uid, senderConnectionId ?? null);
		} catch (error) {
			throw new ApiProblem({
				status: 403,
				code: 'GMAIL_NOT_CONNECTED',
				message: 'Gmail is not connected. Please connect your Gmail account first.',
				hint: 'Visit the outreach panel and click "Connect Gmail".'
			});
		}
	}

	// Check current usage
	const usage = await getOutreachUsage(user.uid);
	const requestedCount = body.influencerIds.length;
	
	if (usage.remaining < requestedCount) {
		throw new ApiProblem({
			status: 403,
			code: 'OUTREACH_LIMIT_EXCEEDED',
			message: `You have ${usage.remaining} outreach emails remaining, but requested ${requestedCount}.`,
			hint: 'Upgrade your plan or wait for the monthly reset.'
		});
	}

	// TODO: Fetch influencer profiles to get email addresses
	// For now, we'll need the frontend to pass email addresses
	// This is a placeholder - you'll need to fetch from your database
	
	let sent = 0;
	let failed = 0;
	const errors: string[] = [];
	
	if (platform === 'gmail') {
		// TODO: Replace with actual influencer email fetching
		// For now, this is a placeholder structure
		const emails = body.influencerIds.map((id, index) => ({
			to: `influencer${index}@example.com`, // TODO: Fetch actual email from influencer profile
			subject: 'Partnership Opportunity', // TODO: Extract from emailContent or make configurable
			htmlBody: body.emailContent
		}));
		
		const result = await sendEmailsViaGmail(user.uid, emails, senderConnectionId ?? null);
		sent = result.sent;
		failed = result.failed;
		errors.push(...result.errors);
	} else {
		// Instagram/TikTok - not implemented yet
		throw new ApiProblem({
			status: 501,
			code: 'PLATFORM_NOT_IMPLEMENTED',
			message: `${platform} outreach is not yet implemented.`,
			hint: 'Currently only Gmail is supported.'
		});
	}

	// Increment usage only for successfully sent emails
	if (sent > 0) {
		await incrementOutreachUsage(user.uid, sent);
	}

	return apiOk({
		success: true,
		sent,
		failed,
		errors: errors.length > 0 ? errors : undefined,
		remaining: usage.remaining - sent
	});
}, { component: 'outreach-send' });
