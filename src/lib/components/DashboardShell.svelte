<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import SidebarNavigation from '$lib/components/SidebarNavigation.svelte';
	import { sidebarState } from '$lib/stores/sidebar';

export let sidebarWidthClass = 'w-72';
export let mainTag: keyof HTMLElementTagNameMap = 'main';
export let mainClass = 'relative flex-1 overflow-y-auto bg-gray-50';
export let showToggleControls = false;
export let campaigns: Array<{ id: string; name: string; href?: string } > = [];
export let activeCampaignId: string | null = null;
</script>

<div class="flex h-screen bg-white overflow-hidden">
	{#if $sidebarState}
		<aside class={`${sidebarWidthClass} bg-white border-r border-gray-200 flex flex-col`}>
			<div class="px-2 py-2 border-b border-gray-200 flex items-center justify-between">
				<slot name="sidebar-header">
					<a href="/" aria-label="Penny home">
						<Logo size="md" />
					</a>
				</slot>
				{#if showToggleControls}
					<button
						type="button"
						class="p-2 hover:bg-gray-100 rounded-lg transition"
						aria-label="Hide sidebar"
						onclick={() => sidebarState.toggle()}
					>
						<svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M5 5v14" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M19 12H9" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M13 8l-4 4 4 4" />
						</svg>
					</button>
				{/if}
			</div>
			<SidebarNavigation campaigns={campaigns} selectedCampaignId={activeCampaignId} />
		</aside>
	{/if}

	<svelte:element this={mainTag} class={mainClass}>
		{#if showToggleControls && !$sidebarState}
			<button
				type="button"
				class="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white shadow-sm transition hover:bg-gray-100"
				onclick={() => sidebarState.toggle()}
				aria-label="Show sidebar"
			>
				<svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M19 5v14" />
					<path stroke-linecap="round" stroke-linejoin="round" d="M5 12h10" />
					<path stroke-linecap="round" stroke-linejoin="round" d="M11 8l4 4-4 4" />
				</svg>
			</button>
		{/if}
		<slot />
	</svelte:element>
</div>
