<script lang="ts">
	import { fade, fly } from 'svelte/transition';

	export let open = false;
	export let onClose: () => void;
	export let title = 'Send Outreach';
	export let subtitle = '';
	export let stateRestored = false;
	export let isSaving = false;
	export let isSavingDebounced = false;
	export let saveSuccess = false;
	export let showHeader = true;
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-[10%] py-[5%]"
		on:click={onClose}
		on:keydown={(event) => event.key === 'Escape' && onClose()}
		role="button"
		tabindex="-1"
		aria-label="Close panel"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="relative h-full w-full bg-white shadow-2xl rounded-2xl overflow-hidden flex flex-col"
			on:click|stopPropagation
			on:keydown={(event) => event.key === 'Escape' && onClose()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			transition:fly={{ y: 20, duration: 300 }}
		>
			{#if showHeader}
				<div class="border-b border-gray-200 px-8 py-6 shrink-0">
					<div class="flex items-center justify-between">
						<div class="flex-1">
							<div class="flex items-center gap-3 mb-1">
							<h2 class="text-2xl font-semibold text-gray-900">{title}</h2>
							{#if stateRestored}
								<span class="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">Resumed</span>
							{/if}
							{#if isSaving || isSavingDebounced}
								<span class="text-xs text-gray-500">Saving...</span>
							{:else if saveSuccess}
								<span class="text-xs text-green-600">Saved</span>
								{/if}
							</div>
							{#if subtitle}
								<p class="text-sm text-gray-600">{subtitle}</p>
							{/if}
						</div>
						<button
							type="button"
							on:click={onClose}
							class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
							aria-label="Close"
						>
							<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
				</div>
			{:else}
				<div class="flex justify-end px-6 pt-6">
					<button
						type="button"
						on:click={onClose}
						class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
						aria-label="Close"
					>
						<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
			{/if}

			<div class="flex-1 overflow-hidden relative">
				<slot />
			</div>
		</div>
	</div>
{/if}
