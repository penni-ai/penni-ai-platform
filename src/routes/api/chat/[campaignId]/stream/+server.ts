import { randomUUID } from 'crypto';
import { sendMessage } from '$lib/server/chat/chatbot-client';
import { mapConversationToUi } from '$lib/server/chat/mapper';
import { ApiProblem, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/core';

const encoder = new TextEncoder();

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
		turnId,
		mode: 'stream'
	});

	const abortController = new AbortController();
	const stream = new ReadableStream({
		start(controller) {
			const send = (event: string, data: unknown) => {
				controller.enqueue(
					encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
				);
			};

			send('ack', { campaignId, turnId });

			(async () => {
				try {
					// Call the non-streaming chatbot service
					const response = await sendMessage(campaignId, trimmed, {
						uid: user.uid,
						logger,
						signal: abortController.signal
					});

					// Find the primary assistant reply (first non-summary message)
					const primaryReply = response.assistantMessages.find(
						(msg) => msg.role === 'assistant' && msg.type !== 'summary'
					);

					// Simulate streaming by chunking the reply
					if (primaryReply?.content) {
						await replayAssistantReply(primaryReply.content, send);
					}

					// Transform conversation to UI format
					const conversation = response.conversation;
					const uiConversation = mapConversationToUi(conversation);

					send('final', { conversation: uiConversation });
					controller.close();
				} catch (error) {
					logger.error('Streamed assistant turn failed', { error });
					
					// Extract detailed error message
					let errorMessage = 'Assistant stream failed';
					if (error instanceof Error) {
						errorMessage = error.message;
					} else if (typeof error === 'string') {
						errorMessage = error;
					}
					
					// If it's a ChatbotClientError, include more details
					if (error && typeof error === 'object' && 'status' in error && 'code' in error) {
						const chatbotError = error as { status: number; code?: string; message: string };
						errorMessage = chatbotError.message || errorMessage;
					}
					
					send('error', {
						message: errorMessage
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
