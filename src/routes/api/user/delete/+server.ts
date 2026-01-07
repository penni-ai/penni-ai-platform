import { ApiProblem, apiOk, assertSameOrigin, firestore, handleApiRoute, requireUser, userDocRef } from '$lib/server/core';
import { gmailConnectionsCollectionRef } from '$lib/server/core/firestore';
import { revokeGmailTokens } from '$lib/server/gmail';

type DeleteAccountBody = {
	confirm?: string;
	reason?: string;
};

function allowImmediateDeletion(): boolean {
	return Boolean(process.env.E2E_TESTING === 'true' || process.env.FIRESTORE_EMULATOR_HOST);
}

function getEmailDomain(email: string | null | undefined): string | null {
	if (!email) return null;
	const at = email.lastIndexOf('@');
	if (at <= 0 || at >= email.length - 1) return null;
	return email.slice(at + 1).toLowerCase();
}

async function createOrUpdateDeletionRequest(options: {
	uid: string;
	emailDomain: string | null;
	reason: string | null;
}): Promise<{ requestedAt: number }> {
	const now = Date.now();
	const ref = firestore.collection('deletionRequests').doc(options.uid);

	return await firestore.runTransaction(async (tx) => {
		const existing = await tx.get(ref);
		const requestedAt =
			existing.exists && typeof existing.get('requestedAt') === 'number'
				? (existing.get('requestedAt') as number)
				: now;

		const update: Record<string, unknown> = {
			uid: options.uid,
			email_domain: options.emailDomain,
			reason: options.reason,
			requestedAt,
			status: 'requested',
			updatedAt: now
		};

		if (existing.exists) {
			tx.set(ref, update, { merge: true });
		} else {
			tx.set(ref, update);
		}

		return { requestedAt };
	});
}

async function performImmediateDeletion(uid: string): Promise<void> {
	const userRef = firestore.collection('users').doc(uid);
	if (typeof (firestore as any).recursiveDelete === 'function') {
		await (firestore as any).recursiveDelete(userRef);
	} else {
		await userRef.delete();
	}

	// Remove pipeline job documents (top-level collection).
	while (true) {
		const snap = await firestore.collection('pipeline_jobs').where('uid', '==', uid).limit(500).get();
		if (snap.empty) break;
		const batch = firestore.batch();
		snap.docs.forEach((doc) => batch.delete(doc.ref));
		await batch.commit();
		if (snap.size < 500) break;
	}
}

export const POST = handleApiRoute(async (event) => {
	assertSameOrigin(event);
	const user = requireUser(event);

	let body: DeleteAccountBody;
	try {
		body = (await event.request.json()) as DeleteAccountBody;
	} catch (error) {
		throw new ApiProblem({
			status: 400,
			code: 'INVALID_JSON',
			message: 'Request body must be valid JSON.',
			cause: error
		});
	}

	const confirm = typeof body?.confirm === 'string' ? body.confirm.trim() : '';
	if (confirm !== 'DELETE') {
		throw new ApiProblem({
			status: 400,
			code: 'CONFIRMATION_REQUIRED',
			message: 'To request account deletion, send { "confirm": "DELETE" }.',
			hint: 'This prevents accidental deletions.'
		});
	}

	const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : null;
	const emailDomain = getEmailDomain(user.email);
	const logger = event.locals.logger.child({ userId: user.uid, action: 'account_delete_request' });

	const { requestedAt } = await createOrUpdateDeletionRequest({
		uid: user.uid,
		emailDomain,
		reason: reason || null
	});

	// Mark the user doc as deletion-requested (idempotent).
	await userDocRef(user.uid).set(
		{
			deletion: {
				status: 'requested',
				requestedAt,
				updatedAt: Date.now()
			},
			updatedAt: Date.now()
		},
		{ merge: true }
	);

	// Best-effort: disconnect Gmail and scrub queued content so we stop sending immediately.
	try {
		const connectionsSnap = await gmailConnectionsCollectionRef(user.uid).get();
		if (!connectionsSnap.empty) {
			for (const doc of connectionsSnap.docs) {
				try {
					await revokeGmailTokens(user.uid, doc.id);
				} catch (disconnectError) {
					logger.warn('Account delete: failed to disconnect gmail connection', {
						connectionId: doc.id,
						error: disconnectError
					});
				}
			}
		}
	} catch (error) {
		logger.warn('Account delete: failed to enumerate gmail connections', { error });
	}

	const immediate = allowImmediateDeletion();
	if (immediate) {
		try {
			await performImmediateDeletion(user.uid);
			await firestore.collection('deletionRequests').doc(user.uid).set(
				{
					status: 'completed',
					completedAt: Date.now(),
					updatedAt: Date.now()
				},
				{ merge: true }
			);
			logger.info('Account delete completed (emulator)', { requestedAt });
		} catch (error) {
			logger.error('Account delete failed (emulator)', { error });
			throw new ApiProblem({
				status: 500,
				code: 'DELETE_FAILED',
				message: 'Failed to delete account data in emulator mode.',
				cause: error
			});
		}
	} else {
		logger.info('Account delete requested', { requestedAt });
	}

	return apiOk({
		success: true,
		status: immediate ? 'completed' : 'requested',
		requestedAt
	});
}, { component: 'user' });
