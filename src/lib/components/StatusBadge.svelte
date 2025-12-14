<script lang="ts">
	type Status = 'confirmed' | 'collected' | 'not_collected' | 'pending' | 'error' | 'success' | 'warning' | 'info';

	interface Props {
		status: Status;
		label?: string;
		size?: 'sm' | 'md';
	}

	let { status, label, size = 'sm' }: Props = $props();

	const config: Record<Status, { defaultLabel: string; colorClass: string }> = {
		confirmed: {
			defaultLabel: 'Confirmed',
			colorClass: 'status-success'
		},
		collected: {
			defaultLabel: 'Collected',
			colorClass: 'status-info'
		},
		not_collected: {
			defaultLabel: 'Not Collected',
			colorClass: 'status-warning'
		},
		pending: {
			defaultLabel: 'Pending',
			colorClass: 'status-neutral'
		},
		error: {
			defaultLabel: 'Error',
			colorClass: 'status-error'
		},
		success: {
			defaultLabel: 'Success',
			colorClass: 'status-success'
		},
		warning: {
			defaultLabel: 'Warning',
			colorClass: 'status-warning'
		},
		info: {
			defaultLabel: 'Info',
			colorClass: 'status-info'
		}
	};

	const { defaultLabel, colorClass } = $derived(config[status]);
	const displayLabel = $derived(label ?? defaultLabel);
</script>

<span class="status-badge status-{size} {colorClass}">
	<span class="status-dot"></span>
	{displayLabel}
</span>

<style>
	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-weight: 500;
		letter-spacing: 0.02em;
		border-radius: 2px;
		white-space: nowrap;
	}

	.status-sm {
		padding: 0.1875rem 0.5rem;
		font-size: 0.6875rem;
	}

	.status-md {
		padding: 0.25rem 0.625rem;
		font-size: 0.75rem;
	}

	.status-dot {
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 1px;
		flex-shrink: 0;
	}

	/* Status colors - editorial minimal style */
	.status-success {
		background-color: rgba(16, 185, 129, 0.08);
		color: #047857;
	}

	.status-success .status-dot {
		background-color: #10b981;
	}

	.status-info {
		background-color: rgba(59, 130, 246, 0.08);
		color: #1d4ed8;
	}

	.status-info .status-dot {
		background-color: #3b82f6;
	}

	.status-warning {
		background-color: rgba(245, 158, 11, 0.08);
		color: #b45309;
	}

	.status-warning .status-dot {
		background-color: #f59e0b;
	}

	.status-error {
		background-color: rgba(239, 68, 68, 0.08);
		color: #b91c1c;
	}

	.status-error .status-dot {
		background-color: #ef4444;
	}

	.status-neutral {
		background-color: var(--color-bg-subtle);
		color: var(--color-text-secondary);
	}

	.status-neutral .status-dot {
		background-color: var(--color-text-muted);
	}

	/* Dark mode adjustments */
	[data-theme='dark'] .status-success {
		background-color: rgba(52, 211, 153, 0.12);
		color: #6ee7b7;
	}

	[data-theme='dark'] .status-info {
		background-color: rgba(96, 165, 250, 0.12);
		color: #93c5fd;
	}

	[data-theme='dark'] .status-warning {
		background-color: rgba(251, 191, 36, 0.12);
		color: #fcd34d;
	}

	[data-theme='dark'] .status-error {
		background-color: rgba(248, 113, 113, 0.12);
		color: #fca5a5;
	}
</style>
