import { ApiProblem, handleApiRoute, requireUser, userDocRef } from '$lib/server/core';

export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);

	let body: unknown;
	try {
		body = await event.request.json();
	} catch (error) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_JSON',
			message: 'Request body must be valid JSON.',
			cause: error
		});
	}

	if (!body || typeof body !== 'object') {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_PAYLOAD',
			message: 'Request body must be an object.',
			hint: 'Send a JSON payload with "action" field (complete or skip).'
		});
	}

	const payload = body as Record<string, unknown>;
	const action = typeof payload.action === 'string' ? payload.action : '';

	if (action !== 'complete' && action !== 'skip') {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_ACTION',
			message: 'action must be "complete" or "skip".'
		});
	}

	const logger = event.locals.logger.child({
		userId: user.uid,
		action: 'update_onboarding',
		onboardingAction: action
	});

	try {
		const now = Date.now();
		const update: Record<string, unknown> = {
			'onboarding.tutorialCompleted': action === 'complete',
			'onboarding.tutorialSkipped': action === 'skip',
			updatedAt: now
		};

		if (action === 'complete') {
			update['onboarding.tutorialCompletedAt'] = now;
		}

		await userDocRef(user.uid).update(update);

		logger.info('Onboarding status updated', { action });

		return new Response(JSON.stringify({ success: true, action }), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		logger.error('Failed to update onboarding status', { error });
		throw new ApiProblem({
			status: 500,
			code: 'UPDATE_FAILED',
			message: 'Failed to update onboarding status.',
			cause: error
		});
	}
}, { component: 'user' });
