<script lang="ts">
import Button from '$lib/components/Button.svelte';

type SubscriptionInfo = {
	planKey?: string | null;
	status: string;
	currentPeriodEnd?: string | null;
	currentPeriodEndRaw?: number | null;
	trialEnd?: string | null;
	trialEndRaw?: number | null;
	cancelAtPeriodEnd?: boolean;
};

let { data } = $props();
const subscription = (data.subscription ?? null) as SubscriptionInfo | null;
let billingError = $state<string | null>(null);
let billingLoading = $state(false);

const subscriptionStatus = $derived(() => subscription?.status ?? null);
const cancelAtPeriodEnd = $derived(() => subscription?.cancelAtPeriodEnd ?? false);
const trialEndsAt = $derived(() => subscription?.trialEnd ?? null);
const renewsAt = $derived(() => subscription?.currentPeriodEnd ?? null);

const nextInvoiceLabel = $derived(() => {
	const targetDate = renewsAt() ?? trialEndsAt();
	if (!targetDate) return '—';
	return new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	}).format(new Date(targetDate));
});

const planName = $derived(() => {
	const key = subscription?.planKey ?? null;
	switch (key) {
		case 'starter':
			return 'Starter';
		case 'growth':
			return 'Growth';
		case 'event':
			return 'Event add-on';
		default:
			return key ?? 'Free';
	}
});

const subscriptionStatusLabel = $derived(() => {
	const status = subscriptionStatus();
	if (!status) return 'None';
	return status.replace(/_/g, ' ');
});

const subscriptionMessage = $derived(() => {
	const status = subscriptionStatus();
	const cancelScheduled = cancelAtPeriodEnd();
	if (!status) return null;
	const formatDate = (iso: string | null) =>
		iso
			? new Intl.DateTimeFormat(undefined, {
				month: 'short',
				day: 'numeric',
				year: 'numeric'
			}).format(new Date(iso))
			: null;
	switch (status) {
		case 'trialing':
			if (cancelScheduled) {
				return formatDate(trialEndsAt())
					? `Trial ends on ${formatDate(trialEndsAt())}. Subscription will not renew.`
					: 'Trial will end without renewal.';
			}
			return formatDate(trialEndsAt())
				? `Free trial active. Renews on ${formatDate(trialEndsAt())}.`
				: 'Free trial active.';
		case 'active':
			if (cancelScheduled) {
				return formatDate(renewsAt())
					? `Cancellation scheduled. Access continues until ${formatDate(renewsAt())}.`
					: 'Cancellation scheduled at the end of the current period.';
			}
			return formatDate(renewsAt())
				? `Renews automatically on ${formatDate(renewsAt())}.`
				: 'Subscription active.';
		case 'past_due':
			return 'Payment overdue. Update your billing details to avoid interruption.';
		case 'canceled':
			return 'Subscription canceled.';
		default:
			return status.replace('_', ' ');
	}
});

async function openBillingPortal() {
	if (billingLoading) return;
	billingError = null;
	billingLoading = true;
	try {
		const response = await fetch('/api/billing/portal', {
			method: 'POST'
		});

		if (response.status === 401) {
			window.location.href = `/sign-in?redirectTo=${encodeURIComponent('/my-account/billing')}`;
			return;
		}

		const payload = await response.json();
		if (!response.ok || !payload?.url) {
			throw new Error(payload?.error ?? 'Unable to open billing portal.');
		}

		window.location.href = payload.url;
	} catch (error) {
		billingError = error instanceof Error ? error.message : 'Unable to open billing portal right now.';
	} finally {
		billingLoading = false;
	}
}
</script>

<section class="flex flex-col gap-6">
	<div>
		<h2 class="text-base font-semibold text-gray-900 mb-4">Billing</h2>
		<div class="space-y-2 text-sm">
			<div class="flex items-center gap-2">
				<span class="text-gray-500 w-24">Plan:</span>
				<span class="text-gray-900 font-medium">{planName()}</span>
			</div>
			<div class="flex items-center gap-2">
				<span class="text-gray-500 w-24">Status:</span>
				<span class="text-gray-900 font-medium">{subscriptionStatusLabel()}</span>
			</div>
			<div class="flex items-center gap-2">
				<span class="text-gray-500 w-24">Next invoice:</span>
				<span class="text-gray-900">{nextInvoiceLabel()}</span>
			</div>
		</div>
		{#if subscriptionMessage()}
			<div class="mt-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
				{subscriptionMessage()}
			</div>
		{/if}
		<div class="flex gap-3 mt-6">
			<Button variant="outline" class="px-4 py-1.5 text-sm" href="/pricing">View plans</Button>
			<Button class="px-4 py-1.5 text-sm" onclick={openBillingPortal} disabled={billingLoading}>
				{billingLoading ? 'Opening…' : 'Manage billing'}
			</Button>
		</div>
		{#if billingError}
			<div class="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
				{billingError}
			</div>
		{/if}
	</div>
</section>

