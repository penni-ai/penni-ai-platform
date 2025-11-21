import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GoogleAuth, type IdTokenClient } from 'google-auth-library';

import { adminAuth } from '$lib/firebase/admin';
import { ApiProblem } from '../core';
import { env as publicEnv } from '$env/dynamic/public';
import type { SearchPipelineRequest } from '$lib/types/search';

const FUNCTIONS_REGION = process.env.FIREBASE_FUNCTIONS_REGION ?? 'us-central1';
const FUNCTIONS_EMULATOR_ORIGIN = process.env.FIREBASE_FUNCTIONS_EMULATOR_ORIGIN
	?.replace(/\/+$/, '')
	|| null;
const AUTH_EMULATOR_ORIGIN = resolveAuthEmulatorOrigin();
const USING_AUTH_EMULATOR = Boolean(AUTH_EMULATOR_ORIGIN);
const FIREBASERC_PROJECT_ID = resolveFirebasercProjectId();

function getProjectId(): string {
	const projectId = process.env.FIREBASE_PROJECT_ID ?? publicEnv.PUBLIC_FIREBASE_PROJECT_ID;
	if (!projectId) {
		throw new Error('FIREBASE_PROJECT_ID or PUBLIC_FIREBASE_PROJECT_ID must be configured.');
	}

	if (USING_AUTH_EMULATOR && FIREBASERC_PROJECT_ID && projectId !== FIREBASERC_PROJECT_ID) {
		throw new Error(
			`FIREBASE_PROJECT_ID (${projectId}) does not match .firebaserc default (${FIREBASERC_PROJECT_ID}).`
		);
	}

	return projectId;
}

function getFunctionBase(): string {
	const projectId = getProjectId();
	return FUNCTIONS_EMULATOR_ORIGIN
		? `${FUNCTIONS_EMULATOR_ORIGIN.replace(/\/$/, '')}/${projectId}/${FUNCTIONS_REGION}`
		: `https://${FUNCTIONS_REGION}-${projectId}.cloudfunctions.net`;
}

export function getSearchPipelineUrl(): string {
	return `${getFunctionBase()}/search_pipeline_orchestrator`;
}

export function getLegacySearchPipelineUrl(): string {
	return `${getFunctionBase()}/search_pipeline`;
}

// Removed const exports - use getSearchPipelineUrl() and getLegacySearchPipelineUrl() functions instead
// These are evaluated lazily at runtime, not at module load time

export async function mintIdToken(uid: string): Promise<string> {
	const apiKey = publicEnv.PUBLIC_FIREBASE_API_KEY;
	if (!apiKey && !USING_AUTH_EMULATOR) {
		throw new ApiProblem({
			status: 500,
			code: 'CONFIG_MISSING',
			message: 'PUBLIC_FIREBASE_API_KEY is required to invoke Cloud Functions.'
		});
	}

	const customToken = await adminAuth.createCustomToken(uid);
	const tokenEndpoint = USING_AUTH_EMULATOR
		? `${AUTH_EMULATOR_ORIGIN}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=any`
		: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;
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
	return callCallableFunction(getSearchPipelineUrl(), request, options);
}

export async function invokeLegacySearchPipeline(
	request: SearchPipelineRequest,
	options: InvokeOptions = {}
): Promise<Response> {
	const { uid, signal } = options;
	return callCallableFunction(getLegacySearchPipelineUrl(), request, { uid, signal });
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

export function getFunctionsConfig() {
	return {
		FUNCTIONS_REGION,
		PROJECT_ID: getProjectId(),
		FUNCTIONS_EMULATOR_ORIGIN,
		FUNCTION_BASE: getFunctionBase(),
		AUTH_EMULATOR_ORIGIN
	};
}

/**
 * Gets the Cloud Run pipeline service URL from environment variables.
 * This function retrieves the URL for the new Cloud Run-based pipeline service
 * that replaces the Cloud Functions implementation.
 * 
 * @returns The Cloud Run service URL with trailing slashes removed
 * @throws {ApiProblem} If CLOUD_RUN_PIPELINE_SERVICE_URL is not configured
 */
export function getCloudRunPipelineUrl(): string {
	const url = process.env.CLOUD_RUN_PIPELINE_SERVICE_URL;
	if (!url) {
		throw new ApiProblem({
			status: 500,
			code: 'CONFIG_MISSING',
			message: 'CLOUD_RUN_PIPELINE_SERVICE_URL is required but not configured.'
		});
	}
	return url.replace(/\/+$/, '');
}

/**
 * Gets a service account access token for authenticating with Cloud Run services.
 * In App Hosting, this uses the default service account credentials.
 * In local development, this uses Application Default Credentials (ADC).
 */
let cachedAuth: GoogleAuth | null = null;
const cachedIdTokenClients = new Map<string, IdTokenClient>();

export async function getServiceAccountAccessToken(audience: string): Promise<string> {
    // In emulator, no token needed
    if (FUNCTIONS_EMULATOR_ORIGIN) {
        return 'emulator-token';
    }

    try {
        if (!cachedAuth) {
            // Initialize GoogleAuth - it will automatically use Application Default Credentials
            // In App Hosting, this uses the firebase-app-hosting-compute service account
            // Explicitly set projectId to avoid auto-discovery issues
            const projectId = getProjectId();
            cachedAuth = new GoogleAuth({
                scopes: 'https://www.googleapis.com/auth/cloud-platform',
                projectId: projectId
            });
        }

        // Use getIdTokenClient as per Google Auth Library best practices
        // This automatically handles token refresh and caching
        let client = cachedIdTokenClients.get(audience);
        if (!client) {
            // getIdTokenClient creates a client that can fetch ID tokens for the given audience
            client = await cachedAuth.getIdTokenClient(audience);
            cachedIdTokenClients.set(audience, client);
        }

        // getRequestHeaders returns headers with the Authorization header containing the ID token
        const headers = await client.getRequestHeaders(audience);
        // Headers is a Headers object (from fetch API), use .get() method
        const authorization = headers.get('Authorization') || headers.get('authorization');
        if (!authorization?.startsWith('Bearer ')) {
            throw new Error('Failed to obtain ID token: Authorization header missing or invalid');
        }
        return authorization.slice('Bearer '.length);
    } catch (error) {
        // Log detailed error information for debugging
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        const projectId = getProjectId();
        
        console.error('[getServiceAccountAccessToken] Failed to get ID token', {
            audience,
            projectId,
            error: errorMessage,
            stack: errorStack,
            environment: {
                GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS || 'not set',
                GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT || 'not set',
                FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || 'not set'
            },
            hint: 'In App Hosting, Application Default Credentials should be automatically available. ' +
                  'Ensure the service account (firebase-app-hosting-compute) has roles/iam.serviceAccountTokenCreator role.'
        });
        
        throw new ApiProblem({
            status: 500,
            code: 'SERVICE_ACCOUNT_AUTH_FAILED',
            message: 'Failed to authenticate with service account for Cloud Function call.',
            cause: error,
            details: {
                error: errorMessage,
                stack: errorStack,
                audience,
                projectId
            }
        });
    }
}

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
