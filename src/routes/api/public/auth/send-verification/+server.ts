import { createHash } from 'crypto';
import { env as publicEnv } from '$env/dynamic/public';
import { adminAuth } from '$lib/firebase/admin';
import { firestore } from '$lib/server/core';
import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute } from '$lib/server/core';

type Payload = {
	email?: string;
};

const RATE_LIMIT_WINDOW_MS = 60_000;

const hashEmail = (email: string) => createHash('sha256').update(email.toLowerCase()).digest('hex');

export const POST = handleApiRoute(async (event) => {
	assertSameOrigin(event);
	let payload: Payload;
	try {
		payload = await event.request.json();
	} catch (error) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_JSON',
			message: 'Request body must be valid JSON.',
			hint: 'Send a JSON payload with the user email.',
			cause: error
		});
	}

	const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
	if (!email) {
		throw new ApiProblem({
			status: 400,
			code: 'EMAIL_REQUIRED',
			message: 'Email is required.',
			hint: 'Provide a valid email address in the "email" field.'
		});
	}

	const origin = publicEnv.PUBLIC_SITE_URL?.replace(/\/$/, '') || event.url.origin;
	const actionCodeSettings = {
		url: `${origin}/sign-in?verified=1`,
		handleCodeInApp: false
	};

	const logger = event.locals.logger.child({ component: 'auth', action: 'send_verification', email });
	const hash = hashEmail(email);
	const now = Date.now();
	const docRef = firestore.collection('emailVerificationRequests').doc(hash);
	const doc = await docRef.get();
	const lastSentAt = doc.exists ? Number((doc.data() as { lastSentAtMs?: number }).lastSentAtMs ?? 0) : 0;

	if (lastSentAt && now - lastSentAt < RATE_LIMIT_WINDOW_MS) {
		throw new ApiProblem({
			status: 429,
			code: 'TOO_MANY_REQUESTS',
			message: 'Verification email recently sent. Please wait before requesting another.',
			hint: 'Try again in about a minute.'
		});
	}

	try {
		const link = await adminAuth.generateEmailVerificationLink(email, actionCodeSettings);
		await docRef.set({
			email,
			lastSentAtMs: now
		});

		logger.info('Verification link generated');

		const responseBody: Record<string, unknown> = { status: 'sent' };
		if (process.env.NODE_ENV !== 'production') {
			responseBody.link = link;
		}

		return apiOk(responseBody);
	} catch (error) {
		if (error instanceof ApiProblem) {
			throw error;
		}
		logger.error('Failed to generate verification link', { error });
		throw new ApiProblem({
			status: 500,
			code: 'VERIFICATION_SEND_FAILED',
			message: 'Unable to send verification email.',
			hint: 'Retry in a few minutes or contact support.',
			cause: error
		});
	}
}, { component: 'auth' });
