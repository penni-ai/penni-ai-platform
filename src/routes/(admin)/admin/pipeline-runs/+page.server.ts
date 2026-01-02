import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isAdminUser } from '$lib/server/core';
import { listPipelineRuns, parsePipelineRunQuery } from '$lib/server/admin/pipeline-runs';

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) {
		throw redirect(303, '/sign-in');
	}
	if (!isAdminUser(user)) {
		throw error(403, 'Admin access required.');
	}

	const { filters, inputs, errors } = parsePipelineRunQuery(event.url.searchParams);
	if (errors.length > 0) {
		throw error(400, errors[0]);
	}

	let runs: Awaited<ReturnType<typeof listPipelineRuns>>['runs'] = [];
	let nextCursor: Awaited<ReturnType<typeof listPipelineRuns>>['nextCursor'] = null;
	try {
		const result = await listPipelineRuns(filters);
		runs = result.runs;
		nextCursor = result.nextCursor;
	} catch (err) {
		event.locals.logger?.error('Failed to load admin pipeline runs', {
			error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
			filters
		});
		throw error(500, 'Failed to load pipeline runs.');
	}

	return {
		runs,
		nextCursor,
		filters: inputs
	};
};
