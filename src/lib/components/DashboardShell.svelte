<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import SidebarNavigation from '$lib/components/SidebarNavigation.svelte';
	import { sidebarState } from '$lib/stores/sidebar';
	import { theme } from '$lib/stores/theme';

export let sidebarWidthClass = 'w-52';
export let mainTag: keyof HTMLElementTagNameMap = 'main';
export let mainClass = 'relative flex-1 overflow-y-auto';
export let showToggleControls = false;
export let campaigns: Array<{ id: string; name: string; href?: string; isIncomplete?: boolean }> = [];
export let activeCampaignId: string | null = null;
export let onUpgrade: (() => void) | undefined = undefined;
export let onCreateCampaign: ((campaignId: string) => void) | undefined = undefined;
export let onSelectIncompleteCampaign: ((campaignId: string) => void) | undefined = undefined;
export let showCampaignHint: boolean = false;
export let onDismissCampaignHint: (() => void) | undefined = undefined;

// Reactive styles based on theme
$: sidebarBg = $theme === 'light' ? '#fafaf9' : '#1a1a1a';
$: sidebarBorder = $theme === 'light' ? '#e5e5e5' : '#2a2a2a';
$: contentBg = $theme === 'dark' ? '#1a1a1a' : '#fafaf9';
$: textColor = $theme === 'light' ? '#525252' : '#a3a3a3';
$: hoverBg = $theme === 'light' ? '#f5f5f4' : '#2a2a2a';
</script>

<div class="flex h-screen overflow-hidden">
	<!-- Sidebar -->
	<aside class={`relative transition-all duration-300 ${$sidebarState ? sidebarWidthClass : 'w-0'} overflow-hidden`}>
		<div class={`h-full flex flex-col overflow-hidden transition-transform duration-300 ${$sidebarState ? 'translate-x-0' : '-translate-x-full'}`} style="background: {sidebarBg}; border-right: 1px solid {sidebarBorder};">
			<div class="px-2 py-2 flex items-center justify-between shrink-0" style="border-bottom: 1px solid {sidebarBorder};">
				<slot name="sidebar-header">
					<a href="/dashboard" aria-label="Penny dashboard">
						<Logo size="sm" />
					</a>
				</slot>
				<slot name="sidebar-controls" />
				{#if showToggleControls}
					<button
						type="button"
						class="p-2 rounded-lg transition"
						style="color: {textColor};"
						onmouseenter={(e) => e.currentTarget.style.background = hoverBg}
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
			<SidebarNavigation campaigns={campaigns} selectedCampaignId={activeCampaignId} onUpgrade={onUpgrade} onCreateCampaign={onCreateCampaign} onSelectIncompleteCampaign={onSelectIncompleteCampaign} showCampaignHint={showCampaignHint} onDismissCampaignHint={onDismissCampaignHint} />
		</div>
	</aside>

	<!-- Main Content Area -->
	<svelte:element this={mainTag} class="{mainClass} bg-grid-texture" style="background: {contentBg};">
		<slot />
	</svelte:element>
</div>

{#if showToggleControls && !$sidebarState}
	<button
		type="button"
		class="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg shadow-lg transition"
		style="border: 1px solid {sidebarBorder}; background: {sidebarBg}; color: {textColor};"
		onmouseenter={(e) => e.currentTarget.style.background = hoverBg}
		onmouseleave={(e) => e.currentTarget.style.background = sidebarBg}
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
