import { json } from '@sveltejs/kit';
import { adminAuth } from '$lib/firebase/admin';
import { env as publicEnv } from '$env/dynamic/public';

const SITE_URL = publicEnv.PUBLIC_SITE_URL ?? 'http://localhost:5002';
const actionCodeSettings = {
	url: `${SITE_URL}/auth/verify`
};

export const POST = async ({ request }) => {
	try {
		const { email } = await request.json();

		if (!email || typeof email !== 'string') {
			return json({ error: 'Email is required.' }, { status: 400 });
		}

		const link = await adminAuth.generateEmailVerificationLink(email, actionCodeSettings);
		return json({ status: 'sent', link });
	} catch (error) {
		console.error('[auth] send verification error', error);
		const message = error instanceof Error ? error.message : 'Unable to send verification email.';
		return json({ error: message }, { status: 500 });
	}
};
