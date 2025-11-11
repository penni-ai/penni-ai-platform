import { randomUUID } from 'crypto';
import {
	getConversation,
	registerUserMessage,
	handleAssistantTurn
} from '$lib/server/chat-assistant';
import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/api';

export const GET = handleApiRoute(async (event) => {
	const user = requireUser(event);
	const conversationId = event.params.conversationId;
	if (!conversationId) {
		throw new ApiProblem({
			status: 400,
			code: 'CONVERSATION_ID_REQUIRED',
			message: 'Conversation ID is required.'
		});
	}

	const conversation = await getConversation(user.uid, conversationId);
	if (!conversation) {
		throw new ApiProblem({
			status: 404,
			code: 'CONVERSATION_NOT_FOUND',
			message: 'Conversation not found.'
		});
	}

	return apiOk({ conversation });
}, { component: 'chat' });

export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	assertSameOrigin(event);

	const conversationId = event.params.conversationId;
	if (!conversationId) {
		throw new ApiProblem({
			status: 400,
			code: 'CONVERSATION_ID_REQUIRED',
			message: 'Conversation ID is required.'
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
		conversationId,
		turnId
	});

	try {
		const userMessage = await registerUserMessage(user.uid, conversationId, trimmed, {
			logger,
			turnId
		});
		const assistantTurn = await handleAssistantTurn(user.uid, conversationId, trimmed, {
			logger,
			turnId
		});

		logger.info('Assistant turn completed', {
			assistantMessages: assistantTurn.assistantMessages.length,
			status: assistantTurn.snapshot.status
		});

		return apiOk({
			conversationId,
			userMessage,
			assistantMessages: assistantTurn.assistantMessages,
			conversation: assistantTurn.snapshot
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
