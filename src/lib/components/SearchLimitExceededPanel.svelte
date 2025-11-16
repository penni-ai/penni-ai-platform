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
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
		onclick={onClose}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
		role="button"
		tabindex="-1"
		aria-label="Close panel"
		transition:fade={{ duration: 200 }}
	>
		<!-- Panel -->
		<div
			class="relative w-full max-w-md bg-white shadow-2xl rounded-2xl overflow-hidden"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && onClose()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			transition:fly={{ y: 20, duration: 300 }}
		>
			<!-- Header -->
			<div class="border-b border-gray-200 px-6 py-5">
				<div class="flex items-center justify-between">
					<div>
						<h2 class="text-xl font-semibold text-gray-900">Search Limit Exceeded</h2>
						<p class="mt-1 text-sm text-gray-600">
							You've reached your monthly search limit.
						</p>
					</div>
					<button
						type="button"
						onclick={onClose}
						class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
						aria-label="Close"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
			</div>

			<!-- Content -->
			<div class="px-6 py-6">
				<div class="space-y-4">
					<div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
						<div class="space-y-2 text-sm">
							<div class="flex justify-between">
								<span class="text-gray-600">Searches remaining:</span>
								<span class="font-medium text-gray-900">{remaining} / {limit}</span>
							</div>
							<div class="flex justify-between">
								<span class="text-gray-600">Searches requested:</span>
								<span class="font-medium text-gray-900">{requested}</span>
							</div>
						</div>
					</div>

					<p class="text-sm text-gray-600">
						You've used all {limit} searches available this month. Upgrade your plan to get more searches and continue finding influencers.
					</p>
				</div>

				<!-- Actions -->
				<div class="mt-6 flex gap-3">
					<Button
						variant="outline"
						size="md"
						onclick={onClose}
						class="flex-1 justify-center"
					>
						Close
					</Button>
					<Button
						variant="primary"
						size="md"
						onclick={handleUpgrade}
						class="flex-1 justify-center"
					>
						Upgrade Plan
					</Button>
				</div>
			</div>
		</div>
	</div>
{/if}

