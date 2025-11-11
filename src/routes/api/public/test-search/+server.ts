import { performance } from 'node:perf_hooks';
import { apiOk, ApiProblem, assertSameOrigin, handleApiRoute } from '$lib/server/api';
import { invokeSearchPipeline } from '$lib/server/functions-client';
import {
	isSearchPipelineResponse,
	STAGE_NAMES,
	type SearchPipelineRequest,
	type SearchPipelineResponse,
	type StageName
} from '$lib/types/search';

const STAGE_ORDER: StageName[] = [...STAGE_NAMES];
const DEFAULT_TEST_BODY = {
	search: {
		query: 'sustainable beauty creators',
		method: 'hybrid' as const,
		limit: 10
	},
	business_fit_query: 'Looking for sustainable beauty influencers for a holiday campaign.',
	max_profiles: 50,
	max_posts: 6,
	model: 'gpt-5-mini',
	verbosity: 'medium',
	concurrency: 32
};

interface TestSearchRequest {
	stages?: StageName[];
	include_raw?: boolean;
	search?: Partial<SearchPipelineRequest['search']>;
	business_fit_query?: string;
	max_profiles?: number;
	max_posts?: number;
	model?: string;
	verbosity?: string;
	concurrency?: number;
}

interface StageResultSummary {
	stage: StageName;
	status: number | null;
	ok: boolean;
	duration_ms: number;
	error?: string | null;
	response_summary?: {
		success: boolean;
		result_count: number;
		stages_returned: string[];
		brightdata_results: number;
		profile_fit: number;
		pipeline_id?: string | null;
	};
	raw_response?: unknown;
}

const TEST_RUNNER_UID = process.env.PUBLIC_TEST_SEARCH_UID ?? 'search-test-runner';

function parseRequestBody(raw: unknown): TestSearchRequest {
	if (raw == null) return {};
	if (typeof raw !== 'object') {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_PAYLOAD',
			message: 'Request body must be a JSON object.'
		});
	}
	return raw as TestSearchRequest;
}

function mergeSearchPayload(body: TestSearchRequest): SearchPipelineRequest {
	const search = { ...DEFAULT_TEST_BODY.search, ...(body.search ?? {}) };
	if (typeof search.query !== 'string' || !search.query.trim()) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_SEARCH_QUERY',
			message: "Search parameter must include a non-empty 'query'."
		});
	}
	return {
		search: search,
		business_fit_query: body.business_fit_query?.trim() || DEFAULT_TEST_BODY.business_fit_query,
		max_profiles: body.max_profiles ?? DEFAULT_TEST_BODY.max_profiles,
		max_posts: body.max_posts ?? DEFAULT_TEST_BODY.max_posts,
		model: body.model ?? DEFAULT_TEST_BODY.model,
		verbosity: body.verbosity ?? DEFAULT_TEST_BODY.verbosity,
		concurrency: body.concurrency ?? DEFAULT_TEST_BODY.concurrency,
		debug_mode: true
	};
}

function normalizeStages(requested?: StageName[]): StageName[] {
	if (!requested || !requested.length) {
		return [...STAGE_ORDER];
	}
	const requestedSet = new Set<StageName>();
	for (const stage of requested) {
		if (STAGE_ORDER.includes(stage)) {
			requestedSet.add(stage);
		}
	}
	const ordered = STAGE_ORDER.filter((stage) => requestedSet.has(stage));
	return ordered.length ? ordered : [...STAGE_ORDER];
}

function summarizeResponse(payload: SearchPipelineResponse | null): StageResultSummary['response_summary'] {
	if (!payload) return undefined;
	return {
		success: payload.success,
		result_count: payload.count,
		stages_returned: payload.stages?.map((stage) => stage.stage) ?? [],
		brightdata_results: payload.brightdata_results?.length ?? 0,
		profile_fit: payload.profile_fit?.length ?? 0,
		pipeline_id: payload.pipeline_id ?? null
	};
}

export const POST = handleApiRoute(async (event) => {
	assertSameOrigin(event);
	let parsedBody: unknown;
	try {
		parsedBody = await event.request.json();
	} catch (error) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_JSON',
			message: 'Request body must be valid JSON.',
			hint: 'Send a JSON payload describing the test parameters.',
			cause: error instanceof Error ? error : undefined
		});
	}
	const body = parseRequestBody(parsedBody);
	const includeRaw = Boolean(body.include_raw);
	const stages = normalizeStages(body.stages);
	const baseRequest = mergeSearchPayload(body);
	const results: StageResultSummary[] = [];

	for (const stage of stages) {
		const started = performance.now();
		let responseBody: unknown = null;
		let status: number | null = null;
		let ok = false;
		let error: string | null = null;

		try {
			const response = await invokeSearchPipeline(
				{ ...baseRequest, stop_at_stage: stage },
				{ uid: TEST_RUNNER_UID }
			);
			status = response.status;
			ok = response.ok;
			try {
				responseBody = await response.json();
			} catch (jsonError) {
				error = jsonError instanceof Error ? jsonError.message : String(jsonError);
			}
		} catch (requestError) {
			error = requestError instanceof Error ? requestError.message : String(requestError);
		}

		const duration_ms = performance.now() - started;
		const envelope = responseBody && typeof responseBody === 'object' ? (responseBody as Record<string, unknown>) : null;
		const resultPayload = envelope && 'result' in envelope ? (envelope.result as unknown) : null;
		const normalizedResult = isSearchPipelineResponse(resultPayload)
			? (resultPayload as SearchPipelineResponse)
			: null;
		if (!error && !ok) {
			error = envelope && typeof envelope.error === 'object' && envelope.error
				? String((envelope.error as { message?: string }).message ?? 'Function error')
				: 'Function error';
		}

		results.push({
			stage,
			status,
			ok: Boolean(ok && normalizedResult?.success),
			duration_ms,
			error,
			response_summary: summarizeResponse(normalizedResult),
			raw_response: includeRaw ? responseBody : undefined
		});

		if (!(ok && normalizedResult?.success)) {
			break;
		}
	}

	return apiOk({
		stages,
		results
	});
}, { component: 'search-test' });
