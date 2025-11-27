<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { elasticOut } from 'svelte/easing';

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
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
		onclick={handleBackdropClick}
		onkeydown={(e) => e.key === 'Escape' && onCancel()}
		role="button"
		tabindex="-1"
		aria-label="Close popup"
		transition:fade={{ duration: 200 }}
	>
		<!-- Modal -->
		<div
			class="relative w-full max-w-xs overflow-hidden rounded-2xl bg-white shadow-2xl"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && onCancel()}
			role="dialog"
			aria-modal="true"
			aria-labelledby="find-more-title"
			tabindex="-1"
			transition:scale={{ duration: 300, start: 0.95, easing: elasticOut }}
		>
			<!-- Content -->
			<div class="px-6 pt-6 pb-5 text-center">
				<!-- Icon -->
				<div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#FFF1ED]">
					<svg class="h-6 w-6 text-[#FF6F61]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
					</svg>
				</div>
				
				<!-- Title -->
				<h3 id="find-more-title" class="text-lg font-semibold text-gray-900 mb-1">
					Find More Influencers
				</h3>
				<p class="text-sm text-gray-500 mb-5">
					You currently have {currentCount} influencer{currentCount !== 1 ? 's' : ''}. Remaining search slots: {maxRemaining}
				</p>
				
				<!-- Single slider -->
				<label for="additional-count-slider" class="block text-sm font-medium text-gray-700 mb-3 text-left">
					How many more to find?
				</label>
				<div class="space-y-2">
					<input
						id="additional-count-slider"
						type="range"
						min="1"
						max={Math.max(1, Math.floor(maxRemaining) || 1)}
						bind:value={additionalCount}
						disabled={maxRemaining <= 0}
						class="w-full accent-[#FF6F61]"
					/>
					<div class="flex items-center justify-between text-xs text-gray-600">
						<span>1</span>
						<span class="font-semibold text-gray-800">{additionalCount}</span>
						<span>{Math.max(1, Math.floor(maxRemaining) || 1)}</span>
					</div>
					{#if maxRemaining <= 0}
						<p class="text-xs text-red-600 text-center">No searches remaining. Upgrade to unlock more.</p>
					{/if}
				</div>
			</div>

			<!-- Footer -->
			<div class="border-t border-gray-100 bg-gray-50/50 px-6 py-4 flex gap-3">
				<button
					type="button"
					class="flex-1 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
					onclick={onCancel}
					disabled={isSearching}
				>
					Cancel
				</button>
				<button
					type="button"
					class="flex-1 py-2.5 bg-[#FF6F61] text-white font-semibold rounded-lg hover:bg-[#FF5A4A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
					onclick={handleConfirm}
					disabled={isSearching || additionalCount < 1 || maxRemaining <= 0}
				>
					{#if isSearching}
						<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
						</svg>
						Searching...
					{:else}
						Find +{additionalCount}
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
