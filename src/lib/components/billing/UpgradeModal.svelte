<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { invalidateAll } from '$app/navigation';
	import { startCheckout } from '$lib/billing/checkout';
	import { plans, paidPlans, type Plan, type PlanKey } from '$lib/billing/plans';
	import PlanCard from './PlanCard.svelte';

	interface Props {
		open: boolean;
		onClose?: () => void;
		/** Whether the modal can be dismissed (false for onboarding) */
		dismissible?: boolean;
		/** Whether to show the free plan option */
		showFreePlan?: boolean;
		/** Custom title */
		title?: string;
		/** Custom description */
		description?: string;
		/** URL to return to after checkout */
		returnUrl?: string;
		/** Show contact help section */
		showHelpSection?: boolean;
		/** Current user's plan key (for showing "Current plan" badge) */
		currentPlanKey?: PlanKey | null;
	}

	let {
		open,
		onClose,
		dismissible = true,
		showFreePlan = true,
		title = 'Choose Your Plan',
		description = 'Select a plan to get started with Penny.',
		returnUrl,
		showHelpSection = false,
		currentPlanKey = null
	}: Props = $props();

	let loadingPlan = $state<PlanKey | null>(null);
	let checkoutError = $state<string | null>(null);

	const displayPlans = $derived(showFreePlan ? plans : paidPlans);

	function handleClose() {
		if (dismissible && onClose) {
			onClose();
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (dismissible && e.target === e.currentTarget) {
			handleClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (dismissible && e.key === 'Escape') {
			handleClose();
		}
	}

	async function handleSelectPlan(plan: Plan) {
		if (loadingPlan) return;
		loadingPlan = plan.key;
		checkoutError = null;

		try {
			// Free plan doesn't need Stripe checkout
			if (plan.key === 'free') {
				const response = await fetch('/api/billing/set-free-plan', {
					method: 'POST',
					headers: { 'content-type': 'application/json' }
				});

				if (response.status === 401) {
					window.location.href = `/sign-in?redirectTo=${encodeURIComponent(returnUrl || '/dashboard')}`;
					return;
				}

				const payload = await response.json();
				if (!response.ok) {
					throw new Error(payload?.error ?? 'Unable to set free plan.');
				}

				await invalidateAll();
				onClose?.();
				return;
			}

			const result = await startCheckout({
				plan: plan.key,
				redirectTo: returnUrl || window.location.pathname,
				returnUrl: returnUrl || window.location.href,
				onUpdated: async () => {
					await invalidateAll();
					onClose?.();
				},
				onError: (error) => {
					checkoutError = error;
				}
			});

			if (result.type === 'redirect') {
				window.location.href = result.url;
			} else if (result.type === 'updated') {
				window.location.reload();
			}
		} catch (error) {
			checkoutError = error instanceof Error ? error.message : 'Checkout failed. Please try again.';
		} finally {
			loadingPlan = null;
		}
	}
</script>

{#if open}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 bg-black/60"
		transition:fade={{ duration: 200 }}
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
		role="presentation"
	></div>

	<!-- Panel -->
	<div
		class="fixed inset-y-0 right-0 z-50 w-full max-w-4xl bg-white shadow-2xl"
		transition:fly={{ x: 400, duration: 300 }}
		role="dialog"
		aria-modal="true"
		aria-labelledby="upgrade-modal-title"
	>
		<div class="flex h-full flex-col">
			<!-- Header -->
			<div class="border-b border-gray-200 bg-white px-8 py-6">
				<div class="flex items-center justify-between">
					<div>
						<h2 id="upgrade-modal-title" class="text-2xl font-semibold text-gray-900">
							{title}
						</h2>
						<p class="mt-1 text-sm text-gray-500">{description}</p>
					</div>
					{#if dismissible}
						<button
							type="button"
							onclick={handleClose}
							class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
							aria-label="Close"
						>
							<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M6 18L18 6M6 6l12 12"
								/>
							</svg>
						</button>
					{/if}
				</div>
			</div>

			<!-- Content -->
			<div class="flex-1 overflow-y-auto px-8 py-8">
				{#if checkoutError}
					<div
						class="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
					>
						{checkoutError}
					</div>
				{/if}

				<div class="grid gap-6 md:grid-cols-3">
					{#each displayPlans as plan}
						<PlanCard
							{plan}
							isCurrentPlan={currentPlanKey === plan.key}
							loading={loadingPlan === plan.key}
							disabled={loadingPlan !== null && loadingPlan !== plan.key}
							onSelect={handleSelectPlan}
							variant="compact"
						/>
					{/each}
				</div>

				{#if showHelpSection}
					<div
						class="mt-8 rounded-2xl border border-gray-200 bg-gray-50 px-6 py-4 text-center text-sm text-gray-600"
					>
						<p>
							Need help choosing? <a
								href="mailto:hello@penny.ai"
								class="font-medium text-[#FF6F61]">Contact us</a
							> for personalized recommendations.
						</p>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
