import { env as publicEnv } from '$env/dynamic/public';
import { ApiProblem, apiOk, assertSameOrigin, handleApiRoute, requireUser } from '$lib/server/api';
import { getOrCreateStripeCustomer, getStripeClient } from '$lib/server/stripe';

const resolveOrigin = (url: URL) => publicEnv.PUBLIC_SITE_URL?.trim() || `${url.protocol}//${url.host}`;

export const POST = handleApiRoute(async (event) => {
	const user = requireUser(event);
	assertSameOrigin(event);

	if (!user.email) {
		throw new ApiProblem({
			status: 400,
			code: 'USER_EMAIL_REQUIRED',
			message: 'A verified email is required before accessing billing.'
		});
	}

	const logger = event.locals.logger.child({ component: 'billing', action: 'create_portal_session' });

	try {
		const stripe = getStripeClient();
		const customer = await getOrCreateStripeCustomer(user.uid, user.email);
		const origin = resolveOrigin(event.url);
		const session = await stripe.billingPortal.sessions.create({
			customer: customer.id,
			return_url: `${origin}/my-account`
		});

		if (!session.url) {
			throw new ApiProblem({
				status: 502,
				code: 'STRIPE_PORTAL_URL_MISSING',
				message: 'Stripe did not return a billing portal URL.',
				hint: 'Retry in a few moments or manage billing directly in Stripe.'
			});
		}

		logger.info('Billing portal session created');
		return apiOk({ url: session.url });
	} catch (error) {
		if (error instanceof ApiProblem) {
			throw error;
		}
		logger.error('Failed to create billing portal session', { error });
		throw new ApiProblem({
			status: 502,
			code: 'STRIPE_PORTAL_FAILED',
			message: 'Unable to start a billing portal session with Stripe.',
			hint: 'Retry shortly. If the problem persists, contact support.',
			cause: error
		});
	}
}, { component: 'billing' });
