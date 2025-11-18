<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { startCheckout } from '$lib/billing/checkout';

	type PlanKey = 'free' | 'starter' | 'growth' | 'event';

type Plan = {
		key: PlanKey;
		name: string;
		price: string;
		cadence: string;
		description: string;
		badge?: string;
		features: string[];
		estimatedAttendance: string;
		trialCopy?: string;
		oneTime?: boolean;
};

function formatCurrency(amount: number, currency: string) {
	return new Intl.NumberFormat(undefined, {
		style: 'currency',
		currency
	}).format(amount / 100);
}

function getFeatureColor(feature: string): string {
	const lower = feature.toLowerCase();
	if (lower.includes('influencer profile') || lower.includes('profile')) {
		return 'text-blue-500';
	}
	if (lower.includes('connected outreach inbox') || lower.includes('connected inbox')) {
		return 'text-purple-500';
	}
	if (lower.includes('outreach email') || lower.includes('email outreach') || lower.includes('email')) {
		return 'text-orange-500';
	}
	if (lower.includes('active campaign') || lower.includes('campaign')) {
		return 'text-green-500';
	}
	if (lower.includes('search')) {
		return 'text-pink-500';
	}
	if (lower.includes('csv') || lower.includes('export') || lower.includes('reporting')) {
		return 'text-indigo-500';
	}
	return 'text-gray-500';
}

const plans: Plan[] = [
	{
		key: 'free',
		name: 'Free Plan',
		price: '$0',
		cadence: 'forever',
		description: 'Perfect for trying out Penny with basic features.',
		estimatedAttendance: 'Great for testing',
		features: [
			'Access to 30 influencer profiles (one-time)',
			'Up to 30 influencer searches per month',
			'No email outreach capabilities'
		],
			oneTime: false
		},
		{
			key: 'starter',
			name: 'Starter Plan',
			price: '$99',
			cadence: 'per month after trial',
			description: 'Local businesses and pop-ups who need a fast boost of RSVPs.',
			badge: 'Includes free trial',
			estimatedAttendance: 'Estimated 10-60 attendees',
			trialCopy: '3-day free trial • 20 influencers • 10 emails • paywall on CSV export',
			features: [
				'Access to 300 influencer profiles per month',
				'1 connected outreach inbox',
				'Send up to 200 outreach emails per month',
				'1 active campaign at a time'
			],
			oneTime: false
		},
		{
			key: 'growth',
			name: 'Growth Plan',
			price: '$299',
			cadence: 'per month',
			description: 'Agencies and scaling brands managing several concurrent launches.',
			badge: 'Most popular',
			estimatedAttendance: 'Estimated 50-120 attendees',
			features: [
				'Access to 1,000 influencer profiles per month',
				'3 connected outreach inboxes',
				'Send up to 700 outreach emails per month',
				'3 active campaigns at once',
				'CSV export capabilities'
			],
			oneTime: false
		},
		{
			key: 'event',
		name: 'Event Special',
			price: '$999',
			cadence: 'one-time activation',
			description:
				'Festivals, launches, or venue takeovers that need instant reach and concierge help.',
			estimatedAttendance: 'Designed for 500-1,500 attendees / interest',
			features: [
				'Access to 5,000 influencer profiles (one-time)',
				'5 connected outreach inboxes',
				'Send up to 5,000 outreach messages',
				'Full CSV export + CRM sync included'
			],
			oneTime: true
		}
];

const planMap: Record<string, Plan> = plans.reduce<Record<string, Plan>>((acc, plan) => {
	acc[plan.key] = plan;
	return acc;
}, {} as Record<string, Plan>);

let { data } = $props();

let loadingPlan = $state<PlanKey | null>(null);
let checkoutError = $state<string | null>(null);
let checkoutSuccess = $state<string | null>(null);
let upgradeModalOpen = $state(false);
let upgradePreview = $state<{
	invoice: {
		amount_due: number;
		currency: string;
		amount_remaining: number | null;
		total: number | null;
		subtotal: number | null;
		invoice_pdf: string | null;
		lines: Array<{ description: string | null | undefined; amount: number; proration: boolean }>;
	};
	newPlan: PlanKey;
	currentPlan: string | null;
	changeType: 'upgrade' | 'downgrade' | 'switch';
	previewUnavailable?: boolean;
} | null>(null);
let upgradePlan = $state<Plan | null>(null);
let upgradeError = $state<string | null>(null);
let upgradeConfirming = $state(false);

