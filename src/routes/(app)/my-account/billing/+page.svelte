<script lang="ts">
import { upgradeModal } from '$lib/stores/upgrade';
import { planMap, getPlanLimits, type PlanKey } from '$lib/billing/plans';
import { invalidateAll } from '$app/navigation';

type SubscriptionInfo = {
	planKey?: string | null;
	status: string;
	currentPeriodEnd?: string | null;
	currentPeriodEndRaw?: number | null;
	trialEnd?: string | null;
	trialEndRaw?: number | null;
	cancelAtPeriodEnd?: boolean;
	cancelAt?: number | null;
	scheduledPlanChange?: string | null;
	changeAt?: number | null;
	downgradeTo?: string | null;
};

type EventCreditsInfo = {
	influencersRemaining?: number;
	outreachRemaining?: number;
	additionalInboxes?: number;
};

let { data } = $props();

// Show syncing state when returning from checkout
let isSyncing = $state(data.checkoutSuccess ?? false);

// Clear syncing state after data refreshes
$effect(() => {
	if (isSyncing && data.subscription) {
		// Data has been refreshed
		setTimeout(() => {
			isSyncing = false;
		}, 500);
	}
});

const subscription = $derived((data.subscription ?? null) as SubscriptionInfo | null);
const eventCredits = $derived((data.eventCredits ?? null) as EventCreditsInfo | null);
let billingError = $state<string | null>(null);
let billingLoading = $state(false);
let cancelLoading = $state(false);
let reactivateLoading = $state(false);

const subscriptionStatus = $derived(() => subscription?.status ?? null);
const cancelAtPeriodEnd = $derived(() => subscription?.cancelAtPeriodEnd ?? false);
const trialEndsAt = $derived(() => subscription?.trialEnd ?? null);
const renewsAt = $derived(() => subscription?.currentPeriodEnd ?? null);
const scheduledPlanChange = $derived(() => subscription?.scheduledPlanChange ?? subscription?.downgradeTo ?? null);
const changeAt = $derived(() => subscription?.changeAt ?? subscription?.cancelAt ?? null);
const hasEventCredits = $derived(() =>
	(eventCredits?.influencersRemaining ?? 0) > 0 || (eventCredits?.outreachRemaining ?? 0) > 0
);

// Get current plan details
const currentPlanKey = $derived(() => (subscription?.planKey ?? 'free') as PlanKey);
const planDetails = $derived(() => planMap[currentPlanKey()] ?? planMap['free']);
const planLimits = $derived(() => getPlanLimits(currentPlanKey()));
const isFreePlan = $derived(() => !subscription?.planKey || subscription.planKey === 'free');

const nextInvoiceLabel = $derived(() => {
	const targetDate = renewsAt() ?? trialEndsAt();
	if (!targetDate) return null;
	return new Intl.DateTimeFormat(undefined, {
		month: 'long',
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
			return 'Event';
		default:
			return 'Free';
	}
});

const subscriptionStatusLabel = $derived(() => {
	const status = subscriptionStatus();
	if (!status) return 'Active';
	return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
});

const formatDate = (value: string | number | null) => {
	if (!value) return null;
	const date = typeof value === 'number' ? new Date(value) : new Date(value);
	return new Intl.DateTimeFormat(undefined, {
		month: 'long',
		day: 'numeric',
		year: 'numeric'
	}).format(date);
};

const subscriptionMessage = $derived(() => {
	const status = subscriptionStatus();
	const cancelScheduled = cancelAtPeriodEnd();
	const planChange = scheduledPlanChange();
	const changeDate = changeAt();

	// Handle scheduled plan change (downgrade)
	if (planChange && changeDate) {
		const planName = planChange.charAt(0).toUpperCase() + planChange.slice(1);
		return `Your plan will change to ${planName} on ${formatDate(changeDate)}. You can continue using your current plan until then.`;
	}

	if (!status) return null;

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
			return null;
		case 'past_due':
			return 'Payment overdue. Update your billing details to avoid interruption.';
		case 'canceled':
			return 'Subscription canceled.';
		default:
			return null;
	}
});

async function cancelSubscription() {
	if (cancelLoading) return;
	cancelLoading = true;
	billingError = null;

	try {
		const response = await fetch('/api/billing/set-free-plan', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ immediate: false })
		});

		if (!response.ok) {
			const payload = await response.json();
			throw new Error(payload?.error ?? 'Unable to cancel subscription.');
		}

		await invalidateAll();
	} catch (error) {
		billingError = error instanceof Error ? error.message : 'Unable to cancel subscription.';
	} finally {
		cancelLoading = false;
	}
}

