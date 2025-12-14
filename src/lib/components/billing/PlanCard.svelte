<script lang="ts">
	import { type Plan } from '$lib/billing/plans';

	interface Props {
		plan: Plan;
		isCurrentPlan?: boolean;
		isRecommended?: boolean;
		loading?: boolean;
		disabled?: boolean;
		onSelect: (plan: Plan) => void;
	}

	let {
		plan,
		isCurrentPlan = false,
		isRecommended = false,
		loading = false,
		disabled = false,
		onSelect
	}: Props = $props();

	const buttonText = $derived.by(() => {
		if (isCurrentPlan && !plan.oneTime) return 'Current';
		if (loading) return 'Processing...';
		if (plan.oneTime) return 'Add Credits';
		if (plan.key === 'free') return 'Start free';
		return 'Subscribe';
	});

	const isHighlighted = isRecommended || plan.badge === 'recommended';
	const isAddon = plan.oneTime;
</script>

<article class="plan" class:plan--highlighted={isHighlighted} class:plan--current={isCurrentPlan} class:plan--addon={isAddon}>
	{#if isHighlighted}
		<div class="plan__ribbon">Recommended</div>
	{:else if isAddon}
		<div class="plan__ribbon plan__ribbon--addon">Credit Boost</div>
	{/if}

	<div class="plan__header">
		<h3 class="plan__name">{plan.name}</h3>
		{#if isCurrentPlan && !plan.oneTime}
			<span class="plan__current-badge">Current</span>
		{/if}
	</div>

	<div class="plan__price-row">
		<span class="plan__price">{plan.price}</span>
		<span class="plan__cadence">{isAddon ? 'one-time' : plan.cadence === 'forever' ? '/free' : `/${plan.cadence.replace('per ', '')}`}</span>
	</div>

	<p class="plan__attendance">{plan.estimatedAttendance}</p>

	{#if isAddon}
		<p class="plan__addon-note">Adds credits to your current plan. Never expires.</p>
	{/if}

	<ul class="plan__features">
		{#each plan.features as feature}
			<li class="plan__feature" class:plan__feature--addon={isAddon && feature.startsWith('+')}>
				{#if isAddon && feature.startsWith('+')}
					<svg class="plan__plus" viewBox="0 0 16 16" fill="none">
						<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
					</svg>
				{:else}
					<svg class="plan__check" viewBox="0 0 16 16" fill="none">
						<path d="M3 8l3.5 3.5L13 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				{/if}
				{feature}
			</li>
		{/each}
	</ul>

	<button
		type="button"
		class="plan__cta"
		class:plan__cta--primary={isHighlighted}
		class:plan__cta--addon={isAddon}
		class:plan__cta--disabled={disabled || loading || (isCurrentPlan && !plan.oneTime)}
		disabled={disabled || loading || (isCurrentPlan && !plan.oneTime)}
		onclick={() => onSelect(plan)}
	>
		{buttonText}
	</button>
</article>

<style>
	.plan {
		position: relative;
		display: flex;
		flex-direction: column;
		padding: 1.5rem;
		background: var(--color-bg-elevated, #fff);
		border: 1px solid var(--color-border, #e5e5e5);
		border-radius: 2px;
		transition: border-color 0.2s ease, box-shadow 0.2s ease;
	}

	.plan:hover {
		border-color: var(--color-border-strong, #ccc);
	}

	.plan--highlighted {
		border-color: var(--coral, #FF6F61);
		box-shadow: 0 0 0 1px var(--coral, #FF6F61);
	}

	.plan--highlighted:hover {
		border-color: var(--coral, #FF6F61);
	}

	.plan--current {
		background: var(--color-bg-subtle, #fafafa);
	}

	/* Ribbon */
	.plan__ribbon {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		padding: 0.375rem 0;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		text-align: center;
		color: white;
		background: var(--coral, #FF6F61);
	}

	.plan--highlighted {
		padding-top: 2.5rem;
	}

	/* Header */
	.plan__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.plan__name {
		margin: 0;
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.25rem;
		font-weight: 400;
		color: var(--color-text, #1a1a1a);
	}

	.plan__current-badge {
		padding: 0.125rem 0.5rem;
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-success, #059669);
		background: rgba(5, 150, 105, 0.1);
		border-radius: 2px;
	}

	/* Pricing */
	.plan__price-row {
		display: flex;
		align-items: baseline;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
	}

	.plan__price {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 2rem;
		font-weight: 400;
		line-height: 1;
		color: var(--color-text, #1a1a1a);
	}

	.plan__cadence {
		font-size: 0.75rem;
		color: var(--color-text-muted, #888);
	}

	.plan__attendance {
		margin: 0 0 1rem;
		font-size: 0.6875rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--coral, #FF6F61);
	}

	/* Features */
	.plan__features {
		flex: 1;
		margin: 0 0 1rem;
		padding: 0;
		list-style: none;
	}

	.plan__feature {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.375rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary, #4a4a4a);
	}

	.plan__feature:last-child {
		margin-bottom: 0;
	}

	.plan__check {
		flex-shrink: 0;
		width: 14px;
		height: 14px;
		color: var(--coral, #FF6F61);
	}

	/* CTA */
	.plan__cta {
		width: 100%;
		padding: 0.625rem 1rem;
		font-family: 'DM Sans', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text, #1a1a1a);
		background: transparent;
		border: 1.5px solid var(--color-text, #1a1a1a);
		border-radius: 0;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.plan__cta:hover:not(:disabled) {
		background: var(--color-text, #1a1a1a);
		color: white;
	}

	.plan__cta--primary {
		background: var(--coral, #FF6F61);
		color: white;
		border-color: var(--coral, #FF6F61);
	}

	.plan__cta--primary:hover:not(:disabled) {
		background: #e85d50;
		border-color: #e85d50;
	}

	.plan__cta--disabled,
	.plan__cta:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* Addon/Credit Boost styles */
	.plan--addon {
		background: linear-gradient(135deg, var(--color-bg-elevated, #fff) 0%, rgba(139, 92, 246, 0.05) 100%);
		border-color: rgba(139, 92, 246, 0.3);
		padding-top: 2.5rem;
	}

	.plan--addon:hover {
		border-color: rgba(139, 92, 246, 0.5);
	}

	.plan__ribbon--addon {
		background: linear-gradient(90deg, #8b5cf6 0%, #a78bfa 100%);
	}

	.plan__addon-note {
		margin: -0.5rem 0 1rem;
		padding: 0.5rem;
		font-size: 0.6875rem;
		color: #7c3aed;
		background: rgba(139, 92, 246, 0.1);
		border-radius: 2px;
		text-align: center;
	}

	.plan__plus {
		flex-shrink: 0;
		width: 14px;
		height: 14px;
		color: #8b5cf6;
	}

	.plan__feature--addon {
		color: #6d28d9;
		font-weight: 500;
	}

	.plan__cta--addon {
		background: linear-gradient(90deg, #8b5cf6 0%, #a78bfa 100%);
		color: white;
		border-color: #8b5cf6;
	}

	.plan__cta--addon:hover:not(:disabled) {
		background: linear-gradient(90deg, #7c3aed 0%, #8b5cf6 100%);
		border-color: #7c3aed;
	}
</style>
