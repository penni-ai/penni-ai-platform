import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/core';
import { firestore } from '$lib/server/core';
import { Timestamp } from 'firebase-admin/firestore';

const PIPELINE_COLLECTION = 'pipeline_jobs';

export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	assertSameOrigin(event);

	const pipelineId = event.params.pipelineId;
	if (!pipelineId) {
		throw new ApiProblem({
			status: 400,
			code: 'PIPELINE_ID_REQUIRED',
			message: 'Pipeline ID is required.'
		});
	}

	const logger = event.locals.logger.child({ component: 'pipeline', action: 'cancel', pipelineId });

	const jobRef = firestore.collection(PIPELINE_COLLECTION).doc(pipelineId);
	const jobSnap = await jobRef.get();

	if (!jobSnap.exists) {
		throw new ApiProblem({
			status: 404,
			code: 'PIPELINE_NOT_FOUND',
			message: 'Pipeline not found.'
		});
	}

	const jobData = jobSnap.data() as { uid?: string | null; status?: string | null };
	const jobOwnerUid = typeof jobData.uid === 'string' ? jobData.uid : null;
	if (jobOwnerUid && jobOwnerUid !== user.uid) {
		throw new ApiProblem({
			status: 403,
			code: 'PIPELINE_FORBIDDEN',
			message: 'You do not have access to this pipeline.'
		});
	}

	const currentStatus = typeof jobData.status === 'string' ? jobData.status : null;
	if (currentStatus === 'completed' || currentStatus === 'error' || currentStatus === 'cancelled') {
		return apiOk({ status: currentStatus, cancel_requested: true });
	}

	await jobRef.update({
		status: 'cancelled',
		cancel_requested: true,
		end_time: Timestamp.now(),
		updated_at: Timestamp.now()
	});

	logger.info('Pipeline cancellation requested');
	return apiOk({ status: 'cancelled', cancel_requested: true });
});

