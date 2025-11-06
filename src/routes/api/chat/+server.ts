import { json } from '@sveltejs/kit';
import { createConversation } from '$lib/server/chat-assistant';

export const POST = async ({ locals }) => {
	const uid = locals.user?.uid ?? null;

	if (!uid) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const conversation = await createConversation(uid);
		return json({ conversation });
	} catch (error) {
		console.error('[chat] failed to create conversation', error);
		return json({ error: 'Failed to create conversation' }, { status: 500 });
	}
};
