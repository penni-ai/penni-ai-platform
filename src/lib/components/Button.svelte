<script lang="ts">
interface Props {
	variant?: 'primary' | 'secondary' | 'outline';
	size?: 'sm' | 'md' | 'lg';
	href?: string;
	onclick?: () => void;
	type?: 'button' | 'submit' | 'reset';
	class?: string;
	children?: any;
	disabled?: boolean;
	fullWidth?: boolean;
}

	let {
		variant = 'primary',
		size = 'md',
		href,
		onclick,
		type = 'button',
	class: className = '',
	children,
	disabled = false,
	fullWidth = false
}: Props = $props();

	const baseStyles = 'font-medium rounded-full transition-all duration-200 inline-block text-center';

	const variantStyles = {
		primary: 'shadow-sm',
		secondary: '',
		outline: 'border-2'
	};

	const sizeStyles = {
		sm: 'px-4 py-2 text-sm',
		md: 'px-6 py-3 text-base',
		lg: 'px-8 py-4 text-lg'
	};

	const widthStyles = fullWidth ? 'w-full justify-center inline-flex' : '';

	const classes = $derived(
		[
			baseStyles,
			variantStyles[variant],
			sizeStyles[size],
			widthStyles,
			disabled ? 'opacity-60 pointer-events-none' : '',
			`variant-${variant}`,
			className
		]
			.filter(Boolean)
			.join(' ')
	);
</script>

{#if href}
	<a
		{href}
		class={classes}
		role="button"
		aria-disabled={disabled ? 'true' : undefined}
		tabindex={disabled ? -1 : undefined}
	>
		{@render children?.()}
	</a>
{:else}
	<button {onclick} class={classes} type={type} disabled={disabled}>
		{@render children?.()}
	</button>
{/if}

<style>
	/* Primary variant - using CSS variables */
	:global(.variant-primary) {
		background-color: var(--color-primary);
		color: var(--color-text-inverse);
	}

	:global(.variant-primary:hover:not(:disabled)) {
		background-color: var(--color-primary-hover);
	}

	/* Secondary variant - using CSS variables */
	:global(.variant-secondary) {
		background-color: var(--color-text);
		color: var(--color-text-inverse);
	}

	:global(.variant-secondary:hover:not(:disabled)) {
		background-color: var(--color-text-secondary, #374151);
	}

	/* Outline variant - using CSS variables */
	:global(.variant-outline) {
		border-color: var(--color-text);
		color: var(--color-text);
		background-color: transparent;
	}

	:global(.variant-outline:hover:not(:disabled)) {
		background-color: var(--color-text);
		color: var(--color-text-inverse);
	}
</style>