async function reactivateSubscription() {
	if (reactivateLoading) return;
	reactivateLoading = true;
	billingError = null;

	try {
		const response = await fetch('/api/billing/cancel', {
			method: 'DELETE'
		});

		if (!response.ok) {
			const payload = await response.json();
			throw new Error(payload?.error ?? 'Unable to reactivate subscription.');
		}

		await invalidateAll();
	} catch (error) {
		billingError = error instanceof Error ? error.message : 'Unable to reactivate subscription.';
	} finally {
		reactivateLoading = false;
	}
}

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

<div class="billing-page">
	<!-- Syncing Indicator -->
	{#if isSyncing}
		<div class="sync-banner">
			<svg class="sync-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
			</svg>
			<span>Syncing your subscription...</span>
		</div>
	{/if}

	<!-- Page Header -->
	<header class="page-header">
		<div class="header-content">
			<h1 class="page-title">Billing & Subscription</h1>
			<p class="page-subtitle">Manage your plan, usage, and payment details</p>
		</div>
	</header>

	<!-- Main Content Grid -->
	<div class="billing-grid">
		<!-- Left Column -->
		<div class="billing-column">
			<!-- Current Plan Card -->
			<section class="settings-card plan-card">
				<div class="card-header">
					<div class="card-icon">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
						</svg>
					</div>
					<div>
						<h2 class="card-title">Current Plan</h2>
						<p class="card-description">Your subscription details</p>
					</div>
				</div>

				<div class="card-content">
					<div class="plan-display">
						<div class="plan-info">
							<h3 class="plan-name">{planName()}</h3>
							<div class="plan-pricing">
								<span class="plan-price">{planDetails()?.price ?? '$0'}</span>
								<span class="plan-cadence">/{planDetails()?.cadence ?? 'month'}</span>
							</div>
						</div>
						<div class="plan-status">
							<span class="status-badge" class:status-active={subscriptionStatus() === 'active' || subscriptionStatus() === 'trialing'} class:status-warning={subscriptionStatus() === 'past_due'} class:status-canceled={subscriptionStatus() === 'canceled'}>
								<span class="status-dot"></span>
								{subscriptionStatusLabel()}
							</span>
							{#if nextInvoiceLabel() && !cancelAtPeriodEnd()}
								<span class="next-billing">Renews {nextInvoiceLabel()}</span>
							{/if}
						</div>
					</div>

					{#if subscriptionMessage()}
						<div class="plan-message" class:warning={subscriptionStatus() === 'past_due'}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
							</svg>
							<span>{subscriptionMessage()}</span>
						</div>
					{/if}

					<div class="card-actions">
						{#if isFreePlan()}
							<button
								type="button"
								class="btn btn-primary"
								onclick={() => upgradeModal.open('Upgrade your plan', 'Unlock more influencer searches, outreach emails, and connected inboxes.')}
							>
								Upgrade Plan
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M5 12h14M12 5l7 7-7 7"/>
								</svg>
							</button>
						{:else}
							<button
								type="button"
								class="btn btn-secondary"
								onclick={() => upgradeModal.open('Change Plan', 'Switch to a different plan that better fits your needs.')}
							>
								Change Plan
							</button>
							{#if cancelAtPeriodEnd() || scheduledPlanChange()}
								<button
									type="button"
									class="btn btn-ghost"
									onclick={reactivateSubscription}
									disabled={reactivateLoading}
								>
									{reactivateLoading ? 'Reactivating...' : 'Keep Current Plan'}
								</button>
							{:else}
								<button
									type="button"
									class="btn btn-ghost btn-danger"
									onclick={cancelSubscription}
									disabled={cancelLoading}
								>
									{cancelLoading ? 'Canceling...' : 'Cancel Subscription'}
								</button>
							{/if}
						{/if}
						<button
							type="button"
							class="btn btn-ghost"
							onclick={openBillingPortal}
							disabled={billingLoading}
						>
							{billingLoading ? 'Opening...' : 'Manage Billing'}
						</button>
					</div>

					{#if billingError}
						<div class="alert alert-error">{billingError}</div>
					{/if}
				</div>
			</section>

			<!-- Plan Features -->
			<section class="settings-card">
				<div class="card-header">
					<div class="card-icon">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
						</svg>
					</div>
					<div>
						<h2 class="card-title">Plan Features</h2>
						<p class="card-description">What's included in {planName()}</p>
					</div>
				</div>

				<div class="card-content">
					<div class="features-list">
						{#each planDetails()?.features ?? [] as feature}
							<div class="feature-row">
								<svg class="feature-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
								</svg>
								<span class="feature-text">{feature}</span>
							</div>
						{/each}
					</div>

					<div class="card-actions">
						<button
							type="button"
							class="btn btn-ghost"
							onclick={() => upgradeModal.open('Compare Plans', 'See all available plans and features.')}
						>
							View all plans
						</button>
					</div>
				</div>
			</section>
		</div>

		<!-- Right Column -->
		<div class="billing-column">
			<!-- Usage Stats -->
			<section class="settings-card">
				<div class="card-header">
					<div class="card-icon">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
						</svg>
					</div>
					<div>
						<h2 class="card-title">Monthly Usage</h2>
						<p class="card-description">Current billing period</p>
					</div>
				</div>

				<div class="card-content">
					<div class="usage-stats">
						<div class="usage-stat">
							<div class="stat-header">
								<span class="stat-label">Influencer Profiles</span>
								<span class="stat-value">0 <span class="stat-limit">/ {planLimits().influencerProfiles.toLocaleString()}</span></span>
							</div>
							<div class="stat-bar">
								<div class="stat-fill" style="width: 0%"></div>
							</div>
						</div>

						<div class="usage-stat">
							<div class="stat-header">
								<span class="stat-label">Outreach Emails</span>
								<span class="stat-value">0 <span class="stat-limit">/ {planLimits().outreachEmails.toLocaleString()}</span></span>
							</div>
							<div class="stat-bar">
								<div class="stat-fill" style="width: 0%"></div>
							</div>
						</div>

						<div class="usage-stat">
							<div class="stat-header">
								<span class="stat-label">Connected Inboxes</span>
								<span class="stat-value">0 <span class="stat-limit">/ {planLimits().connectedInboxes}</span></span>
							</div>
							<div class="stat-bar">
								<div class="stat-fill" style="width: 0%"></div>
							</div>
						</div>
					</div>

					<p class="usage-note">Usage resets at the start of each billing cycle.</p>
				</div>
			</section>

			<!-- Event Credits -->
			{#if hasEventCredits()}
				<section class="settings-card credits-card">
					<div class="card-header">
						<div class="card-icon card-icon--purple">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
							</svg>
						</div>
						<div>
							<h2 class="card-title">Event Boost Credits</h2>
							<p class="card-description">One-time credits that never expire</p>
						</div>
					</div>

					<div class="card-content">
						<div class="credits-grid">
							<div class="credit-item">
								<span class="credit-value">{eventCredits?.influencersRemaining?.toLocaleString() ?? 0}</span>
								<span class="credit-label">Influencer Credits</span>
							</div>
							<div class="credit-item">
								<span class="credit-value">{eventCredits?.outreachRemaining?.toLocaleString() ?? 0}</span>
								<span class="credit-label">Outreach Credits</span>
							</div>
							{#if (eventCredits?.additionalInboxes ?? 0) > 0}
								<div class="credit-item">
									<span class="credit-value">+{eventCredits?.additionalInboxes}</span>
									<span class="credit-label">Extra Inboxes</span>
								</div>
							{/if}
						</div>

						<p class="credits-note">
							These credits are used after your monthly subscription limits are reached.
						</p>

						<div class="card-actions">
							<button
								type="button"
								class="btn btn-ghost btn-purple"
								onclick={() => upgradeModal.open('Add More Credits', 'Boost your capacity with additional one-time credits.')}
							>
								Buy More Credits
							</button>
						</div>
					</div>
				</section>
			{/if}

			<!-- Billing History -->
			<section class="settings-card">
				<div class="card-header">
					<div class="card-icon">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
						</svg>
					</div>
					<div>
						<h2 class="card-title">Billing History</h2>
						<p class="card-description">Past invoices and payments</p>
					</div>
				</div>

				<div class="card-content">
					<div class="empty-state">
						<svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
						</svg>
						<p class="empty-title">No billing history yet</p>
						<p class="empty-description">Your invoices and payment history will appear here.</p>
					</div>
				</div>
			</section>

			<!-- Payment Method -->
			<section class="settings-card">
				<div class="card-header">
					<div class="card-icon">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
						</svg>
					</div>
					<div>
						<h2 class="card-title">Payment Method</h2>
						<p class="card-description">Manage your payment details</p>
					</div>
				</div>

				<div class="card-content">
					<div class="payment-placeholder">
						<p class="payment-text">Manage your payment methods through the billing portal.</p>
					</div>

					<div class="card-actions">
						<button
							type="button"
							class="btn btn-secondary"
							onclick={openBillingPortal}
							disabled={billingLoading}
						>
							{billingLoading ? 'Opening...' : 'Update Payment Method'}
						</button>
					</div>
				</div>
			</section>
		</div>
	</div>
</div>

<style>
	.billing-page {
		--coral: #FF6F61;
		--coral-dark: #e85d50;
		--ink: var(--color-text, #1a1a1a);
		--ink-light: var(--color-text-secondary, #4a4a4a);
		--ink-muted: var(--color-text-muted, #8a8a8a);
		--paper: var(--color-bg, #fafaf9);
		--paper-elevated: var(--color-bg-elevated, #ffffff);
		--border: var(--color-border, #e8e6e3);
		--success: #059669;
		--error: #dc2626;
		--warning: #d97706;

		font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
	}

	/* Page Header */
	.page-header {
		margin-bottom: 2rem;
	}

	.header-content {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.page-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 2.5rem;
		font-weight: 400;
		color: var(--ink);
		line-height: 1.1;
		margin: 0;
	}

	.page-subtitle {
		font-size: 1rem;
		color: var(--ink-muted);
		margin: 0;
	}

	/* Billing Grid */
	.billing-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.5rem;
		align-items: start;
	}

	.billing-column {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	/* Settings Card */
	.settings-card {
		background: var(--paper-elevated);
		border: 1px solid var(--border);
		border-radius: 12px;
		overflow: hidden;
	}

	.card-header {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid var(--border);
	}

	.card-icon {
		width: 40px;
		height: 40px;
		background: var(--paper);
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.card-icon svg {
		width: 20px;
		height: 20px;
		color: var(--ink-muted);
	}

	.card-header > div:not(.card-icon) {
		flex: 1;
		min-width: 0;
	}

	.card-title {
		font-size: 1rem;
		font-weight: 600;
		color: var(--ink);
		margin: 0 0 0.25rem 0;
	}

	.card-description {
		font-size: 0.875rem;
		color: var(--ink-muted);
		margin: 0;
	}

	.card-content {
		padding: 1.5rem;
	}

	.card-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 1.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--border);
	}

	/* Plan Display */
	.plan-display {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1.5rem;
	}

	.plan-info {
		flex: 1;
	}

	.plan-name {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 2rem;
		font-weight: 400;
		color: var(--ink);
		line-height: 1.1;
		margin: 0 0 0.5rem 0;
	}

	.plan-pricing {
		display: flex;
		align-items: baseline;
		gap: 0.25rem;
	}

	.plan-price {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.75rem;
		color: var(--ink);
	}

	.plan-cadence {
		font-size: 1rem;
		color: var(--ink-muted);
	}

	.plan-status {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.5rem;
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem;
		font-size: 0.8125rem;
		font-weight: 500;
		border-radius: 20px;
		background: var(--paper);
		color: var(--ink-light);
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--ink-muted);
	}

	.status-badge.status-active {
		background: #ecfdf5;
		color: #166534;
	}

	.status-badge.status-active .status-dot {
		background: #10b981;
	}

	.status-badge.status-warning {
		background: #fffbeb;
		color: #92400e;
	}

	.status-badge.status-warning .status-dot {
		background: #f59e0b;
	}

	.status-badge.status-canceled {
		background: #fef2f2;
		color: #991b1b;
	}

	.status-badge.status-canceled .status-dot {
		background: #ef4444;
	}

	.next-billing {
		font-size: 0.8125rem;
		color: var(--ink-muted);
	}

	.plan-message {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		margin-top: 1.25rem;
		padding: 1rem;
		background: var(--paper);
		border-radius: 8px;
		font-size: 0.875rem;
		color: var(--ink-light);
		line-height: 1.5;
	}

	.plan-message svg {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
		color: var(--ink-muted);
		margin-top: 0.125rem;
	}

	.plan-message.warning {
		background: #fffbeb;
		color: var(--warning);
	}

	.plan-message.warning svg {
		color: var(--warning);
	}

	/* Features List */
	.features-list {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.feature-row {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}

	.feature-check {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
		color: var(--coral);
		margin-top: 0.125rem;
	}

	.feature-text {
		font-size: 0.9375rem;
		color: var(--ink-light);
		line-height: 1.5;
	}

	/* Usage Stats */
	.usage-stats {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.usage-stat {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.stat-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.stat-label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--ink-light);
	}

	.stat-value {
		font-size: 1rem;
		font-weight: 600;
		color: var(--ink);
	}

	.stat-limit {
		font-weight: 400;
		color: var(--ink-muted);
	}

	.stat-bar {
		height: 6px;
		background: var(--border);
		border-radius: 3px;
		overflow: hidden;
	}

	.stat-fill {
		height: 100%;
		background: var(--coral);
		border-radius: 3px;
		transition: width 0.3s ease;
	}

	.usage-note {
		margin: 1.5rem 0 0 0;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
		font-size: 0.8125rem;
		color: var(--ink-muted);
		font-style: italic;
	}

	/* Empty State */
	.empty-state {
		text-align: center;
		padding: 1.5rem 0;
	}

	.empty-icon {
		width: 40px;
		height: 40px;
		color: var(--ink-muted);
		opacity: 0.5;
		margin: 0 auto 1rem;
	}

	.empty-title {
		font-size: 0.9375rem;
		font-weight: 500;
		color: var(--ink-light);
		margin: 0 0 0.25rem 0;
	}

	.empty-description {
		font-size: 0.8125rem;
		color: var(--ink-muted);
		margin: 0;
	}

	/* Payment */
	.payment-placeholder {
		padding: 0.5rem 0;
	}

	.payment-text {
		font-size: 0.9375rem;
		color: var(--ink-light);
		margin: 0;
	}

	/* Buttons */
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		font-family: inherit;
		text-decoration: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn svg {
		width: 16px;
		height: 16px;
	}

	.btn-primary {
		background: var(--coral);
		color: white;
		border: none;
	}

	.btn-primary:hover:not(:disabled) {
		background: var(--coral-dark);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-secondary {
		background: var(--paper);
		color: var(--ink);
		border: 1px solid var(--border);
	}

	.btn-secondary:hover:not(:disabled) {
		border-color: var(--ink-muted);
	}

	.btn-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-ghost {
		background: none;
		color: var(--ink-light);
		border: none;
		padding: 0.75rem 1rem;
	}

	.btn-ghost:hover:not(:disabled) {
		color: var(--coral);
	}

	.btn-ghost:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-ghost.btn-danger {
		color: var(--error);
	}

	.btn-ghost.btn-danger:hover:not(:disabled) {
		color: #b91c1c;
	}

	.btn-ghost.btn-purple {
		color: #7c3aed;
	}

	.btn-ghost.btn-purple:hover:not(:disabled) {
		color: #6d28d9;
	}

	/* Credits Card */
	.credits-card {
		background: linear-gradient(135deg, var(--paper-elevated) 0%, rgba(139, 92, 246, 0.05) 100%);
		border-color: rgba(139, 92, 246, 0.2);
	}

	.card-icon--purple {
		background: rgba(139, 92, 246, 0.1);
	}

	.card-icon--purple svg {
		color: #8b5cf6;
	}

	.credits-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 1rem;
	}

	.credit-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 1rem;
		background: var(--paper-elevated);
		border-radius: 8px;
		border: 1px solid rgba(139, 92, 246, 0.2);
	}

	.credit-value {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 2rem;
		font-weight: 400;
		color: #7c3aed;
		line-height: 1;
	}

	.credit-label {
		font-size: 0.75rem;
		color: var(--ink-muted);
		margin-top: 0.5rem;
		text-align: center;
	}

	.credits-note {
		margin: 1rem 0 0;
		font-size: 0.8125rem;
		color: var(--ink-muted);
		text-align: center;
	}

	/* Alerts */
	.alert {
		padding: 0.875rem 1rem;
		font-size: 0.875rem;
		line-height: 1.5;
		border-radius: 8px;
		margin-top: 1rem;
	}

	.alert-error {
		background: #fef2f2;
		color: var(--error);
		border: 1px solid #fecaca;
	}

	/* Responsive */
	@media (max-width: 900px) {
		.billing-grid {
			grid-template-columns: 1fr;
		}

		.page-title {
			font-size: 2rem;
		}
	}

	@media (max-width: 640px) {
		.page-title {
			font-size: 1.75rem;
		}

		.plan-display {
			flex-direction: column;
			gap: 1rem;
		}

		.plan-status {
			align-items: flex-start;
		}

		.card-header {
			padding: 1rem 1.25rem;
		}

		.card-content {
			padding: 1.25rem;
		}

		.card-actions {
			flex-direction: column;
			align-items: stretch;
		}

		.btn {
			width: 100%;
		}
	}

	/* Sync Banner */
	.sync-banner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		background: #ecfdf5;
		border: 1px solid #a7f3d0;
		border-radius: 8px;
		margin-bottom: 1.5rem;
		font-size: 0.875rem;
		color: #166534;
	}

	.sync-icon {
		width: 18px;
		height: 18px;
		animation: spin 1.5s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(0deg); }
		to { transform: rotate(360deg); }
	}
</style>
