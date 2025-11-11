import { randomUUID } from 'crypto';
import { streamAssistantTurn, registerUserMessage } from '$lib/server/chat-assistant';
import { ApiProblem, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/api';

const encoder = new TextEncoder();

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
		turnId,
		mode: 'stream'
	});

	await registerUserMessage(user.uid, conversationId, trimmed, {
		logger,
		turnId
	});

	const abortController = new AbortController();
	const stream = new ReadableStream({
		start(controller) {
			const send = (event: string, data: unknown) => {
				controller.enqueue(
					encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
				);
			};

			send('ack', { conversationId, turnId });

			(async () => {
				try {
					const assistantTurn = await streamAssistantTurn(user.uid, conversationId, trimmed, {
						logger,
						turnId,
						signal: abortController.signal
					});

					const primaryReply = assistantTurn.assistantMessages.find((msg) => msg.role === 'assistant' && msg.type !== 'summary');
					if (primaryReply?.content) {
						await replayAssistantReply(primaryReply.content, send);
					}

					send('final', { conversation: assistantTurn.snapshot });
					controller.close();
				} catch (error) {
					logger.error('Streamed assistant turn failed', { error });
					send('error', {
						message: error instanceof Error ? error.message : 'ASSISTANT_STREAM_FAILED'
					});
					controller.close();
				}
			})();
		},
		cancel() {
			abortController.abort();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
}, { component: 'chat/stream' });

async function replayAssistantReply(text: string, send: (event: string, data: unknown) => void) {
	const chunks = chunkReply(text);
	for (const chunk of chunks) {
		send('delta', { delta: chunk });
		await wait(35);
	}
}

function chunkReply(text: string): string[] {
	const parts: string[] = [];
	let buffer = '';
	for (const token of text.split(/(\s+)/)) {
		buffer += token;
		if (buffer.length >= 24) {
			parts.push(buffer);
			buffer = '';
		}
	}
	if (buffer.trim()) {
		parts.push(buffer);
	}
	return parts.length ? parts : [text];
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
