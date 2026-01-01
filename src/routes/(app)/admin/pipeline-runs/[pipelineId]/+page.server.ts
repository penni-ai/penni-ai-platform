import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/core';
import { getPipelineRun } from '$lib/server/admin/pipeline-runs';

export const load: PageServerLoad = async (event) => {
	requireAdmin(event);
	const pipelineId = event.params.pipelineId;

	if (!pipelineId) {
		throw error(400, 'Pipeline ID is required.');
	}

	const run = await getPipelineRun(pipelineId);
	if (!run) {
		throw error(404, 'Pipeline run not found.');
	}

	return { run };
};
