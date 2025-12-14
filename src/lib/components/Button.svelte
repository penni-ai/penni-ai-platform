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

	const baseStyles = 'font-medium inline-block text-center transition-all';

	const variantStyles = {
		primary: '',
		secondary: '',
		outline: ''
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
			disabled ? 'opacity-50 pointer-events-none' : '',
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
	/* Primary variant */
	:global(.variant-primary) {
		background-color: var(--color-primary);
		color: white;
	}

	:global(.variant-primary:hover:not(:disabled)) {
		opacity: 0.9;
	}

	:global(.variant-primary:active:not(:disabled)) {
		opacity: 0.95;
	}

	/* Secondary variant */
	:global(.variant-secondary) {
		background-color: var(--color-text);
		color: white;
	}

	:global(.variant-secondary:hover:not(:disabled)) {
		opacity: 0.9;
	}

	:global(.variant-secondary:active:not(:disabled)) {
		opacity: 0.95;
	}

	/* Outline variant */
	:global(.variant-outline) {
		border-bottom: 1px solid var(--color-text);
		color: var(--color-text);
		background-color: transparent;
	}

	:global(.variant-outline:hover:not(:disabled)) {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	:global(.variant-outline:active:not(:disabled)) {
		opacity: 0.8;
	}
</style>
