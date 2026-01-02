import { CloudTasksClient } from '@google-cloud/tasks';
import { createLogger } from './logger.js';

type TaskQueueKind = 'stage' | 'batch' | 'poll';

const DEFAULT_LOCATION = process.env.CLOUD_TASKS_LOCATION || process.env.GOOGLE_CLOUD_REGION || 'us-central1';
const DEFAULT_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'penni-ai-platform';
const logger = createLogger({ component: 'cloud-tasks' });

function isEmulatorMode(): boolean {
	return Boolean(
		process.env.FIRESTORE_EMULATOR_HOST ||
			process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
			process.env.FIREBASE_AUTH_EMULATOR_HOST
	);
}

function shouldDispatchDirect(): boolean {
	if (process.env.PIPELINE_TASKS_DIRECT === 'true') {
		return true;
	}

	if (process.env.CLOUD_TASKS_EMULATOR_HOST) {
		return false;
	}

	return isEmulatorMode();
}

function getTasksClient(): CloudTasksClient {
	const emulatorHost = process.env.CLOUD_TASKS_EMULATOR_HOST;
	if (emulatorHost) {
		return new CloudTasksClient({ apiEndpoint: emulatorHost });
	}

	return new CloudTasksClient();
}

function getQueueName(kind: TaskQueueKind): string {
	if (kind === 'stage') {
		return process.env.PIPELINE_TASKS_QUEUE_STAGE || 'pipeline-stage';
	}
	if (kind === 'batch') {
		return process.env.PIPELINE_TASKS_QUEUE_BATCH || 'pipeline-batch';
	}
	return process.env.PIPELINE_TASKS_QUEUE_POLL || 'pipeline-poll';
}

function getBaseUrl(): string {
	const explicit = process.env.PIPELINE_TASKS_BASE_URL;
	if (explicit) {
		return explicit.replace(/\/+$/, '');
	}

	const port = process.env.PORT || '8080';
	return `http://localhost:${port}`;
}

function buildTaskUrl(path: string): string {
	const baseUrl = getBaseUrl();
	const cleanPath = path.startsWith('/') ? path : `/${path}`;
	return `${baseUrl}${cleanPath}`;
}

export type EnqueueTaskOptions = {
	kind: TaskQueueKind;
	path: string;
	payload: Record<string, unknown>;
	delaySeconds?: number;
};

export async function enqueueTask(options: EnqueueTaskOptions): Promise<void> {
	const { kind, path, payload, delaySeconds } = options;
	const url = buildTaskUrl(path);

	if (shouldDispatchDirect()) {
		void fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		}).catch((error) => {
			logger.error('tasks_direct_dispatch_failed', { error });
		});
		return;
	}

	const client = getTasksClient();
	const queue = getQueueName(kind);
	const parent = client.queuePath(DEFAULT_PROJECT_ID, DEFAULT_LOCATION, queue);
	const serviceAccountEmail = process.env.CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL;
	const audience = process.env.CLOUD_TASKS_OIDC_AUDIENCE || process.env.PIPELINE_TASKS_BASE_URL;

	const task: any = {
		httpRequest: {
			httpMethod: 'POST',
			url,
			headers: { 'Content-Type': 'application/json' },
			body: Buffer.from(JSON.stringify(payload)).toString('base64'),
		},
	};

	if (delaySeconds && delaySeconds > 0) {
		task.scheduleTime = {
			seconds: Math.floor(Date.now() / 1000) + delaySeconds,
		};
	}

	if (serviceAccountEmail) {
		task.httpRequest.oidcToken = {
			serviceAccountEmail,
			audience: audience || url,
		};
	}

	await client.createTask({ parent, task });
}
