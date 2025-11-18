<script lang="ts">
	import { fade } from 'svelte/transition';
import Button from './Button.svelte';
import { fly } from 'svelte/transition';
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

	interface Props {
		open: boolean;
	}

	let { open }: Props = $props();

	let loadingPlan = $state<PlanKey | null>(null);
	let checkoutError = $state<string | null>(null);

	async function handleCheckout(plan: Plan) {
		if (loadingPlan) return;
		loadingPlan = plan.key;
		checkoutError = null;

		try {
			// Free plan doesn't need Stripe checkout
			if (plan.key === 'free') {
				const response = await fetch('/api/billing/set-free-plan', {
					method: 'POST',
					headers: {
						'content-type': 'application/json'
					}
				});

				if (response.status === 401) {
					window.location.href = `/sign-in?redirectTo=${encodeURIComponent('/dashboard')}`;
					return;
				}

				const payload = await response.json();
				if (!response.ok) {
					throw new Error(payload?.error ?? 'Unable to set free plan.');
				}

				await invalidateAll();
				return;
			}

			const result = await startCheckout({
				plan: plan.key,
				redirectTo: '/dashboard',
				onUpdated: async () => {
					await invalidateAll();
				},
				onError: (error) => {
					checkoutError = error;
			}
			});

			if (result.type === 'redirect') {
				window.location.href = result.url;
			}
		} catch (error) {
			checkoutError = error instanceof Error ? error.message : 'Checkout failed. Please try again.';
		} finally {
			loadingPlan = null;
		}
	}
</script>

{#if open}
	<!-- Backdrop (non-clickable, prevents interaction with content behind) -->
	<div
		class="fixed inset-0 z-50 bg-black/60"
		transition:fade={{ duration: 200 }}
		role="presentation"
	></div>

	<!-- Panel (non-dismissible - user must choose a plan) -->
	<div
		class="fixed inset-y-0 right-0 z-50 w-full max-w-4xl bg-white shadow-2xl"
		transition:fly={{ x: 400, duration: 300 }}
		role="dialog"
		aria-modal="true"
		aria-labelledby="subscription-panel-title"
	>
		<div class="flex h-full flex-col">
			<!-- Header -->
			<div class="border-b border-gray-200 bg-white px-8 py-6">
				<div class="flex items-center justify-between">
					<div>
						<h2 id="subscription-panel-title" class="text-2xl font-semibold text-gray-900">Choose Your Plan</h2>
						<p class="mt-1 text-sm text-gray-500">
							Select a plan to get started with Penny. All plans include a free trial.
						</p>
					</div>
				</div>
			</div>

			<!-- Content -->
			<div class="flex-1 overflow-y-auto px-8 py-8">
				{#if checkoutError}
					<div class="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
						{checkoutError}
					</div>
				{/if}

				<div class="grid gap-6 md:grid-cols-3">
					{#each plans as plan}
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

							<header class="mb-6 space-y-3">
								<h3 class="text-xl font-bold text-gray-900">{plan.name}</h3>
								<div>
									<p class="text-2xl font-semibold text-gray-900">{plan.price}</p>
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

							<ul class="space-y-2 text-sm text-gray-700 flex-1 mb-6">
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
								variant={plan.oneTime ? 'outline' : plan.key === 'free' ? 'outline' : 'primary'}
								disabled={loadingPlan === plan.key}
								onclick={() => handleCheckout(plan)}
							>
								{#if loadingPlan === plan.key}
									{plan.key === 'free' ? 'Setting up…' : 'Redirecting…'}
								{:else if plan.oneTime}
									Book event blast
								{:else if plan.key === 'free'}
									Get started free
								{:else if plan.key === 'starter'}
									Start free trial
								{:else}
									Choose plan
								{/if}
							</Button>
						</article>
					{/each}
				</div>

				<div class="mt-8 rounded-2xl border border-gray-200 bg-gray-50 px-6 py-4 text-center text-sm text-gray-600">
					<p>
						Need help choosing? <a href="mailto:hello@penny.ai" class="font-medium text-[#FF6F61]">Contact us</a> for
						personalized recommendations.
					</p>
				</div>
			</div>
		</div>
	</div>
{/if}
