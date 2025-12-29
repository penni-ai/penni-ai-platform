import { randomUUID } from 'crypto';
import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute } from '$lib/server/core';
import { emailQueueCollectionRef, type EmailQueueStatus } from '$lib/server/core/firestore';

type SeedQueuedEmail = {
	to: string;
	subject: string;
	htmlBody?: string;
	senderConnectionId?: string;
	senderEmail?: string;
	status?: EmailQueueStatus;
};

type SeedBody = {
	uid?: string;
	queueEmails?: SeedQueuedEmail[];
};

function allowTestAccess(): boolean {
	return Boolean(
		process.env.E2E_TESTING === 'true' ||
			process.env.FIRESTORE_EMULATOR_HOST ||
			process.env.FIREBASE_AUTH_EMULATOR_HOST
	);
}

export const POST = handleApiRoute(async (event) => {
	assertSameOrigin(event);
	if (!allowTestAccess()) {
		throw new ApiProblem({
			status: 403,
			code: 'TEST_SEED_DISABLED',
			message: 'Test seeding is only available in emulator or E2E mode.'
		});
	}

	let body: SeedBody;
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

	const uid = (body.uid || 'e2e-test-user-0001').trim();
	const queueEmails = Array.isArray(body.queueEmails) ? body.queueEmails : [];
	const now = Date.now();
	const created: string[] = [];

	if (queueEmails.length > 0) {
		const queueRef = emailQueueCollectionRef(uid);
		const batch = queueRef.firestore.batch();

		for (const seed of queueEmails) {
			const id = randomUUID();
			created.push(id);
			batch.set(queueRef.doc(id), {
				id,
				campaignId: null,
				influencerId: null,
				influencerName: null,
				to: seed.to,
				subject: seed.subject,
				htmlBody: seed.htmlBody ?? '<p>Fixture outreach email</p>',
				senderConnectionId: seed.senderConnectionId ?? 'fixture-connection',
				senderEmail: seed.senderEmail ?? 'fixture@example.com',
				status: seed.status ?? 'queued',
				priority: 100,
				createdAt: now,
				scheduledFor: now,
				processedAt: null,
				sentAt: null,
				attempts: 0,
				maxAttempts: 3,
				lastError: null,
				lastAttemptAt: null,
				updatedAt: now
			});
		}

		await batch.commit();
	}

	return apiOk({ status: 'ok', uid, created });
}, { component: 'test-seed' });