const currentPlan = $derived(() => data.currentPlan ?? null);
const currentPlanKey = $derived(() => currentPlan()?.planKey ?? null);
const currentPlanStatus = $derived(() => currentPlan()?.status ?? null);
const trialEndsAt = $derived(() => formatTimestamp(currentPlan()?.trialEnd ?? null));
const renewsAt = $derived(() => formatTimestamp(currentPlan()?.currentPeriodEnd ?? null));
const hasSubscription = $derived(() => !!currentPlanKey() && currentPlanStatus() !== 'canceled');
const isStarterPlan = $derived(() => currentPlanKey() === 'starter');
const activePlan = $derived(() => {
	if (!hasSubscription()) return null;
	const key = currentPlanKey();
	return key ? planMap[key] ?? null : null;
});

const statusLabel = $derived(() => {
	switch (currentPlanStatus()) {
		case 'trialing':
			return 'Trialing';
		case 'active':
			return 'Active';
		case 'past_due':
			return 'Past due';
		case 'canceled':
			return 'Canceled';
		default:
			return currentPlanStatus() ?? null;
	}
});
const cancelAtPeriodEnd = $derived(() => currentPlan()?.cancelAtPeriodEnd ?? false);
const bannerMessage = $derived(() => {
	const status = currentPlanStatus();
	if (!status) return null;
	if (status === 'trialing') {
		if (cancelAtPeriodEnd()) {
			return trialEndsAt()
				? `Trial ends on ${trialEndsAt()} and will not renew.`
				: 'Trial will end without renewal.';
		}
		return trialEndsAt()
			? `Free trial active. Renews on ${trialEndsAt()}.`
			: 'Free trial active.';
	}
	if (status === 'active') {
		if (cancelAtPeriodEnd()) {
			return renewsAt()
				? `Cancellation scheduled. Access continues until ${renewsAt()}.`
				: 'Cancellation scheduled at the end of the current period.';
		}
		return renewsAt()
			? `Renews automatically on ${renewsAt()}.`
			: 'Subscription active.';
	}
	if (status === 'past_due') {
		return 'Payment overdue. Update your billing details to avoid interruption.';
	}
	if (status === 'canceled') {
		return 'Subscription canceled.';
	}
	return statusLabel() ?? null;
});

function formatTimestamp(seconds: number | null) {
	if (!seconds) return null;
	return new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	}).format(new Date(seconds * 1000));
}

function isCurrentPlan(plan: Plan) {
	if (plan.oneTime) return false;
	const status = currentPlanStatus();
	return currentPlanKey() === plan.key && status !== 'canceled';
}

async function handleCheckout(plan: Plan) {
	if (!plan.oneTime && isCurrentPlan(plan)) {
		return;
	}
	if (loadingPlan) return;

	// Free plan doesn't need Stripe checkout
	if (plan.key === 'free') {
		loadingPlan = plan.key;
		checkoutError = null;
		checkoutSuccess = null;
		try {
			const response = await fetch('/api/billing/set-free-plan', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				}
			});

			if (response.status === 401) {
				window.location.href = `/sign-in?redirectTo=${encodeURIComponent('/pricing')}`;
				return;
			}

			const payload = await response.json();
			if (!response.ok) {
				throw new Error(payload?.error ?? 'Unable to set free plan.');
			}

			checkoutSuccess = `Plan updated to ${plan.name}.`;
			await invalidateAll();
		} catch (error) {
			checkoutError = error instanceof Error ? error.message : 'Failed to set free plan. Please try again.';
		} finally {
			loadingPlan = null;
		}
		return;
	}

	if (!plan.oneTime && hasSubscription() && currentPlanKey() && currentPlanKey() !== plan.key) {
		const handled = await previewUpgradePlan(plan);
		if (handled) {
			return;
		}
	}

	loadingPlan = plan.key;
	checkoutError = null;
	checkoutSuccess = null;

	try {
		const result = await startCheckout({
			plan: plan.key,
			redirectTo: '/pricing',
			onUpdated: async () => {
				// This won't be called for pricing page since we handle it below
			},
			onError: (error) => {
				checkoutError = error;
		}
		});

		if (result.type === 'updated') {
			let successMessage = `Plan updated to ${plan.name}. Stripe will auto-prorate the difference.`;
			if (result.payload?.upcomingInvoice?.amount_due != null && result.payload?.upcomingInvoice?.currency) {
				const formatted = formatCurrency(result.payload.upcomingInvoice.amount_due, result.payload.upcomingInvoice.currency.toUpperCase());
				successMessage += ` Upcoming invoice: ${formatted}.`;
			}
			checkoutSuccess = successMessage;
			await invalidateAll();
			return;
		}

		if (result.type === 'redirect') {
			window.location.href = result.url;
		}
	} catch (error) {
		checkoutError = error instanceof Error ? error.message : 'Checkout failed. Please try again.';
	} finally {
		loadingPlan = null;
	}
}

