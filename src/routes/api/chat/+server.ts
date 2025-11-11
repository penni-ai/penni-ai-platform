import { createConversation } from '$lib/server/chat-assistant';
import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/api';

export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	assertSameOrigin(event);

	const logger = event.locals.logger.child({ component: 'chat', action: 'create_conversation' });

	try {
		const conversation = await createConversation(user.uid);
		logger.info('Conversation created', { conversationId: conversation.id });
		return apiOk({ conversation });
	} catch (error) {
		logger.error('Failed to create conversation', { error });
		throw new ApiProblem({
			status: 500,
			code: 'CONVERSATION_CREATE_FAILED',
			message: 'Failed to create a new conversation.',
			hint: 'Please retry in a moment.',
			cause: error
		});
	}
}, { component: 'chat' });
