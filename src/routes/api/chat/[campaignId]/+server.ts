import { getConversation, sendMessage } from '$lib/server/chat/chatbot-client';
import { mapConversationToUi } from '$lib/server/chat/mapper';
import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/core';

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

	// Create abort signal from request or use timeout
	const requestSignal = event.request.signal;
	const timeoutMs = 15000; // 15 seconds

	try {
		const response = await getConversation(campaignId, {
			uid: user.uid,
			logger,
			signal: requestSignal,
			timeout: timeoutMs
		});

		const conversation = response.conversation;

		// Transform to UI-compatible format
		const uiConversation = mapConversationToUi(conversation);

		return apiOk({ conversation: uiConversation });
	} catch (error) {
		logger.error('Failed to get conversation', { error });
		if (error instanceof ApiProblem) {
			if (error.status === 404) {
			throw new ApiProblem({
				status: 404,
				code: 'CONVERSATION_NOT_FOUND',
				message: 'Conversation not found.'
			});
			}
			// Propagate timeout and cancellation errors
			if (error.status === 504 || error.status === 499) {
				throw error;
			}
		}
		throw error;
	}
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

	const logger = event.locals.logger.child({
		campaignId,
		userId: user.uid
	});

	try {
		const response = await sendMessage(campaignId, trimmed, {
			uid: user.uid,
			logger
		});

		logger.info('Assistant turn completed', {
			assistantMessages: response.assistantMessages.length,
			status: response.conversation.status
		});

		const conversation = response.conversation;

		// Transform to UI-compatible format
		const uiConversation = mapConversationToUi(conversation);

		return apiOk({
			campaignId: response.campaignId,
			userMessage: response.userMessage,
			assistantMessages: response.assistantMessages,
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
