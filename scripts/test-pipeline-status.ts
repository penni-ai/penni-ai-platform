import { randomUUID } from 'node:crypto';
import { cert, getApp, getApps, initializeApp, type AppOptions } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId =
	process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? process.env.PUBLIC_FIREBASE_PROJECT_ID;

if (!projectId) {
	console.error('Set FIREBASE_PROJECT_ID (or GCLOUD_PROJECT) before running this test.');
	process.exit(1);
}

const target = process.env.FIRESTORE_EMULATOR_HOST ? 'emulator' : 'remote';

async function main() {
	const app = ensureFirebaseApp(projectId);
	const firestore = getFirestore(app);
	const pipelineId = `pipeline_status_test_${randomUUID()}`;
	const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

	const docRef = firestore.collection('search_pipeline_runs').doc(pipelineId);
	const payload = {
		pipeline_id: pipelineId,
		userId: 'test-pipeline-status',
		status: 'running',
		current_stage: 'SEARCH',
		completed_stages: [] as string[],
		overall_progress: 0,
		start_time: new Date(),
		end_time: null,
		created_at: new Date(),
		updated_at: new Date(),
		ttl: expiresAt
	};

	await docRef.set(payload);
	const snapshot = await docRef.get();

	if (!snapshot.exists) {
		throw new Error('Pipeline status document was not found after write.');
	}

	const data = snapshot.data();
	if (!data || data.pipeline_id !== pipelineId) {
		throw new Error('Read payload does not match the written pipeline ID.');
	}

	console.log(
		`[${target}] Verified search_pipeline_runs write/read for ${pipelineId} (status=${data.status ?? 'unknown'})`
	);

	await docRef.delete();
}

function ensureFirebaseApp(project: string) {
	if (getApps().length) {
		return getApp();
	}

	const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
	const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

	const options: AppOptions = { projectId: project };
	if (clientEmail && privateKey) {
		options.credential = cert({ projectId: project, clientEmail, privateKey });
	}

	return initializeApp(options);
}

main().catch((error) => {
	console.error(`[${target}] Pipeline status verification failed:`, error);
	process.exit(1);
});
