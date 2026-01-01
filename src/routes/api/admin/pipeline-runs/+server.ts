import { ApiProblem, apiOk, handleApiRoute } from '$lib/server/core';
import { requireAdmin } from '$lib/server/core';
import { listPipelineRuns, parsePipelineRunQuery } from '$lib/server/admin/pipeline-runs';

export const GET = handleApiRoute(async (event) => {
	requireAdmin(event);

	const { filters, errors } = parsePipelineRunQuery(event.url.searchParams);
	if (errors.length > 0) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_QUERY',
			message: errors[0],
			details: { errors }
		});
	}

	const result = await listPipelineRuns(filters);
	return apiOk(result);
}, { component: 'admin/pipeline-runs' });
