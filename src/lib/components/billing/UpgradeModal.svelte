<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { invalidateAll } from '$app/navigation';
	import { startCheckout } from '$lib/billing/checkout';
	import { plans, paidPlans, type Plan, type PlanKey } from '$lib/billing/plans';
	import PlanCard from './PlanCard.svelte';

	interface Props {
		open: boolean;
		onClose?: () => void;
		dismissible?: boolean;
		showFreePlan?: boolean;
		title?: string;
		description?: string;
		returnUrl?: string;
		currentPlanKey?: PlanKey | null;
	}

	let {
		open,
		onClose,
		dismissible = true,
		showFreePlan = true,
		title = 'Choose your plan',
		description = 'Scale your influencer outreach with the right plan for your needs.',
		returnUrl,
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

<svelte:window on:keydown={handleKeydown} />

{#if open}
	<!-- Backdrop -->
	<div
		class="backdrop"
		transition:fade={{ duration: 200 }}
		onclick={handleBackdropClick}
		role="presentation"
	></div>

	<!-- Modal -->
	<div
		class="modal"
		transition:scale={{ duration: 250, start: 0.95, easing: cubicOut }}
		role="dialog"
		aria-modal="true"
		aria-labelledby="upgrade-title"
	>
		<!-- Close button -->
		{#if dismissible}
			<button type="button" class="close-btn" onclick={handleClose} aria-label="Close">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
					<path d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		{/if}

		<!-- Header -->
		<header class="header">
			<h2 id="upgrade-title" class="title">{title}</h2>
			<p class="subtitle">{description}</p>
		</header>

		<!-- Error -->
		{#if checkoutError}
			<div class="error" transition:fade={{ duration: 150 }}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="10"/>
					<line x1="12" y1="8" x2="12" y2="12"/>
					<line x1="12" y1="16" x2="12.01" y2="16"/>
				</svg>
				{checkoutError}
			</div>
		{/if}

		<!-- Plans Grid -->
		<div class="plans">
			{#each displayPlans as plan}
				<PlanCard
					{plan}
					isCurrentPlan={currentPlanKey === plan.key}
					loading={loadingPlan === plan.key}
					disabled={loadingPlan !== null && loadingPlan !== plan.key}
					onSelect={handleSelectPlan}
				/>
			{/each}
		</div>

		<!-- Footer -->
		<footer class="footer">
			<p>All plans include access to our AI-powered influencer discovery. Questions? <a href="mailto:hello@usepenny.com">Contact us</a></p>
		</footer>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
	}

	.modal {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 101;
		width: calc(100vw - 3rem);
		max-width: 1100px;
		max-height: calc(100vh - 3rem);
		background: var(--color-bg, #fafaf9);
		border: 1px solid var(--color-border, #e5e5e5);
		box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.close-btn {
		position: absolute;
		top: 1rem;
		right: 1rem;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		color: var(--color-text-muted, #888);
		background: none;
		border: none;
		cursor: pointer;
		transition: color 0.15s ease;
	}

	.close-btn:hover {
		color: var(--color-text, #1a1a1a);
	}

	/* Header */
	.header {
		padding: 2rem 2.5rem 1.5rem;
		text-align: center;
		border-bottom: 1px solid var(--color-border, #e5e5e5);
		background: var(--color-bg-elevated, #fff);
	}

	.title {
		margin: 0 0 0.5rem;
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 2rem;
		font-weight: 400;
		line-height: 1.1;
		color: var(--color-text, #1a1a1a);
	}

	.subtitle {
		margin: 0;
		font-size: 0.9375rem;
		color: var(--color-text-secondary, #4a4a4a);
	}

	/* Error */
	.error {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		margin: 1rem 2rem 0;
		padding: 0.75rem 1rem;
		font-size: 0.8125rem;
		color: #dc2626;
		background: #fef2f2;
		border: 1px solid #fecaca;
	}

	/* Plans Grid */
	.plans {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
		padding: 1.5rem 2rem;
		flex: 1;
		min-height: 0;
	}

	/* Footer */
	.footer {
		padding: 1rem 2rem;
		text-align: center;
		border-top: 1px solid var(--color-border, #e5e5e5);
		background: var(--color-bg-elevated, #fff);
	}

	.footer p {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-text-muted, #888);
	}

	.footer a {
		color: var(--coral, #FF6F61);
		text-decoration: none;
		font-weight: 500;
	}

	.footer a:hover {
		text-decoration: underline;
	}

	/* Responsive */
	@media (max-width: 900px) {
		.plans {
			grid-template-columns: repeat(2, 1fr);
		}

		.modal {
			max-height: calc(100vh - 2rem);
			overflow-y: auto;
		}
	}

	@media (max-width: 600px) {
		.modal {
			width: calc(100vw - 1.5rem);
			max-height: calc(100vh - 1.5rem);
		}

		.plans {
			grid-template-columns: 1fr;
			gap: 0.75rem;
		}

		.header {
			padding: 1.5rem 1.5rem 1rem;
		}

		.title {
			font-size: 1.5rem;
		}

		.plans {
			padding: 1rem 1.25rem;
		}

		.footer {
			padding: 0.75rem 1.25rem;
		}
	}
</style>
