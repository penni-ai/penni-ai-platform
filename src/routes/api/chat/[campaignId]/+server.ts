import { randomUUID } from 'crypto';
import {
	getConversation,
	registerUserMessage,
	handleAssistantTurn
} from '$lib/server/chat-assistant';
import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/api';

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const campaignId = event.params.campaignId;
	if (!campaignId) {
		throw new ApiProblem({
			status: 400,
			code: 'CAMPAIGN_ID_REQUIRED',
			message: 'Campaign ID is required.'
		});
	}

	const logger = event.locals.logger.child({
		campaignId,
		userId: user.uid
	});

	const conversation = await getConversation(user.uid, campaignId, logger);
	if (!conversation) {
		logger.warn('Conversation not found for campaign', {
			campaignId,
			userId: user.uid
		});
		throw new ApiProblem({
			status: 404,
			code: 'CONVERSATION_NOT_FOUND',
			message: 'Conversation not found.'
		});
	}

	// Transform to UI-compatible format
	const uiConversation = {
		id: conversation.id,
		status: conversation.status,
		collected: {
			website: conversation.collected.website ?? undefined,
			business_location: conversation.collected.business_location ?? undefined,
			business_about: conversation.collected.business_about ?? undefined,
			locations: conversation.collected.influencer_location ?? undefined,
			influencerTypes: conversation.collected.influencerTypes ?? undefined,
			followers: conversation.collected.min_followers !== null || conversation.collected.max_followers !== null
				? `${conversation.collected.min_followers ?? ''}-${conversation.collected.max_followers ?? ''}`
				: undefined
		},
		missing: conversation.missing,
		messages: conversation.messages,
		keywords: conversation.collected.keywords,
		followerRange: {
			min: conversation.collected.min_followers,
			max: conversation.collected.max_followers
		}
	};

	return apiOk({ conversation: uiConversation });
}, { component: 'chat' });

export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	assertSameOrigin(event);

	const campaignId = event.params.campaignId;
	if (!campaignId) {
		throw new ApiProblem({
			status: 400,
			code: 'CAMPAIGN_ID_REQUIRED',
			message: 'Campaign ID is required.'
		});
	}

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
			hint: 'Send a JSON payload with a "message" field.'
		});
	}

	const payload = body as Record<string, unknown>;
	const messageRaw = typeof payload.message === 'string' ? payload.message : '';

	const trimmed = messageRaw.trim();

	if (!trimmed) {
		throw new ApiProblem({
			status: 400,
			code: 'MESSAGE_REQUIRED',
			message: 'A message is required to continue the conversation.',
			hint: 'Provide the message content as a string in the "message" field.'
		});
	}

	const turnId = randomUUID();
	const logger = event.locals.logger.child({
		campaignId,
		turnId
	});

	try {
		const userMessage = await registerUserMessage(user.uid, campaignId, trimmed, {
			logger,
			turnId
		});
		const assistantTurn = await handleAssistantTurn(user.uid, campaignId, trimmed, {
			logger,
			turnId
		});

		logger.info('Assistant turn completed', {
			assistantMessages: assistantTurn.assistantMessages.length,
			status: assistantTurn.snapshot.status
		});

		// Transform to UI-compatible format
		const uiConversation = {
			id: assistantTurn.snapshot.id,
			status: assistantTurn.snapshot.status,
			collected: {
				website: assistantTurn.snapshot.collected.website ?? undefined,
				business_location: assistantTurn.snapshot.collected.business_location ?? undefined,
				business_about: assistantTurn.snapshot.collected.business_about ?? undefined,
				locations: assistantTurn.snapshot.collected.influencer_location ?? undefined,
				influencerTypes: assistantTurn.snapshot.collected.influencerTypes ?? undefined,
				followers: assistantTurn.snapshot.collected.min_followers !== null || assistantTurn.snapshot.collected.max_followers !== null
					? `${assistantTurn.snapshot.collected.min_followers ?? ''}-${assistantTurn.snapshot.collected.max_followers ?? ''}`
					: undefined
			},
			missing: assistantTurn.snapshot.missing,
			messages: assistantTurn.snapshot.messages,
			keywords: assistantTurn.snapshot.collected.keywords,
			followerRange: {
				min: assistantTurn.snapshot.collected.min_followers,
				max: assistantTurn.snapshot.collected.max_followers
			}
		};

		return apiOk({
			campaignId,
			userMessage,
			assistantMessages: assistantTurn.assistantMessages,
			conversation: uiConversation
		});
	} catch (error) {
		logger.error('Failed to process assistant turn', { error });
		throw new ApiProblem({
			status: 500,
			code: 'ASSISTANT_TURN_FAILED',
			message: 'Failed to process the assistant turn.',
			hint: 'Retry in a few moments. If the issue continues, contact support.',
			cause: error
		});
	}
}, { component: 'chat' });
