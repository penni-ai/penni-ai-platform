import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isAdminUser } from '$lib/server/core';
import { getPipelineRun, listPipelineBatches } from '$lib/server/admin/pipeline-runs';

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) {
		throw redirect(303, '/sign-in');
	}
	if (!isAdminUser(user)) {
		throw error(403, 'Admin access required.');
	}
	const pipelineId = event.params.pipelineId;

	if (!pipelineId) {
		throw error(400, 'Pipeline ID is required.');
	}

	let run: Awaited<ReturnType<typeof getPipelineRun>> | null = null;
	try {
		run = await getPipelineRun(pipelineId);
	} catch (err) {
		event.locals.logger?.error('Failed to load admin pipeline run', {
			error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
			pipelineId
		});
		throw error(500, 'Failed to load pipeline run.');
	}
	if (!run) {
		throw error(404, 'Pipeline run not found.');
	}

	let batches: Awaited<ReturnType<typeof listPipelineBatches>> = [];
	try {
		batches = await listPipelineBatches(pipelineId);
	} catch (err) {
		event.locals.logger?.error('Failed to load admin pipeline batches', {
			error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
			pipelineId
		});
	}

	return { run, batches };
};
