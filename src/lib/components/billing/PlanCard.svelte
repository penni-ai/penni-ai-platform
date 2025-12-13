<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import { type Plan, getFeatureColor } from '$lib/billing/plans';

	interface Props {
		plan: Plan;
		isCurrentPlan?: boolean;
		isUpgradeAvailable?: boolean;
		loading?: boolean;
		disabled?: boolean;
		buttonText?: string;
		onSelect: (plan: Plan) => void;
		variant?: 'default' | 'compact';
	}

	let {
		plan,
		isCurrentPlan = false,
		isUpgradeAvailable = false,
		loading = false,
		disabled = false,
		buttonText,
		onSelect,
		variant = 'default'
	}: Props = $props();

	const defaultButtonText = $derived.by(() => {
		if (isCurrentPlan && !plan.oneTime) return 'Current plan';
		if (loading) return plan.key === 'free' ? 'Setting up…' : 'Redirecting…';
		if (plan.oneTime) return 'Book event blast';
		if (plan.key === 'free') return 'Get started free';
		if (plan.key === 'starter') return 'Start free trial';
		if (isUpgradeAvailable && plan.key === 'growth') return 'Upgrade to Growth';
		return 'Choose plan';
	});

	const buttonVariant = $derived.by(() => {
		if (plan.oneTime || plan.key === 'free' || isCurrentPlan) return 'outline';
		if (plan.badge) return 'primary';
		return 'primary';
	});

	const isCompact = variant === 'compact';
	const isMostPopular = plan.badge === 'Most popular';
</script>

<article
	class="relative flex h-full flex-col {isCompact ? 'p-6' : 'p-8'} transition-all duration-200"
	style="
		background-color: {isMostPopular ? 'var(--color-text)' : 'var(--color-bg-elevated)'};
		color: {isMostPopular ? 'var(--color-text-inverse)' : 'var(--color-text)'};
		border: 1.5px solid {plan.badge && !isMostPopular ? 'var(--color-primary)' : 'var(--color-border)'};
		border-radius: 1.5rem;
		font-family: 'DM Sans', sans-serif;
	"
	onmouseenter={(e) => {
		if (!isMostPopular) {
			e.currentTarget.style.transform = 'translateY(-4px)';
			e.currentTarget.style.boxShadow = '0 12px 24px -10px rgba(0,0,0,0.1)';
		}
	}}
	onmouseleave={(e) => {
		if (!isMostPopular) {
			e.currentTarget.style.transform = 'translateY(0)';
			e.currentTarget.style.boxShadow = 'none';
		}
	}}
>
	{#if plan.badge}
		<div class="absolute -top-3 left-1/2 -translate-x-1/2">
			<span
				class="inline-flex items-center rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wider"
				style="
					background-color: {isMostPopular ? 'var(--color-bg-elevated)' : 'var(--color-primary)'};
					color: {isMostPopular ? 'var(--color-text)' : 'var(--color-text-inverse)'};
					letter-spacing: 0.05em;
				"
			>
				{plan.badge}
			</span>
		</div>
	{/if}

	{#if isCurrentPlan && !plan.oneTime}
		<div class="absolute right-4 top-4">
			<span
				class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium"
				style="background-color: color-mix(in srgb, var(--color-success) 15%, transparent); color: var(--color-success);"
			>
				Current plan
			</span>
		</div>
	{:else if isUpgradeAvailable}
		<div class="absolute right-4 top-4">
			<span
				class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium"
				style="background-color: color-mix(in srgb, var(--color-info) 15%, transparent); color: var(--color-info);"
			>
				Upgrade available
			</span>
		</div>
	{/if}

	<header class="{isCompact ? 'mb-5 space-y-3' : 'mb-8 space-y-4'}">
		<h3
			class="{isCompact ? 'text-2xl' : 'text-3xl'} font-normal"
			style="font-family: 'Instrument Serif', serif;"
		>
			{plan.name}
		</h3>
		<div>
			<p
				class="{isCompact ? 'text-3xl' : 'text-4xl'} font-normal leading-none"
				style="font-family: 'Instrument Serif', serif;"
			>
				{plan.price}
			</p>
			<p
				class="mt-1 text-xs font-semibold uppercase tracking-wider"
				style="color: {isMostPopular ? 'rgba(255,255,255,0.7)' : 'var(--color-text-secondary)'}; letter-spacing: 0.1em;"
			>
				{plan.cadence}
			</p>
		</div>
		<p
			class="text-sm leading-relaxed"
			style="color: {isMostPopular ? 'rgba(255,255,255,0.9)' : 'var(--color-text-secondary)'};"
		>
			{plan.description}
		</p>
		{#if plan.estimatedAttendance}
			<p
				class="text-xs font-medium"
				style="color: {isMostPopular ? 'rgba(255,255,255,0.8)' : 'var(--color-primary)'};"
			>
				{plan.estimatedAttendance}
			</p>
		{/if}
		{#if plan.trialCopy}
			<p
				class="rounded-xl px-3 py-2 text-xs font-medium"
				style="background-color: {isMostPopular ? 'rgba(255,255,255,0.1)' : 'color-mix(in srgb, var(--color-error) 10%, transparent)'}; color: {isMostPopular ? 'rgba(255,255,255,0.9)' : 'var(--color-error)'}; border: 1px solid {isMostPopular ? 'rgba(255,255,255,0.2)' : 'color-mix(in srgb, var(--color-error) 30%, transparent)'};"
			>
				{plan.trialCopy}
			</p>
		{/if}
	</header>

	<ul class="mb-6 flex-1 space-y-3 text-sm">
		{#each plan.features as feature}
			<li class="flex items-start gap-3">
				<svg
					class="mt-0.5 h-1.5 w-1.5 shrink-0"
					fill="currentColor"
					viewBox="0 0 20 20"
					style="color: {isMostPopular ? 'rgba(255,255,255,0.6)' : 'var(--color-primary)'};"
				>
					<circle cx="10" cy="10" r="10" />
				</svg>
				<span style="color: {isMostPopular ? 'rgba(255,255,255,0.9)' : 'var(--color-text-secondary)'};">
					{feature}
				</span>
			</li>
		{/each}
	</ul>

	<Button
		class="w-full justify-center {isCompact ? '' : 'mt-2'}"
		variant={buttonVariant}
		disabled={disabled || loading || (isCurrentPlan && !plan.oneTime)}
		onclick={() => onSelect(plan)}
	>
		{buttonText ?? defaultButtonText}
	</Button>
</article>
