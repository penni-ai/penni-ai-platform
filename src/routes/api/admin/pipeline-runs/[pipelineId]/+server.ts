import { ApiProblem, apiOk, handleApiRoute } from '$lib/server/core';
import { requireAdmin } from '$lib/server/core';
import { getPipelineRun } from '$lib/server/admin/pipeline-runs';

export const GET = handleApiRoute(async (event) => {
	requireAdmin(event);
	const pipelineId = event.params.pipelineId;
	if (!pipelineId) {
		throw new ApiProblem({
			status: 400,
			code: 'PIPELINE_ID_REQUIRED',
			message: 'Pipeline ID is required.'
		});
	}

	const run = await getPipelineRun(pipelineId);
	if (!run) {
		throw new ApiProblem({
			status: 404,
			code: 'PIPELINE_NOT_FOUND',
			message: 'Pipeline run not found.'
		});
	}

	return apiOk({ run });
}, { component: 'admin/pipeline-runs/detail' });