async function previewUpgradePlan(plan: Plan) {
	upgradeError = null;
	upgradePlan = plan;
	loadingPlan = plan.key;
	try {
		const response = await fetch('/api/billing/upgrade', {
			method: 'POST',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify({ plan: plan.key })
		});

		if (response.status === 401) {
			window.location.href = `/sign-in?redirectTo=${encodeURIComponent('/pricing')}`;
			return true;
		}

		const payload = await response.json();

		if (payload?.requireCheckout) {
			upgradePlan = null;
			return false;
		}

		if (!response.ok) {
			throw new Error(payload?.error ?? 'Unable to preview upgrade.');
		}

		if (payload?.status === 'preview') {
			upgradePreview = {
				invoice: payload.invoice,
				newPlan: payload.newPlan,
				currentPlan: payload.currentPlan ?? null,
				changeType: payload.changeType ?? 'switch',
				previewUnavailable: payload.previewUnavailable ?? false
			};
			upgradeModalOpen = true;
			return true;
		}

		return false;
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unable to preview plan change.';
		upgradeError = message;
		checkoutError = message;
		return true;
	} finally {
		loadingPlan = null;
	}
}

async function confirmUpgradePlan() {
	if (!upgradePlan) return;
	upgradeError = null;
	upgradeConfirming = true;
	try {
		const response = await fetch('/api/billing/upgrade', {
			method: 'POST',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify({ plan: upgradePlan.key, confirm: true })
		});

		const payload = await response.json();

		if (!response.ok) {
			throw new Error(payload?.error ?? 'Unable to upgrade plan.');
		}

		if (payload?.status === 'updated') {
			const changeType: 'upgrade' | 'downgrade' | 'switch' = payload.changeType ?? 'switch';
			let successMessage = '';
			if (changeType === 'downgrade') {
				successMessage = `Plan change to ${upgradePlan.name} scheduled. Your current plan stays active until the next billing cycle.`;
				if (payload.invoice?.currency && payload.invoice?.total != null) {
					const formattedNext = formatCurrency(payload.invoice.total, payload.invoice.currency.toUpperCase());
					successMessage += ` Next invoice will be ${formattedNext}.`;
				}
			} else {
				successMessage = `Plan updated to ${upgradePlan.name}. Stripe has applied any prorated amount due immediately.`;
				if (payload.invoice?.amount_due != null && payload.invoice?.currency) {
					const formatted = formatCurrency(payload.invoice.amount_due, payload.invoice.currency.toUpperCase());
					successMessage += ` Invoice amount: ${formatted}.`;
				}
			}
			checkoutSuccess = successMessage;
			upgradeModalOpen = false;
			upgradePreview = null;
			upgradePlan = null;
			await invalidateAll();
			return;
		}

		throw new Error('Unexpected response from upgrade endpoint.');
	} catch (error) {
		upgradeError = error instanceof Error ? error.message : 'Unable to upgrade plan.';
	} finally {
		upgradeConfirming = false;
	}
}

function closeUpgradeModal() {
	upgradeModalOpen = false;
	upgradePreview = null;
	upgradePlan = null;
	upgradeError = null;
}
</script>

