import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/core';
import { campaignDocRef, chatCollectedDocRef } from '$lib/server/core';
import { serializeCampaignRecord } from '$lib/server/campaigns';
import { openaiClient, DEFAULT_MODEL } from '$lib/server/openai';
import { env } from '$env/dynamic/private';

export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	assertSameOrigin(event);

	let body: unknown;
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

	if (!body || typeof body !== 'object') {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_PAYLOAD',
			message: 'Request body must be an object.',
			hint: 'Send a JSON payload with "campaignId", "tone", and optionally "platform" (email, instagram, tiktok) fields.'
		});
	}

	const payload = body as Record<string, unknown>;
	const campaignId = typeof payload.campaignId === 'string' ? payload.campaignId : '';
	const tone = typeof payload.tone === 'string' && (payload.tone === 'friendly' || payload.tone === 'business')
		? payload.tone
		: 'business';
	const platform = typeof payload.platform === 'string' && ['email', 'instagram', 'tiktok'].includes(payload.platform)
		? payload.platform
		: 'email';

	if (!campaignId) {
		throw new ApiProblem({
			status: 400,
			code: 'CAMPAIGN_ID_REQUIRED',
			message: 'campaignId is required.'
		});
	}

	const logger = event.locals.logger.child({
		campaignId,
		userId: user.uid,
		action: 'draft_outreach_message',
		platform
	});

	try {
		// Fetch campaign data
		const campaignDoc = await campaignDocRef(user.uid, campaignId).get();
		if (!campaignDoc.exists) {
			throw new ApiProblem({
				status: 404,
				code: 'CAMPAIGN_NOT_FOUND',
				message: 'Campaign not found.'
			});
		}

		const campaignData = campaignDoc.data() ?? {};
		const campaign = await serializeCampaignRecord(campaignData, campaignDoc.id, user.uid);

		// Build campaign context for the prompt
		const campaignContext: string[] = [];
		
		if (campaign.title) {
			campaignContext.push(`Campaign Title: ${campaign.title}`);
		}
		if (campaign.website) {
			campaignContext.push(`Website: ${campaign.website}`);
		}
		if (campaign.businessSummary) {
			campaignContext.push(`Business Description: ${campaign.businessSummary}`);
		}
		if (campaign.business_location) {
			campaignContext.push(`Business Location: ${campaign.business_location}`);
		}
		if (campaign.type_of_influencer) {
			campaignContext.push(`Type of Influencer: ${campaign.type_of_influencer}`);
		}
		if (campaign.locations) {
			campaignContext.push(`Target Locations: ${campaign.locations}`);
		}

		const contextText = campaignContext.length > 0
			? campaignContext.join('\n')
			: 'No campaign details available.';

		// Create prompt based on platform
		const toneInstruction = tone === 'friendly'
			? 'Write in a warm, friendly, and approachable tone. Use casual language and be personable.'
			: 'Write in a professional, business-like tone. Use formal language and be concise and direct.';

		let prompt = '';
		let platformName = '';
		let lengthGuidance = '';
		let formatGuidance = '';

		if (platform === 'email') {
			platformName = 'outreach email';
			lengthGuidance = 'Keep the email concise (3-4 paragraphs maximum)';
			formatGuidance = 'Draft the complete email body (no subject line needed)';
		} else if (platform === 'instagram') {
			platformName = 'Instagram direct message';
			lengthGuidance = 'Keep the message concise (2-3 short paragraphs, suitable for Instagram DMs)';
			formatGuidance = 'Draft the complete Instagram DM message';
		} else if (platform === 'tiktok') {
			platformName = 'TikTok direct message';
			lengthGuidance = 'Keep the message concise and engaging (2-3 short paragraphs, suitable for TikTok DMs)';
			formatGuidance = 'Draft the complete TikTok DM message';
		}

		prompt = `You are an expert at drafting ${platformName}s for influencer partnerships. Based on the following campaign details, draft a compelling ${platformName}.

Campaign Details:
${contextText}

Template Variables (use where appropriate):
- {{influencer_name}} - The influencer's name

Requirements:
- ${toneInstruction}
- ${lengthGuidance}
- Start with a friendly greeting that includes the {{influencer_name}} variable in the first sentence
- Include a clear call-to-action
- Make it personalized and relevant
- Focus on mutual value and partnership opportunities
${platform === 'instagram' || platform === 'tiktok' ? '- Use emojis sparingly and appropriately' : ''}
- Write naturally as a normal message - do not use formal email formatting

${formatGuidance}:`;

		if (!env.OPENAI_API_KEY) {
			throw new ApiProblem({
				status: 500,
				code: 'OPENAI_API_KEY_MISSING',
				message: 'OpenAI API key is not configured.'
			});
		}

		const model = env.OPENAI_MODEL ?? DEFAULT_MODEL;

		logger.info('Drafting outreach message', {
			campaignId,
			tone,
			platform,
			model
		});

		const response = await openaiClient.responses.create({
			model,
			input: [
				{
					type: 'message',
					role: 'user',
					content: prompt
				}
			],
			text: {
				format: {
					type: 'text'
				},
				verbosity: 'medium'
			},
			store: false
		});

		// Extract text content from response
		let messageContent = '';
		
		if ((response as any).output_text) {
			messageContent = (response as any).output_text;
		} else if (response.output && Array.isArray(response.output)) {
			for (const outputItem of response.output) {
				if (outputItem.type === 'message' && outputItem.content) {
					if (Array.isArray(outputItem.content)) {
						for (const contentItem of outputItem.content) {
							if (contentItem.type === 'output_text' && 'text' in contentItem) {
								messageContent = (contentItem as any).text;
								break;
							}
						}
					} else if (typeof outputItem.content === 'string') {
						messageContent = outputItem.content;
					}
				}
				if (messageContent) break;
			}
		}

		if (!messageContent || messageContent.trim().length === 0) {
			logger.error('No message content generated', { response });
			throw new ApiProblem({
				status: 500,
				code: 'MESSAGE_GENERATION_FAILED',
				message: `Failed to generate ${platform} message content.`
			});
		}

		logger.info('Message drafted successfully', {
			campaignId,
			tone,
			platform,
			contentLength: messageContent.length
		});

		return apiOk({
			message: messageContent.trim(),
			platform,
			tone
		});
	} catch (error) {
		if (error instanceof ApiProblem) {
			throw error;
		}
		logger.error('Failed to draft outreach message', { error, platform });
		throw new ApiProblem({
			status: 500,
			code: 'DRAFT_FAILED',
			message: `Failed to draft ${platform} outreach message.`,
			hint: 'Retry in a few moments. If the issue continues, contact support.',
			cause: error
		});
	}
}, { component: 'outreach' });

