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
	export let size: 'default' | 'compact' = 'default';
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
		onclick={onClose}
		onkeydown={(event) => event.key === 'Escape' && onClose()}
		role="button"
		tabindex="-1"
		aria-label="Close panel"
		transition:fade={{ duration: 150 }}
	>
		<div
			class={`relative overflow-hidden flex flex-col ${
				size === 'compact' ? 'max-w-xl w-full max-h-[85vh] mx-auto' : 'h-full w-full max-w-[90vw] max-h-[90vh]'
			}`}
			style="background: var(--color-bg-elevated); border: 1px solid var(--color-border);"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(event) => event.key === 'Escape' && onClose()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			transition:fly={{ y: 20, duration: 200 }}
		>
			{#if showHeader}
				<div class="px-8 py-5 shrink-0" style="border-bottom: 1px solid var(--color-border);">
					<div class="flex items-center justify-between">
						<div class="flex-1">
							<div class="flex items-center gap-3 mb-1">
								<h2 class="text-xl font-medium tracking-tight" style="color: var(--color-text);">{title}</h2>
								{#if stateRestored}
									<span class="text-xs px-2 py-0.5 font-medium" style="color: var(--color-primary); border-bottom: 1px solid var(--color-primary);">Resumed</span>
								{/if}
								{#if isSaving || isSavingDebounced}
									<span class="text-xs" style="color: var(--color-text-muted);">Saving...</span>
								{:else if saveSuccess}
									<span class="text-xs" style="color: var(--color-primary);">Saved</span>
								{/if}
							</div>
							{#if subtitle}
								<p class="text-sm" style="color: var(--color-text-secondary);">{subtitle}</p>
							{/if}
						</div>
						<button
							type="button"
							onclick={onClose}
							class="p-2 transition-colors"
							style="color: var(--color-text-muted);"
							onmouseenter={(e) => {
								e.currentTarget.style.color = 'var(--color-text)';
							}}
							onmouseleave={(e) => {
								e.currentTarget.style.color = 'var(--color-text-muted)';
							}}
							aria-label="Close"
						>
							<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>
					</div>
				</div>
			{:else}
				<div class="flex justify-end px-6 pt-4">
					<button
						type="button"
						onclick={onClose}
						class="p-2 transition-colors"
						style="color: var(--color-text-muted);"
						onmouseenter={(e) => {
							e.currentTarget.style.color = 'var(--color-text)';
						}}
						onmouseleave={(e) => {
							e.currentTarget.style.color = 'var(--color-text-muted)';
						}}
						aria-label="Close"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12" />
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
