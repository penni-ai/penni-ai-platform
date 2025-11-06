import { json } from '@sveltejs/kit';
import { getOrCreateStripeCustomer, getStripeClient } from '$lib/server/stripe';
import { PUBLIC_SITE_URL } from '$env/static/public';

const resolveOrigin = (url: URL) => PUBLIC_SITE_URL?.trim() || `${url.protocol}//${url.host}`;

export const POST = async ({ locals, url }) => {
	const { user } = locals;

	if (!user?.uid || !user.email) {
		return json({ error: 'You must be signed in to manage billing.' }, { status: 401 });
	}

	try {
		const stripe = getStripeClient();
		const customer = await getOrCreateStripeCustomer(user.uid, user.email);
		const origin = resolveOrigin(url);
		const session = await stripe.billingPortal.sessions.create({
			customer: customer.id,
			return_url: `${origin}/my-account`
		});

		if (!session.url) {
			return json({ error: 'Unable to start billing portal session.' }, { status: 500 });
		}

		return json({ url: session.url });
	} catch (error) {
		console.error('[stripe] billing portal session error', error);
		const message = error instanceof Error ? error.message : 'Unable to open billing portal.';
		return json({ error: message }, { status: 500 });
	}
};