<main class="pt-16 bg-gray-50">
	<div class="max-w-7xl mx-auto px-6 py-16 space-y-12">
		<section class="text-center space-y-4 max-w-3xl mx-auto">
			<h1 class="text-4xl sm:text-5xl font-bold">Plans built for every launch</h1>
			<p class="text-lg text-gray-600">
				Whether you're testing a local pop-up or filling a 1,500-person launch, choose the plan that matches your outreach volume and reporting needs.
			</p>
			<div class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
				All plans include a 3-day trial with 20 curated influencers and 10 outreach emails. Cancel any time.
			</div>
		</section>

		{#if hasSubscription() && activePlan() && currentPlanKey() !== 'free'}
			<section class="mx-auto max-w-4xl rounded-3xl border border-sky-200 bg-sky-50 px-6 py-5 text-sm text-sky-800">
				<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<div class="space-y-1">
						<p class="font-semibold text-sky-900">
							You're on the {activePlan()?.name} ({statusLabel()}).
						</p>
						{#if bannerMessage()}
							<p>{bannerMessage()}</p>
						{/if}
					</div>
					<div class="flex gap-3">
						<Button variant="outline" href="/my-account">Manage billing</Button>
					</div>
				</div>
			</section>
		{/if}
		
		{#if checkoutSuccess}
			<div class="mx-auto max-w-2xl rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
				{checkoutSuccess}
			</div>
		{/if}

		{#if checkoutError}
			<div class="mx-auto max-w-2xl rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
				{checkoutError}
			</div>
		{/if}

		<section class="grid gap-6 md:grid-cols-3">
			{#each plans as plan}
				<article class={`relative flex h-full flex-col rounded-3xl border-2 p-8 bg-white ${plan.badge ? 'border-[#FF6F61]' : 'border-gray-200'}`}>
			{#if plan.badge}
				<div class="absolute -top-3 left-1/2 -translate-x-1/2">
					<span class="inline-flex items-center rounded-full bg-gray-900 px-4 py-1 text-xs font-medium text-white">
						{plan.badge}
					</span>
				</div>
			{/if}
			{#if isCurrentPlan(plan)}
				<div class="absolute top-4 right-4">
					<span class="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
						Current plan
					</span>
				</div>
			{:else if !plan.oneTime && plan.key === 'growth' && isStarterPlan()}
				<div class="absolute top-4 right-4">
					<span class="inline-flex items-center rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-600">
						Upgrade available
					</span>
				</div>
			{/if}
					<header class="mb-6 space-y-3">
						<h2 class="text-2xl font-bold text-gray-900">{plan.name}</h2>
						<div>
							<p class="text-3xl font-semibold text-gray-900">{plan.price}</p>
							<p class="text-xs uppercase tracking-wide text-gray-500">{plan.cadence}</p>
						</div>
						<p class="text-sm text-gray-500">{plan.description}</p>
						<p class="text-xs font-medium text-amber-600">{plan.estimatedAttendance}</p>
						{#if plan.trialCopy}
							<p class="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">
								{plan.trialCopy}
							</p>
						{/if}
					</header>

					<ul class="space-y-3 text-sm text-gray-700 flex-1">
						{#each plan.features as feature}
							<li class="flex items-start gap-2">
								<svg class={`mt-0.5 h-4 w-4 shrink-0 ${getFeatureColor(feature)}`} fill="currentColor" viewBox="0 0 20 20">
									<circle cx="10" cy="10" r="4" />
								</svg>
								<span>{feature}</span>
							</li>
						{/each}
					</ul>

			<Button
				class="w-full justify-center mt-8"
				variant={plan.oneTime ? 'outline' : plan.key === 'free' ? 'outline' : isCurrentPlan(plan) ? 'outline' : 'primary'}
				disabled={loadingPlan === plan.key || (!plan.oneTime && isCurrentPlan(plan))}
				onclick={() => handleCheckout(plan)}
			>
				{#if !plan.oneTime && isCurrentPlan(plan)}
					Current plan
				{:else if loadingPlan === plan.key}
					{plan.key === 'free' ? 'Setting up…' : 'Redirecting…'}
				{:else if plan.oneTime}
					Book event blast
				{:else if plan.key === 'free'}
					Get started free
				{:else if plan.key === 'growth' && isStarterPlan()}
					Upgrade to Growth
				{:else if plan.key === 'starter' && !hasSubscription()}
					Start free trial
				{:else}
					Choose plan
				{/if}
			</Button>
				</article>
			{/each}
		</section>

		<section class="rounded-3xl border border-gray-200 bg-white px-8 py-10 space-y-6">
			<h2 class="text-2xl font-semibold text-gray-900 text-center">Need help choosing?</h2>
			<p class="max-w-3xl mx-auto text-center text-gray-600">
				Grab time with our team to walk through the dashboard, map out recommended campaigns, and get a personalised creator list before you commit.
			</p>
			<div class="flex flex-wrap justify-center gap-3">
				<Button href="mailto:hello@penny.ai">Book a strategy call</Button>
				<Button variant="outline" href="/">Preview the product UI</Button>
			</div>
		</section>
	</div>
</main>

{#if upgradeModalOpen && upgradePreview && upgradePlan}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
		<div class="w-full max-w-xl rounded-3xl bg-white p-8 shadow-2xl">
			<div class="flex items-start justify-between gap-4">
				<div>
					<h2 class="text-xl font-semibold text-gray-900">Confirm plan change</h2>
					{#if upgradePreview.changeType === 'downgrade'}
						<p class="text-sm text-gray-500">
							You are scheduling a downgrade from {upgradePreview.currentPlan ?? 'current plan'} to {upgradePlan.name}. The change takes effect at the next billing date.
						</p>
					{:else}
						<p class="text-sm text-gray-500">
							You are upgrading from {upgradePreview.currentPlan ?? 'current plan'} to {upgradePlan.name}. Stripe will apply prorations immediately.
						</p>
					{/if}
					{#if upgradePreview.previewUnavailable}
						<p class="mt-2 text-xs font-medium text-amber-600">
							Stripe couldn’t generate a detailed preview right now. The amounts below are estimates; you’ll receive an email receipt once the change completes.
						</p>
					{/if}
				</div>
				<button class="text-gray-400 hover:text-gray-600" type="button" onclick={closeUpgradeModal} aria-label="Close upgrade dialog">
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="mt-6 space-y-4">
				<div class="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 space-y-1">
					{#if upgradePreview.changeType === 'downgrade'}
						<p><span class="text-gray-500">Due now:</span> {formatCurrency(upgradePreview.invoice.amount_due, upgradePreview.invoice.currency.toUpperCase())}</p>
						<p>
							<span class="text-gray-500">Next invoice:</span>
							{upgradePreview.invoice.total != null
								? formatCurrency(upgradePreview.invoice.total, upgradePreview.invoice.currency.toUpperCase())
								: 'Calculated at next renewal'}
						</p>
					{:else}
						<p><span class="text-gray-500">Amount due now:</span> {formatCurrency(upgradePreview.invoice.amount_due, upgradePreview.invoice.currency.toUpperCase())}</p>
						{#if upgradePreview.invoice.total != null}
							<p><span class="text-gray-500">Invoice total:</span> {formatCurrency(upgradePreview.invoice.total, upgradePreview.invoice.currency.toUpperCase())}</p>
						{/if}
						{#if upgradePreview.invoice.amount_remaining != null}
							<p><span class="text-gray-500">Amount remaining:</span> {formatCurrency(upgradePreview.invoice.amount_remaining, upgradePreview.invoice.currency.toUpperCase())}</p>
						{/if}
					{/if}
				</div>

				{#if !upgradePreview.previewUnavailable && upgradePreview.invoice.lines.length}
					<table class="w-full text-sm text-gray-700">
						<thead class="text-xs uppercase tracking-wide text-gray-500">
							<tr>
								<th class="py-2 text-left">Line item</th>
								<th class="py-2 text-right">Amount</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-gray-100">
							{#each upgradePreview.invoice.lines as line}
								<tr>
									<td class="py-2 pr-4 text-sm">
										{line.description ?? (line.proration ? 'Proration adjustment' : 'Subscription charge')}
									</td>
									<td class="py-2 text-right text-sm {line.amount < 0 ? 'text-emerald-600' : ''}">{formatCurrency(line.amount, upgradePreview.invoice.currency.toUpperCase())}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{:else}
					<p class="mt-4 text-sm text-gray-500">
						Line-item details will appear on the email receipt once the change completes.
					</p>
				{/if}

				{#if upgradeError}
					<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{upgradeError}</div>
				{/if}
			</div>

			<div class="mt-8 flex flex-wrap justify-end gap-3">
				<Button variant="outline" type="button" onclick={closeUpgradeModal} class="justify-center">
					Cancel
				</Button>
				<Button type="button" class="justify-center" onclick={confirmUpgradePlan} disabled={upgradeConfirming}>
					{upgradeConfirming
						? 'Updating…'
						: upgradePreview.changeType === 'downgrade'
						? `Schedule ${upgradePlan.name}`
						: `Confirm ${upgradePlan.name}`}
				</Button>
			</div>

			{#if upgradePreview.invoice.invoice_pdf}
				<p class="mt-4 text-xs text-gray-500">
					Preview full invoice:
					<a href={upgradePreview.invoice.invoice_pdf} target="_blank" rel="noreferrer" class="font-medium text-[#FF6F61]">Stripe PDF</a>
				</p>
			{/if}
		</div>
	</div>
{/if}
