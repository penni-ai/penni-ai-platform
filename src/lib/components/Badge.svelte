<script lang="ts">
	interface Props {
		variant?: 'default' | 'coral' | 'muted';
		size?: 'sm' | 'md';
		children?: any;
	}

	let { variant = 'default', size = 'md', children }: Props = $props();
</script>

<span class="badge badge-{variant} badge-{size}">
	{@render children?.()}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		border-radius: 2px;
		white-space: nowrap;
	}

	/* Sizes */
	.badge-sm {
		padding: 0.1875rem 0.375rem;
		font-size: 0.625rem;
	}

	.badge-md {
		padding: 0.25rem 0.5rem;
		font-size: 0.6875rem;
	}

	/* Variants */
	.badge-default {
		background-color: var(--color-bg-subtle);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
	}

	.badge-coral {
		background-color: rgba(255, 111, 97, 0.1);
		color: var(--color-primary);
		border: 1px solid transparent;
	}

	.badge-muted {
		background-color: transparent;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
	}

	/* Dark mode adjustments */
	[data-theme="dark"] .badge-coral {
		background-color: rgba(255, 133, 119, 0.15);
	}
</style>
