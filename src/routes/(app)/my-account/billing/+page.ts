import type { PageLoad } from './$types';
import { invalidateAll } from '$app/navigation';
import { browser } from '$app/environment';

export const load: PageLoad = async ({ url, depends }) => {
	// Track dependency for manual invalidation
	depends('app:billing');

	const sessionId = url.searchParams.get('session_id');
	const checkoutSuccess = sessionId !== null;

	// If returning from Stripe checkout, trigger a revalidation
	// The webhook may still be processing, so we give it a moment
	if (browser && checkoutSuccess) {
		// Clean up the URL without the session_id
		const cleanUrl = new URL(url);
		cleanUrl.searchParams.delete('session_id');
		history.replaceState(null, '', cleanUrl.pathname);

		// Wait briefly for webhook to process, then revalidate
		setTimeout(() => {
			invalidateAll();
		}, 1500);
	}

	return {
		checkoutSuccess
	};
};
