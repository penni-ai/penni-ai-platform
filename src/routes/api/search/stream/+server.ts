import { randomUUID } from 'crypto';
import { normalizePayload } from '../+server';
import { ApiProblem, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/api';
import { invokeSearchPipeline, SEARCH_PIPELINE_URL } from '$lib/server/functions-client';
import { readPipelineStageResults, watchPipelineStatus } from '$lib/server/firestore';
import { STAGE_NAMES } from '$lib/types/search';
import { decodeCallableResponse } from '$lib/server/firebase-callable';
import type { PipelineStageDocument, PipelineStatus, StageName } from '$lib/types/search';

const encoder = new TextEncoder();
const PING_INTERVAL_MS = 12_000;
const STATUS_WATCHDOG_MS = 180_000; // 3 minutes to accommodate long-running stages

export const POST = handleApiRoute(async (event) => {
	assertSameOrigin(event);
	const user = requireUser(event);

	let raw: unknown;
	try {
		raw = await event.request.json();
	} catch (error) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_JSON',
			message: 'Request body must be valid JSON.',
			cause: error
		});
	}

	const payload = normalizePayload(raw);
	const pipelineId = randomUUID().replace(/-/g, '');
	const baseLogger = event.locals.logger;
	const logger = baseLogger?.child?.({ pipelineId, component: 'search/stream' }) ?? baseLogger;
	logger?.info?.('Starting streamed search pipeline', { pipelineId });

	const watchAbort = new AbortController();
	const invocationAbort = new AbortController();
	let streamClosed = false;
	let heartbeat: ReturnType<typeof setInterval> | null = null;
	let statusWatchdog: ReturnType<typeof setTimeout> | null = null;

	const stopActiveTimers = () => {
		if (heartbeat) {
			clearInterval(heartbeat);
			heartbeat = null;
		}
		if (statusWatchdog) {
			clearTimeout(statusWatchdog);
			statusWatchdog = null;
		}
	};

	const stream = new ReadableStream({
		start(controller) {
			const seenStages = new Set<StageName>();
			let completionEmitted = false;
			let errorEmitted = false;

			const send = (eventName: string, data: unknown) => {
				if (streamClosed) return;
				controller.enqueue(
					encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`)
				);
			};

			const finalize = () => {
				if (streamClosed) return;
				streamClosed = true;
				stopActiveTimers();
				watchAbort.abort();
				invocationAbort.abort();
				controller.close();
			};

			const resetWatchdog = () => {
				if (streamClosed) return;
				if (statusWatchdog) {
					clearTimeout(statusWatchdog);
				}
				statusWatchdog = setTimeout(() => {
					if (streamClosed) return;
					logger?.warn?.('Pipeline status watchdog expired', { pipelineId });
					send('error', {
						pipeline_id: pipelineId,
						message: 'PIPELINE_STATUS_WATCHDOG_EXPIRED',
						status: 504
					});
					finalize();
				}, STATUS_WATCHDOG_MS);
			};

			if (!heartbeat) {
				heartbeat = setInterval(() => {
					send('ping', { pipeline_id: pipelineId, ts: Date.now() });
				}, PING_INTERVAL_MS);
			}

			send('ack', { pipeline_id: pipelineId });
			resetWatchdog();

			logger?.debug?.('Invoking search pipeline callable', {
				pipelineId,
				functionsUrl: SEARCH_PIPELINE_URL
			});

			const pipelineInvocation = invokeSearchPipeline(payload, {
				uid: user.uid,
				pipelineId,
				signal: invocationAbort.signal
			});

			pipelineInvocation
				.then(async (response) => {
					if (streamClosed) {
						return;
					}

					const { error, parseError } = await decodeCallableResponse(response);
					if (parseError && !error && !response.ok) {
						logger?.warn?.('Callable response parse failed', {
							pipelineId,
							error: parseError
						});
					}
					if (error) {
						logger?.warn?.('Pipeline invocation returned an error response', {
							pipelineId,
							status: error.httpStatus,
							code: error.code
						});
						send('error', {
							pipeline_id: pipelineId,
							message: error.message,
							status: error.status,
							code: error.code
						});
						finalize();
					}
				})
				.catch((error) => {
				if ((error as Error)?.name === 'AbortError' || streamClosed) {
					return;
				}
				logger?.error?.('Pipeline invocation failed', {
					pipelineId,
					error
				});
				send('error', {
					pipeline_id: pipelineId,
					message: error instanceof Error ? error.message : 'PIPELINE_INVOCATION_FAILED',
					status: 502
				});
				finalize();
			});

			(async () => {
				try {
					for await (const status of watchPipelineStatus(pipelineId, watchAbort.signal)) {
						const shouldClose = await handleStatusUpdate(status);
						if (shouldClose) {
							finalize();
							break;
						}
					}
					if (!streamClosed) {
						logger?.warn?.('Pipeline status stream ended without terminal state', { pipelineId });
						send('error', {
							pipeline_id: pipelineId,
							message: 'PIPELINE_STATUS_STREAM_ENDED',
							status: 504
						});
						finalize();
					}
				} catch (error) {
					if (!streamClosed) {
						logger?.error?.('Pipeline status stream failed', {
							pipelineId,
							error
						});
						send('error', {
							pipeline_id: pipelineId,
							message: 'PIPELINE_STATUS_STREAM_FAILED',
							status: 500
						});
						finalize();
					}
				}
			})();

			async function handleStatusUpdate(status: PipelineStatus): Promise<boolean> {
				resetWatchdog();
				send('progress', {
					pipeline_id: pipelineId,
					stage: status.current_stage,
					status: status.status,
					progress: status.overall_progress,
					completed_stages: status.completed_stages
				});

				for (const stage of status.completed_stages) {
					if (!seenStages.has(stage)) {
						seenStages.add(stage);
						await emitStageComplete(stage);
					}
				}

				if (status.status === 'completed') {
					if (!completionEmitted) {
						completionEmitted = true;
						await emitCompletion();
					}
					return true;
				}

				if (status.status === 'error') {
					if (!errorEmitted) {
						errorEmitted = true;
						send('error', {
							pipeline_id: pipelineId,
							message: status.error_message ?? 'PIPELINE_FAILED',
							stage: status.current_stage,
							status: 500
						});
					}
					return true;
				}

				return false;
			}

			async function emitStageComplete(stage: StageName) {
				try {
					const doc = await readPipelineStageResults(pipelineId, stage);
					send('stage_complete', {
						pipeline_id: pipelineId,
						stage,
						count: doc?.profiles?.length
					});
				} catch (error) {
					logger?.warn?.('Failed to read stage document', {
						pipelineId,
						stage,
						error
					});
					send('stage_complete', { pipeline_id: pipelineId, stage });
				}
			}

			async function emitCompletion() {
				const results: PipelineStageDocument[] = [];
				for (const stage of STAGE_NAMES) {
					try {
						const doc = await readPipelineStageResults(pipelineId, stage);
						if (doc) {
							results.push(doc);
						}
					} catch (error) {
						logger?.warn?.('Failed to load stage results', {
							pipelineId,
							stage,
							error
						});
					}
				}
				// Stream the full stage documents so consumers can inspect each pipeline phase without
				// issuing additional reads.
				send('complete', {
					pipeline_id: pipelineId,
					stages: results
				});
			}
		},
		cancel() {
			streamClosed = true;
			watchAbort.abort();
			invocationAbort.abort();
			stopActiveTimers();
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
}, { component: 'search/stream' });
