import { randomUUID } from 'crypto';
import { apiOk, handleApiRoute, requireUser, ApiProblem, assertSameOrigin } from '$lib/server/api';
import { invokeSearchPipeline, SEARCH_PIPELINE_URL } from '$lib/server/functions-client';
import { decodeCallableResponse } from '$lib/server/firebase-callable';
import { isSearchPipelineRequest, isSearchPipelineResponse } from '$lib/types/search';
import type { SearchPipelineRequest, SearchPipelineResponse } from '$lib/types/search';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object';

/**
 * Validates and types the incoming request payload.
 *
 * Ensures required fields are present:
 * - search.query (non-empty string)
 * - business_fit_query (non-empty string)
 *
 * @param raw - Untyped request body
 * @returns Validated SearchPipelineRequest instance
 * @throws ApiProblem 400 - If payload is invalid or missing required fields
 */
export function normalizePayload(raw: unknown): SearchPipelineRequest {
	if (!raw || typeof raw !== 'object') {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_PAYLOAD',
			message: 'Request body must be a JSON object.',
			hint: "Send a JSON object that includes 'search' and 'business_fit_query' fields."
		});
	}

	if (isSearchPipelineRequest(raw)) {
		return raw;
	}

	const record = raw as Record<string, unknown>;
	const missingFields: string[] = [];
	const invalidFields: string[] = [];

	if (!('search' in record) || typeof record.search !== 'object') {
		missingFields.push('search');
	} else {
		const search = record.search as Record<string, unknown>;
		if (typeof search.query !== 'string' || !search.query.trim()) {
			invalidFields.push('search.query');
		}
	}

	if (!(typeof record.business_fit_query === 'string')) {
		missingFields.push('business_fit_query');
	} else if (!record.business_fit_query.trim()) {
		invalidFields.push('business_fit_query');
	}

	throw new ApiProblem({
		status: 400,
		code: 'INVALID_PAYLOAD',
		message: 'Request body validation failed.',
		hint: "Provide non-empty values for 'search.query' and 'business_fit_query'.",
		details: {
			missing_fields: missingFields.length ? missingFields : undefined,
			invalid_fields: invalidFields.length ? invalidFields : undefined
		}
	});
}

/**
 * POST /api/search
 *
 * Executes the full creator search pipeline via Cloud Functions:
 * 1. Search stage - Vector/text search via external API
 * 2. Rerank stage - Reorder results by relevance
 * 3. BrightData stage - Enrich profiles with fresh data
 * 4. LLM Fit stage - Score profiles against business brief
 *
 * @requires Authentication - User must be signed in
 * @param request.body SearchPipelineRequest - Search parameters and business query
 * @returns SearchPipelineResponse - Scored and enriched creator profiles
 * @throws ApiProblem 400 - Invalid request payload
 * @throws ApiProblem 401 - User not authenticated
 * @throws ApiProblem 502 - Cloud Function invocation failed
 */
export const POST = handleApiRoute(async (event) => {
	assertSameOrigin(event);
	const user = requireUser(event);
	const payload: SearchPipelineRequest = normalizePayload(await event.request.json());
	const pipelineId = randomUUID().replace(/-/g, '');
	event.locals.logger?.info('Dispatching search pipeline', { pipelineId });
	event.locals.logger?.debug?.('Invoking search pipeline callable', {
		pipelineId,
		functionsUrl: SEARCH_PIPELINE_URL
	});

	const response = await invokeSearchPipeline(payload, { uid: user.uid, pipelineId });
	const { envelope, error, rawBody } = await decodeCallableResponse(response);

	if (error) {
		throw new ApiProblem({
			status: error.status,
			code: error.code,
			message: error.message,
			details: {
				error: error.rawError,
				http_status: error.httpStatus,
				body: error.rawBody
			}
		});
	}

	if (!envelope || !('result' in envelope)) {
		throw new ApiProblem({
			status: 502,
			code: 'FUNCTION_ERROR',
			message: 'Cloud Function returned an invalid response.',
			details: { body: rawBody }
		});
	}

	const resultPayload = envelope.result;
	if (!isSearchPipelineResponse(resultPayload)) {
		throw new ApiProblem({
			status: 502,
			code: 'FUNCTION_ERROR',
			message: 'Cloud Function returned an invalid response.',
			details: { body: rawBody }
		});
	}

	return apiOk<SearchPipelineResponse>(resultPayload);
}, { component: 'search' });
