<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import Button from './Button.svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		onUpgrade?: () => void;
		remaining?: number;
		requested?: number;
		limit?: number;
	}

	let { open, onClose, onUpgrade, remaining = 0, requested = 0, limit = 0 }: Props = $props();

	function handleUpgrade() {
		if (onUpgrade) {
			onUpgrade();
		}
		onClose();
	}
</script>

{#if open}
	<!-- Backdrop -->
	<div
		class="panel-backdrop"
		onclick={onClose}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
		role="button"
		tabindex="-1"
		aria-label="Close panel"
		transition:fade={{ duration: 150 }}
	>
		<!-- Panel -->
		<div
			class="panel"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && onClose()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			transition:fly={{ y: 12, duration: 200 }}
		>
			<!-- Header -->
			<div class="panel-header">
				<div class="header-content">
					<span class="header-label">Limit Reached</span>
					<h2 class="header-title">Search Limit Exceeded</h2>
					<p class="header-description">
						You've reached your monthly search limit.
					</p>
				</div>
				<button
					type="button"
					onclick={onClose}
					class="close-btn"
					aria-label="Close"
				>
					<svg class="close-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Content -->
			<div class="panel-content">
				<div class="stats-card">
					<div class="stat-row">
						<span class="stat-label">Searches remaining</span>
						<span class="stat-value">{remaining} <span class="stat-divider">/</span> {limit}</span>
					</div>
					<div class="stat-divider-line"></div>
					<div class="stat-row">
						<span class="stat-label">Searches requested</span>
						<span class="stat-value stat-value-accent">{requested}</span>
					</div>
				</div>

				<p class="content-text">
					You've used all <strong>{limit}</strong> searches available this month. Upgrade your plan to get more searches and continue finding influencers.
				</p>

				<!-- Actions -->
				<div class="actions">
					<button
						type="button"
						onclick={onClose}
						class="btn-secondary"
					>
						Close
					</button>
					<button
						type="button"
						onclick={handleUpgrade}
						class="btn-primary"
					>
						Upgrade Plan
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.panel-backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: var(--color-bg-overlay);
		padding: 1rem;
	}

	.panel {
		position: relative;
		width: 100%;
		max-width: 26rem;
		background-color: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		overflow: hidden;
	}

	.panel-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 1.5rem 1.5rem 1.25rem;
		border-bottom: 1px solid var(--color-border);
	}

	.header-content {
		flex: 1;
	}

	.header-label {
		display: inline-block;
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-primary);
		margin-bottom: 0.5rem;
	}

	.header-title {
		font-family: var(--font-display, 'Instrument Serif', Georgia, serif);
		font-size: 1.5rem;
		font-weight: 400;
		letter-spacing: -0.02em;
		color: var(--color-text);
		margin: 0 0 0.375rem 0;
		line-height: 1.2;
	}

	.header-description {
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-size: 0.875rem;
		color: var(--color-text-secondary);
		margin: 0;
		line-height: 1.5;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		margin: -0.25rem -0.25rem 0 0;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		border-radius: 2px;
		transition: all 0.15s ease;
	}

	.close-btn:hover {
		color: var(--color-text);
		background-color: var(--color-bg-subtle);
	}

	.close-icon {
		width: 1.25rem;
		height: 1.25rem;
	}

	.panel-content {
		padding: 1.5rem;
	}

	.stats-card {
		background-color: var(--color-bg-subtle);
		border: 1px solid var(--color-border);
		border-radius: 2px;
		padding: 1rem;
		margin-bottom: 1rem;
	}

	.stat-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.stat-label {
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.stat-value {
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}

	.stat-value-accent {
		color: var(--color-primary);
	}

	.stat-divider {
		color: var(--color-text-muted);
		font-weight: 400;
		margin: 0 0.125rem;
	}

	.stat-divider-line {
		height: 1px;
		background-color: var(--color-border);
		margin: 0.75rem 0;
	}

	.content-text {
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--color-text-secondary);
		margin: 0 0 1.5rem 0;
	}

	.content-text strong {
		font-weight: 600;
		color: var(--color-text);
	}

	.actions {
		display: flex;
		gap: 0.75rem;
	}

	.btn-secondary,
	.btn-primary {
		flex: 1;
		padding: 0.75rem 1rem;
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-size: 0.875rem;
		font-weight: 500;
		border-radius: 2px;
		cursor: pointer;
		transition: all 0.15s ease;
		text-align: center;
	}

	.btn-secondary {
		background-color: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.btn-secondary:hover {
		background-color: var(--color-bg-subtle);
		border-color: var(--color-border-strong);
	}

	.btn-primary {
		background-color: var(--color-primary);
		border: 1px solid var(--color-primary);
		color: var(--color-text-inverse);
	}

	.btn-primary:hover {
		background-color: var(--color-primary-hover);
		border-color: var(--color-primary-hover);
	}
</style>
