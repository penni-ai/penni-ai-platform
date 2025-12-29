import { env as publicEnv } from '$env/dynamic/public';
import { adminAuth } from '$lib/firebase/admin';
import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute } from '$lib/server/core';
import { firestore } from '$lib/server/core';
import { ensureFeatureCapabilities } from '$lib/server/billing';

const SESSION_COOKIE_NAME = '__session';
const WEEK = 1000 * 60 * 60 * 24 * 7;
const FORTNIGHT = 1000 * 60 * 60 * 24 * 14;

type TestLoginBody = {
	email?: string;
	password?: string;
	uid?: string;
	remember?: boolean;
	reset?: boolean;
};

function allowTestAccess(): boolean {
	return Boolean(
		process.env.E2E_TESTING === 'true' ||
			process.env.FIREBASE_AUTH_EMULATOR_HOST ||
			process.env.FIRESTORE_EMULATOR_HOST
	);
}

function getAuthEmulatorOrigin(): string {
	const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
	if (!host) {
		throw new ApiProblem({
			status: 500,
			code: 'AUTH_EMULATOR_REQUIRED',
			message: 'FIREBASE_AUTH_EMULATOR_HOST must be set for test login.'
		});
	}
	return host.startsWith('http') ? host : `http://${host}`;
}

async function resetUserData(uid: string): Promise<void> {
	const userRef = firestore.collection('users').doc(uid);
	try {
		if (typeof firestore.recursiveDelete === 'function') {
			await firestore.recursiveDelete(userRef);
		} else {
			await userRef.delete();
		}
	} catch (error) {
		console.warn('[test-login] Failed to delete user document', { uid, error });
	}

	try {
		const pipelineSnap = await firestore.collection('pipeline_jobs').where('uid', '==', uid).get();
		if (!pipelineSnap.empty) {
			const batch = firestore.batch();
			pipelineSnap.docs.forEach((doc) => batch.delete(doc.ref));
			await batch.commit();
		}
	} catch (error) {
		console.warn('[test-login] Failed to delete pipeline jobs', { uid, error });
	}
}

async function exchangeCustomToken(customToken: string): Promise<string> {
	const apiKey = publicEnv.PUBLIC_FIREBASE_API_KEY;
	const tokenEndpoint = `${getAuthEmulatorOrigin()}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=any`;
	const response = await fetch(tokenEndpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token: customToken, returnSecureToken: true })
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok || !body.idToken) {
		throw new ApiProblem({
			status: 500,
			code: 'TOKEN_EXCHANGE_FAILED',
			message: 'Failed to exchange custom token in emulator.',
			details: { error: body, apiKeySet: Boolean(apiKey) }
		});
	}
	return body.idToken as string;
}

export const POST = handleApiRoute(async (event) => {
	assertSameOrigin(event);
	if (!allowTestAccess()) {
		throw new ApiProblem({
			status: 403,
			code: 'TEST_LOGIN_DISABLED',
			message: 'Test login is only available in emulator or E2E mode.'
		});
	}

	let body: TestLoginBody;
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

	const email = (body.email || 'search-tester@example.com').trim();
	const password = body.password || 'TestPass123!';
	const uid = (body.uid || 'e2e-test-user-0001').trim();
	const remember = Boolean(body.remember);
	const reset = Boolean(body.reset);

	if (reset) {
		await resetUserData(uid);
	}

	let userRecord = null;
	try {
		userRecord = await adminAuth.getUser(uid);
	} catch {
		userRecord = null;
	}

	if (!userRecord) {
		await adminAuth.createUser({
			uid,
			email,
			password,
			emailVerified: true
		});
	} else if (!userRecord.emailVerified) {
		await adminAuth.updateUser(uid, { emailVerified: true });
	}

	const customToken = await adminAuth.createCustomToken(uid);
	const idToken = await exchangeCustomToken(customToken);
	const expiresIn = remember ? FORTNIGHT : WEEK;
	const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn });

	event.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		path: '/',
		sameSite: 'lax',
		maxAge: Math.floor(expiresIn / 1000)
	});

	await ensureFeatureCapabilities(uid);

	return apiOk({ status: 'ok', uid, email });
}, { component: 'test-login' });
