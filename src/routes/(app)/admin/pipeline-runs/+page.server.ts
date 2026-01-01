import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/core';
import { listPipelineRuns, parsePipelineRunQuery } from '$lib/server/admin/pipeline-runs';

export const load: PageServerLoad = async (event) => {
	requireAdmin(event);

	const { filters, inputs, errors } = parsePipelineRunQuery(event.url.searchParams);
	if (errors.length > 0) {
		throw error(400, errors[0]);
	}

	const { runs, nextCursor } = await listPipelineRuns(filters);

	return {
		runs,
		nextCursor,
		filters: inputs
	};
};
