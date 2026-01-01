<script lang="ts">
	import { fade, fly } from 'svelte/transition';

	interface Props {
		open: boolean;
		currentCount: number;
		maxRemaining: number;
		isSearching?: boolean;
		onConfirm: (count: number) => void;
		onCancel: () => void;
	}

	let {
		open,
		currentCount,
		maxRemaining,
		isSearching = false,
		onConfirm,
		onCancel
	}: Props = $props();

	// Slider default: use remaining or fallback to 1
	let additionalCount = $state(1);

	$effect(() => {
		const capped = Math.max(0, Math.floor(maxRemaining));
		if (capped === 0) {
			additionalCount = 0;
		} else if (additionalCount < 1 || additionalCount > capped) {
			additionalCount = Math.min(Math.max(additionalCount || 1, 1), capped);
		}
	});

	function handleConfirm() {
		if (additionalCount > 0) {
			onConfirm(additionalCount);
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onCancel();
		}
	}
</script>

{#if open}
	<div
		class="popup-overlay"
		onclick={handleBackdropClick}
		onkeydown={(e) => e.key === 'Escape' && onCancel()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="find-more-title"
		tabindex="-1"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="popup-content"
			transition:fly={{ y: 20, duration: 300 }}
		>
			<h3 id="find-more-title" class="popup-title">Find More Influencers</h3>
			<p class="popup-description">
				You currently have {currentCount} influencer{currentCount !== 1 ? 's' : ''}.
				Remaining search slots: <span class="highlight">{maxRemaining}</span>
			</p>

			<div class="slider-section">
				<label for="additional-count-slider" class="slider-label">
					How many more to find?
				</label>
				<div class="slider-container">
					<input
						id="additional-count-slider"
						type="range"
						min="1"
						max={Math.max(1, Math.floor(maxRemaining) || 1)}
						bind:value={additionalCount}
						disabled={maxRemaining <= 0}
						class="slider"
					/>
					<div class="slider-values">
						<span class="slider-min">1</span>
						<span class="slider-current">{additionalCount}</span>
						<span class="slider-max">{Math.max(1, Math.floor(maxRemaining) || 1)}</span>
					</div>
				</div>
				{#if maxRemaining <= 0}
					<p class="warning-text">No searches remaining. Upgrade to unlock more.</p>
				{/if}
			</div>

			<div class="popup-footer">
				<button
					type="button"
					class="cancel-btn"
					onclick={onCancel}
					disabled={isSearching}
				>
					Cancel
				</button>
				<button
					type="button"
					class="confirm-btn"
					onclick={handleConfirm}
					disabled={isSearching || additionalCount < 1 || maxRemaining <= 0}
				>
					{#if isSearching}
						<span class="spinner"></span>
						Searching...
					{:else}
						Find +{additionalCount}
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.popup-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 9999;
		padding: 24px;
	}

	.popup-content {
		background: var(--color-bg-elevated);
		border-radius: 0;
		box-shadow: 0 24px 80px rgba(0, 0, 0, 0.2);
		max-width: 400px;
		width: 100%;
		padding: 40px;
	}

	.popup-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 24px;
		font-weight: 400;
		color: var(--color-text);
		margin: 0 0 12px 0;
		letter-spacing: -0.01em;
	}

	.popup-description {
		font-size: 14px;
		color: var(--color-text-secondary);
		margin: 0 0 32px 0;
		line-height: 1.5;
	}

	.highlight {
		color: #FF6F61;
		font-weight: 600;
	}

	.slider-section {
		margin-bottom: 32px;
	}

	.slider-label {
		display: block;
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text);
		margin-bottom: 16px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.slider-container {
		padding: 0;
	}

	.slider {
		width: 100%;
		height: 2px;
		background: var(--color-border);
		outline: none;
		appearance: none;
		cursor: pointer;
	}

	.slider::-webkit-slider-thumb {
		appearance: none;
		width: 20px;
		height: 20px;
		background: #FF6F61;
		cursor: pointer;
		border: none;
		margin-top: -9px;
	}

	.slider::-moz-range-thumb {
		width: 20px;
		height: 20px;
		background: #FF6F61;
		cursor: pointer;
		border: none;
	}

	.slider::-webkit-slider-runnable-track {
		height: 2px;
		background: var(--color-border);
	}

	.slider::-moz-range-track {
		height: 2px;
		background: var(--color-border);
	}

	.slider:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.slider-values {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 12px;
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.slider-current {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 24px;
		color: #FF6F61;
	}

	.warning-text {
		font-size: 13px;
		color: #dc2626;
		margin: 16px 0 0 0;
		padding-left: 12px;
		border-left: 2px solid #dc2626;
	}

	.popup-footer {
		display: flex;
		gap: 16px;
		padding-top: 24px;
		border-top: 1px solid var(--color-border);
	}

	.cancel-btn {
		flex: 1;
		padding: 14px 24px;
		font-size: 14px;
		font-weight: 500;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: color 0.2s;
	}

	.cancel-btn:hover:not(:disabled) {
		color: var(--color-text);
	}

	.cancel-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.confirm-btn {
		flex: 1;
		padding: 14px 24px;
		font-size: 14px;
		font-weight: 500;
		letter-spacing: 0.02em;
		border: none;
		background: #FF6F61;
		color: white;
		cursor: pointer;
		transition: background 0.2s;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
	}

	.confirm-btn:hover:not(:disabled) {
		background: #E85A4F;
	}

	.confirm-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
