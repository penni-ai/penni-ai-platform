<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import Button from './Button.svelte';
	import { startCheckout } from '$lib/billing/checkout';

	type PlanKey = 'starter' | 'growth' | 'event';

	type Plan = {
		key: PlanKey;
		name: string;
		price: string;
		cadence: string;
		description: string;
		badge?: string;
		features: string[];
	};

	interface Props {
		open: boolean;
		onClose: () => void;
		returnUrl?: string;
		title?: string;
		description?: string;
	}

	let { 
		open, 
		onClose, 
		returnUrl,
		title = "Upgrade to Send Outreach",
		description = "Outreach capabilities are not available on the free plan. Choose a plan below to start sending outreach messages."
	}: Props = $props();

	const paidPlans: Plan[] = [
		{
			key: 'starter',
			name: 'Starter Plan',
			price: '$99',
			cadence: 'per month',
			description: 'Averages 30 influencer deals for your event. Local businesses and pop-ups who need a fast boost of RSVPs.',
			features: [
				'Access to 300 influencer profiles per month',
				'1 connected outreach inbox',
				'Send up to 20 emails per day (200 per month)',
				'1 active campaign at a time'
			]
		},
		{
			key: 'growth',
			name: 'Growth Plan',
			price: '$299',
			cadence: 'per month',
			description: 'Averages 100 influencer deals for your event. Agencies and scaling brands managing several concurrent launches.',
			badge: 'Most popular',
			features: [
				'Access to 1,000 influencer profiles per month',
				'3 connected outreach inboxes',
				'Send up to 60 emails per day (700 per month)',
				'3 active campaigns at once',
				'CSV export capabilities'
			]
		},
		{
			key: 'event',
			name: 'Event Special',
			price: '$999',
			cadence: 'one-time activation',
			description: 'Averages 500 influencer deals for your event. Festivals, launches, or venue takeovers that need instant reach and concierge help.',
			features: [
				'Access to 5,000 influencer profiles (one-time)',
				'5 connected outreach inboxes',
				'Send up to 5,000 outreach messages',
				'Full CSV export + CRM sync included'
			]
		}
	];

	let loadingPlan = $state<PlanKey | null>(null);
	let checkoutError = $state<string | null>(null);

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
		if (lower.includes('csv') || lower.includes('export') || lower.includes('reporting')) {
			return 'text-indigo-500';
		}
		return 'text-gray-500';
	}

	async function handleCheckout(plan: Plan) {
		if (loadingPlan) return;

		loadingPlan = plan.key;
		checkoutError = null;

		const result = await startCheckout({
			plan: plan.key,
			redirectTo: window.location.pathname,
			returnUrl: returnUrl || window.location.href,
			onUpdated: async () => {
				onClose();
				window.location.reload();
			},
			onError: (error) => {
				checkoutError = error;
			}
		});

			loadingPlan = null;

		if (result.type === 'redirect') {
			window.location.href = result.url;
		}
	}
</script>

{#if open}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-[10%] py-[5%]"
		onclick={onClose}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
		role="button"
		tabindex="-1"
		aria-label="Close panel"
		transition:fade={{ duration: 200 }}
	>
	<!-- Panel -->
	<div
			class="relative h-full w-full bg-white shadow-2xl rounded-2xl overflow-hidden"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && onClose()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			transition:fly={{ y: 20, duration: 300 }}
	>
		<!-- Header -->
		<div class="border-b border-gray-200 px-8 py-6">
			<div class="flex items-center justify-between">
				<div>
					<h2 class="text-2xl font-semibold text-gray-900">{title}</h2>
					<p class="mt-1 text-sm text-gray-600">
						{description}
					</p>
				</div>
				<button
					type="button"
					onclick={onClose}
					class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
					aria-label="Close"
				>
					<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
		</div>

		<!-- Content -->
		<div class="overflow-y-auto px-8 py-6" style="max-height: calc(100% - 120px)">
			{#if checkoutError}
				<div class="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
					{checkoutError}
				</div>
			{/if}

			<div class="grid gap-6 md:grid-cols-3">
				{#each paidPlans as plan}
					<article
						class={`relative flex h-full flex-col rounded-2xl border-2 p-6 bg-white ${
							plan.badge ? 'border-[#FF6F61]' : 'border-gray-200'
						}`}
					>
						{#if plan.badge}
							<div class="absolute -top-3 left-1/2 -translate-x-1/2">
								<span
									class="inline-flex items-center rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white"
								>
									{plan.badge}
								</span>
							</div>
						{/if}

						<header class="mb-4 space-y-2">
							<h3 class="text-xl font-bold text-gray-900">{plan.name}</h3>
							<div>
								<p class="text-2xl font-semibold text-gray-900">{plan.price}</p>
								<p class="text-xs uppercase tracking-wide text-gray-500">{plan.cadence}</p>
							</div>
							<p class="text-sm text-gray-500">{plan.description}</p>
						</header>

						<ul class="mb-6 space-y-2 text-sm text-gray-700 flex-1">
							{#each plan.features as feature}
								<li class="flex items-start gap-2">
									<svg
										class={`mt-0.5 h-4 w-4 shrink-0 ${getFeatureColor(feature)}`}
										fill="currentColor"
										viewBox="0 0 20 20"
									>
										<circle cx="10" cy="10" r="4" />
									</svg>
									<span>{feature}</span>
								</li>
							{/each}
						</ul>

						<Button
							class="w-full justify-center"
							variant={plan.key === 'growth' ? 'primary' : 'outline'}
							disabled={loadingPlan === plan.key}
							onclick={() => handleCheckout(plan)}
						>
							{#if loadingPlan === plan.key}
								Redirecting…
							{:else if plan.key === 'event'}
								Book event blast
							{:else}
								Choose plan
							{/if}
						</Button>
					</article>
				{/each}
			</div>
			</div>
		</div>
	</div>
{/if}

