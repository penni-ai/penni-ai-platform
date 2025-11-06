import { json } from '@sveltejs/kit';
import {
	getConversation,
	registerUserMessage,
	handleAssistantTurn
} from '$lib/server/chat-assistant';

export const GET = async ({ locals, params }) => {
	const uid = locals.user?.uid ?? null;
	if (!uid) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const conversationId = params.conversationId;
	if (!conversationId) {
		return json({ error: 'Conversation ID required' }, { status: 400 });
	}

	const conversation = await getConversation(uid, conversationId);
	if (!conversation) {
		return json({ error: 'Conversation not found' }, { status: 404 });
	}

	return json({ conversation });
};

export const POST = async ({ locals, params, request }) => {
	const uid = locals.user?.uid ?? null;
	if (!uid) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const conversationId = params.conversationId;
	if (!conversationId) {
		return json({ error: 'Conversation ID required' }, { status: 400 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch (error) {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const message = typeof (body as Record<string, unknown>)?.message === 'string'
		? (body as Record<string, unknown>).message
		: null;

	if (!message) {
		return json({ error: 'Message text is required' }, { status: 400 });
	}

	try {
		const userMessage = await registerUserMessage(uid, conversationId, message);
		const assistantTurn = await handleAssistantTurn(uid, conversationId, message);

		return json({
			conversationId,
			userMessage,
			assistantMessages: assistantTurn.assistantMessages,
			conversation: assistantTurn.snapshot
		});
	} catch (error) {
		console.error('[chat] failed to process message', error);
		return json({ error: 'Failed to process message' }, { status: 500 });
	}
};
