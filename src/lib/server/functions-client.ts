import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { adminAuth } from '$lib/firebase/admin';
import { ApiProblem } from '$lib/server/api';
import {
	PUBLIC_FIREBASE_API_KEY,
	PUBLIC_FIREBASE_PROJECT_ID
} from '$env/static/public';
import { env as publicEnv } from '$env/dynamic/public';
import type { SearchPipelineRequest } from '$lib/types/search';

const FUNCTIONS_REGION = process.env.FIREBASE_FUNCTIONS_REGION ?? 'us-central1';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? PUBLIC_FIREBASE_PROJECT_ID;
const FUNCTIONS_EMULATOR_ORIGIN = process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN
	?.replace(/\/+$/, '')
	|| null;
const AUTH_EMULATOR_ORIGIN = resolveAuthEmulatorOrigin();
const USING_AUTH_EMULATOR = Boolean(AUTH_EMULATOR_ORIGIN);
const FIREBASERC_PROJECT_ID = resolveFirebasercProjectId();

if (!PROJECT_ID) {
	throw new Error('FIREBASE_PROJECT_ID or PUBLIC_FIREBASE_PROJECT_ID must be configured.');
}

if (USING_AUTH_EMULATOR && FIREBASERC_PROJECT_ID && PROJECT_ID !== FIREBASERC_PROJECT_ID) {
	throw new Error(
		`FIREBASE_PROJECT_ID (${PROJECT_ID}) does not match .firebaserc default (${FIREBASERC_PROJECT_ID}).`
	);
}

const FUNCTION_BASE = FUNCTIONS_EMULATOR_ORIGIN
	? `${FUNCTIONS_EMULATOR_ORIGIN.replace(/\/$/, '')}/${PROJECT_ID}/${FUNCTIONS_REGION}`
	: `https://${FUNCTIONS_REGION}-${PROJECT_ID}.cloudfunctions.net`;
export const SEARCH_PIPELINE_URL = `${FUNCTION_BASE}/search_pipeline_orchestrator`;
export const LEGACY_SEARCH_PIPELINE_URL = `${FUNCTION_BASE}/search_pipeline`;

export async function mintIdToken(uid: string): Promise<string> {
	if (!PUBLIC_FIREBASE_API_KEY && !USING_AUTH_EMULATOR) {
		throw new ApiProblem({
			status: 500,
			code: 'CONFIG_MISSING',
			message: 'PUBLIC_FIREBASE_API_KEY is required to invoke Cloud Functions.'
		});
	}

	const customToken = await adminAuth.createCustomToken(uid);
	const tokenEndpoint = USING_AUTH_EMULATOR
		? `${AUTH_EMULATOR_ORIGIN}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=any`
		: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${PUBLIC_FIREBASE_API_KEY}`;
	const response = await fetch(tokenEndpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token: customToken, returnSecureToken: true })
	});
	const body = await response.json();
	if (!response.ok || !body.idToken) {
		const message = body?.error?.message ?? 'Failed to mint Firebase ID token.';
		throw new ApiProblem({
			status: 500,
			code: 'TOKEN_EXCHANGE_FAILED',
			message,
			details: body
		});
	}
	return body.idToken;
}

interface InvokeOptions {
	uid?: string;
	pipelineId?: string;
	signal?: AbortSignal;
}

export async function invokeSearchPipeline(
	request: SearchPipelineRequest,
	options: InvokeOptions = {}
): Promise<Response> {
	return callCallableFunction(SEARCH_PIPELINE_URL, request, options);
}

export async function invokeLegacySearchPipeline(
	request: SearchPipelineRequest,
	options: InvokeOptions = {}
): Promise<Response> {
	const { uid, signal } = options;
	return callCallableFunction(LEGACY_SEARCH_PIPELINE_URL, request, { uid, signal });
}

async function callCallableFunction(
	endpoint: string,
	request: SearchPipelineRequest,
	options: InvokeOptions = {}
): Promise<Response> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};

	const uid = options.uid ?? 'server-service-user';
	const idToken = await mintIdToken(uid);
	headers.Authorization = `Bearer ${idToken}`;

	const payload: Record<string, unknown> = { ...request };
	if (options.pipelineId) {
		payload.pipeline_id = options.pipelineId;
	}

	return fetch(endpoint, {
		method: 'POST',
		headers,
		body: JSON.stringify({ data: payload }),
		signal: options.signal
	});
}

export const functionsConfig = {
	FUNCTIONS_REGION,
	PROJECT_ID,
	FUNCTIONS_EMULATOR_ORIGIN,
	FUNCTION_BASE,
	AUTH_EMULATOR_ORIGIN
};

function resolveAuthEmulatorOrigin(): string | null {
	const fromProcess = process.env.FIREBASE_AUTH_EMULATOR_HOST;
	if (fromProcess) {
		return normalizeOrigin(fromProcess);
	}
	const fromPublicEnv = publicEnv.PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
	if (fromPublicEnv) {
		return normalizeOrigin(fromPublicEnv);
	}
	return null;
}

function normalizeOrigin(rawHost: string): string {
	const trimmed = rawHost.trim().replace(/\/+$/, '');
	if (!trimmed) {
		return trimmed;
	}
	return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

type FirebaseRc = {
	projects?: {
		default?: string;
	};
};

function resolveFirebasercProjectId(): string | null {
	try {
		const rcPath = join(process.cwd(), '.firebaserc');
		const contents = readFileSync(rcPath, 'utf8');
		const config = JSON.parse(contents) as FirebaseRc;
		return config?.projects?.default ?? null;
	} catch {
		return null;
	}
}
