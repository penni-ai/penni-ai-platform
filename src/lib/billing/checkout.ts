import { invalidateAll } from '$app/navigation';

export type CheckoutResult =
	| { type: 'redirect'; url: string }
	| { type: 'updated'; payload?: any; reload?: boolean; onClose?: () => void }
	| { type: 'error'; message: string };

export interface CheckoutOptions {
	plan: string;
	redirectTo?: string;
	returnUrl?: string;
	onUpdated?: () => void | Promise<void>;
	onError?: (error: string) => void;
}

/**
 * Shared checkout function used by SubscriptionPanel, Pricing page, and OutreachUpgradePanel
 * Handles the checkout flow with Stripe
 */
export async function startCheckout(options: CheckoutOptions): Promise<CheckoutResult> {
	const { plan, redirectTo, returnUrl, onUpdated, onError } = options;

	try {
		const requestBody: { plan: string; returnUrl?: string } = { plan };
		if (returnUrl) {
			requestBody.returnUrl = returnUrl;
		}

		const response = await fetch('/api/billing/checkout', {
			method: 'POST',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify(requestBody)
		});

		if (response.status === 401) {
			const redirectPath = redirectTo || window.location.pathname;
			window.location.href = `/sign-in?redirectTo=${encodeURIComponent(redirectPath)}`;
			return { type: 'error', message: 'Unauthorized' };
		}

		const payload = await response.json();
		if (!response.ok) {
			const errorMessage = payload?.error ?? 'Unable to start checkout.';
			onError?.(errorMessage);
			return { type: 'error', message: errorMessage };
		}

		// Plan was updated without checkout (e.g., direct subscription update)
		if (payload?.status === 'updated') {
			await invalidateAll();
			await onUpdated?.();
			return { type: 'updated', payload, reload: false };
		}

		if (!payload?.url) {
			const errorMessage = 'Checkout URL missing from response.';
			onError?.(errorMessage);
			return { type: 'error', message: errorMessage };
		}

		// Redirect to Stripe checkout
		return { type: 'redirect', url: payload.url };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Checkout failed. Please try again.';
		onError?.(errorMessage);
		return { type: 'error', message: errorMessage };
	}
}

