import { adminAuth, adminDb, adminStorage } from '../src/lib/firebase/admin';

type Args = {
	uid: string;
	dryRun: boolean;
	skipAuth: boolean;
	skipFirestore: boolean;
	skipStorage: boolean;
	skipDeletionRequestUpdate: boolean;
};

function parseArgs(argv: string[]): Args {
	const args = argv.slice(2);
	const getValue = (flag: string): string | null => {
		const idx = args.indexOf(flag);
		if (idx === -1) return null;
		const value = args[idx + 1];
		if (!value || value.startsWith('--')) return null;
		return value;
	};

	const uid = getValue('--uid');
	if (!uid) {
		throw new Error('Missing required flag: --uid <uid>');
	}

	return {
		uid,
		dryRun: args.includes('--dry-run'),
		skipAuth: args.includes('--skip-auth'),
		skipFirestore: args.includes('--skip-firestore'),
		skipStorage: args.includes('--skip-storage'),
		skipDeletionRequestUpdate: args.includes('--skip-deletion-request-update')
	};
}

async function deleteFirestoreUserSubtree(uid: string, dryRun: boolean): Promise<void> {
	const userRef = adminDb.collection('users').doc(uid);
	if (dryRun) {
		console.log('[delete-user-data] would delete Firestore subtree', { path: userRef.path });
		return;
	}

	if (typeof (adminDb as any).recursiveDelete === 'function') {
		await (adminDb as any).recursiveDelete(userRef);
		return;
	}

	console.warn('[delete-user-data] Firestore recursiveDelete not available; deleting only user doc', { path: userRef.path });
	await userRef.delete();
}

async function deletePipelineJobs(uid: string, dryRun: boolean): Promise<string[]> {
	const jobIds: string[] = [];

	while (true) {
		const snapshot = await adminDb.collection('pipeline_jobs').where('uid', '==', uid).limit(500).get();
		if (snapshot.empty) break;

		snapshot.docs.forEach((doc) => jobIds.push(doc.id));
		if (!dryRun) {
			const batch = adminDb.batch();
			snapshot.docs.forEach((doc) => batch.delete(doc.ref));
			await batch.commit();
		} else {
			console.log('[delete-user-data] would delete pipeline_jobs batch', { count: snapshot.size });
		}

		if (snapshot.size < 500) break;
	}

	return jobIds;
}

async function deleteStorageForPipelineJobs(jobIds: string[], dryRun: boolean): Promise<number> {
	if (jobIds.length === 0) return 0;

	const bucket = adminStorage.bucket();
	let deletedPrefixes = 0;

	for (const jobId of jobIds) {
		const prefix = `pipeline_jobs/${jobId}/`;
		if (dryRun) {
			console.log('[delete-user-data] would delete storage prefix', { bucket: bucket.name, prefix });
			deletedPrefixes++;
			continue;
		}
		try {
			await bucket.deleteFiles({ prefix, force: true });
			deletedPrefixes++;
		} catch (error) {
			console.warn('[delete-user-data] failed to delete storage prefix', {
				prefix,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	return deletedPrefixes;
}

async function deleteStorageForUserPrefix(uid: string, dryRun: boolean): Promise<boolean> {
	const bucket = adminStorage.bucket();
	const prefix = `users/${uid}/`;
	if (dryRun) {
		console.log('[delete-user-data] would delete storage prefix', { bucket: bucket.name, prefix });
		return true;
	}
	try {
		await bucket.deleteFiles({ prefix, force: true });
		return true;
	} catch (error) {
		console.warn('[delete-user-data] failed to delete user storage prefix', {
			prefix,
			error: error instanceof Error ? error.message : String(error)
		});
		return false;
	}
}

async function disableAuthUser(uid: string, dryRun: boolean): Promise<void> {
	if (dryRun) {
		console.log('[delete-user-data] would disable auth user + revoke refresh tokens', { uid });
		return;
	}

	try {
		await adminAuth.updateUser(uid, { disabled: true });
	} catch (error) {
		console.warn('[delete-user-data] failed to disable auth user', {
			uid,
			error: error instanceof Error ? error.message : String(error)
		});
	}

	try {
		await adminAuth.revokeRefreshTokens(uid);
	} catch (error) {
		console.warn('[delete-user-data] failed to revoke refresh tokens', {
			uid,
			error: error instanceof Error ? error.message : String(error)
		});
	}
}

async function markDeletionRequestCompleted(uid: string, dryRun: boolean): Promise<void> {
	const ref = adminDb.collection('deletionRequests').doc(uid);
	const now = Date.now();
	if (dryRun) {
		console.log('[delete-user-data] would mark deletionRequests completed', { path: ref.path });
		return;
	}
	await ref.set(
		{
			uid,
			status: 'completed',
			completedAt: now,
			updatedAt: now
		},
		{ merge: true }
	);
}

async function main() {
	if (process.argv.includes('--help') || process.argv.includes('-h')) {
		console.log(`Usage: tsx scripts/delete-user-data.ts --uid <uid> [options]

Options:
  --dry-run                        Print what would change without writing
  --skip-auth                      Skip Firebase Auth disable/revoke
  --skip-firestore                 Skip deleting Firestore user subtree
  --skip-storage                   Skip deleting Cloud Storage objects
  --skip-deletion-request-update   Skip marking deletionRequests/{uid} completed
`);
		return;
	}

	const args = parseArgs(process.argv);
	const { uid, dryRun } = args;

	console.log('[delete-user-data] start', {
		uid,
		dryRun,
		skipAuth: args.skipAuth,
		skipFirestore: args.skipFirestore,
		skipStorage: args.skipStorage,
		skipDeletionRequestUpdate: args.skipDeletionRequestUpdate
	});

	if (!args.skipAuth) {
		await disableAuthUser(uid, dryRun);
	}

	let jobIds: string[] = [];
	if (!args.skipFirestore) {
		await deleteFirestoreUserSubtree(uid, dryRun);
		jobIds = await deletePipelineJobs(uid, dryRun);
	} else {
		jobIds = await deletePipelineJobs(uid, true);
	}

	if (!args.skipStorage) {
		const prefixesDeleted = await deleteStorageForPipelineJobs(jobIds, dryRun);
		await deleteStorageForUserPrefix(uid, dryRun);
		console.log('[delete-user-data] storage cleanup complete', {
			pipeline_job_prefixes_deleted: prefixesDeleted,
			pipeline_job_count: jobIds.length
		});
	}

	if (!args.skipDeletionRequestUpdate) {
		await markDeletionRequestCompleted(uid, dryRun);
	}

	console.log('[delete-user-data] complete', { uid, dryRun, pipeline_jobs_deleted: jobIds.length });
}

main().catch((error) => {
	console.error('[delete-user-data] failed', { message: error instanceof Error ? error.message : String(error) });
	process.exitCode = 1;
});

