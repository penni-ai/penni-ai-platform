<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import Button from '../Button.svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		onConfirm: () => void;
		topN?: number;
	}

	let { open, onClose, onConfirm, topN = 30 }: Props = $props();

	function handleConfirm() {
		onConfirm();
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
						<h2 class="text-xl font-semibold text-gray-900">Rerun Pipeline</h2>
						<p class="mt-1 text-sm text-gray-600">
							This will consume additional search credits.
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
					<div class="rounded-lg border border-amber-200 bg-amber-50 p-4">
						<div class="flex items-start gap-3">
							<svg class="h-5 w-5 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
							</svg>
							<div class="flex-1">
								<h3 class="text-sm font-semibold text-amber-900">Credit Consumption Warning</h3>
								<p class="mt-1 text-sm text-amber-800">
									Rerunning the pipeline will consume <span class="font-semibold">{topN} search credit{topN !== 1 ? 's' : ''}</span> from your monthly allocation. This action cannot be undone.
								</p>
							</div>
						</div>
					</div>

					<div class="space-y-2 text-sm text-gray-600">
						<p class="font-medium text-gray-900">What happens when you rerun:</p>
						<ul class="list-disc list-inside space-y-1 ml-2">
							<li>A new pipeline will be started with the same search parameters</li>
							<li>Your existing pipeline results will remain unchanged</li>
							<li>Search credits will be deducted from your monthly limit</li>
						</ul>
					</div>
				</div>

				<!-- Actions -->
				<div class="mt-6 flex gap-3">
					<Button
						variant="outline"
						size="md"
						onclick={onClose}
						class="flex-1 justify-center"
					>
						Cancel
					</Button>
					<Button
						variant="primary"
						size="md"
						onclick={handleConfirm}
						class="flex-1 justify-center"
					>
						Rerun Pipeline
					</Button>
				</div>
			</div>
		</div>
	</div>
{/if}

