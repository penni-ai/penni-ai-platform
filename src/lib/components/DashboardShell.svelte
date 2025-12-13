<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import SidebarNavigation from '$lib/components/SidebarNavigation.svelte';
	import { sidebarState } from '$lib/stores/sidebar';

export let sidebarWidthClass = 'w-72';
export let mainTag: keyof HTMLElementTagNameMap = 'main';
export let mainClass = 'relative flex-1 overflow-y-auto';
export let showToggleControls = false;
export let campaigns: Array<{ id: string; name: string; href?: string } > = [];
export let activeCampaignId: string | null = null;
export let onUpgrade: (() => void) | undefined = undefined;
</script>

<div class="flex h-screen overflow-hidden" style="background: var(--color-bg-elevated)">
	<aside class={`relative transition-all duration-300 ${$sidebarState ? sidebarWidthClass : 'w-0'} overflow-hidden`}>
		<div class={`h-full flex flex-col overflow-hidden transition-transform duration-300 ${$sidebarState ? 'translate-x-0' : '-translate-x-full'}`} style="background: var(--color-bg-elevated); border-right: 1px solid var(--color-border)">
			<div class="px-2 py-2 flex items-center justify-between shrink-0" style="border-bottom: 1px solid var(--color-border)">
				<slot name="sidebar-header">
					<a href="/dashboard" aria-label="Penny dashboard">
						<Logo size="md" />
					</a>
				</slot>
				<slot name="sidebar-controls" />
				{#if showToggleControls}
					<button
						type="button"
						class="p-2 rounded-lg transition"
						style="color: var(--color-text-secondary)"
						onmouseenter={(e) => e.currentTarget.style.background = 'var(--color-bg)'}
						onmouseleave={(e) => e.currentTarget.style.background = 'transparent'}
						aria-label="Hide sidebar"
						onclick={() => sidebarState.close()}
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M5 5v14" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M19 12H9" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M13 8l-4 4 4 4" />
						</svg>
					</button>
				{/if}
			</div>
			<SidebarNavigation campaigns={campaigns} selectedCampaignId={activeCampaignId} onUpgrade={onUpgrade} />
		</div>
	</aside>

	<svelte:element this={mainTag} class={mainClass}>
		<slot />
	</svelte:element>
</div>

{#if showToggleControls && !$sidebarState}
	<button
		type="button"
		class="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg shadow-sm transition"
		style="border: 1px solid var(--color-border); background: var(--color-bg-elevated); color: var(--color-text-secondary)"
		onmouseenter={(e) => e.currentTarget.style.background = 'var(--color-bg)'}
		onmouseleave={(e) => e.currentTarget.style.background = 'var(--color-bg-elevated)'}
		onclick={() => sidebarState.open()}
		aria-label="Show sidebar"
	>
		<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
			<path stroke-linecap="round" stroke-linejoin="round" d="M19 5v14" />
			<path stroke-linecap="round" stroke-linejoin="round" d="M5 12h10" />
			<path stroke-linecap="round" stroke-linejoin="round" d="M11 8l4 4-4 4" />
		</svg>
	</button>
{/if}
