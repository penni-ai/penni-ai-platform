<script lang="ts">
	import { fade } from 'svelte/transition';
	import { browser } from '$app/environment';

	interface Props {
		isLoading: boolean;
	}

	let { isLoading }: Props = $props();
</script>

{#if browser && isLoading}
	<div 
		class="absolute inset-0 z-40 bg-white/80 backdrop-blur-md flex items-center justify-center"
		transition:fade={{ duration: 200 }}
	>
		<div class="flex flex-col items-center gap-4">
			<div class="h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-[#FF6F61]"></div>
			<p class="text-sm font-medium text-gray-900">Loading campaign...</p>
			<p class="text-xs text-gray-500">Please wait while we load your data</p>
		</div>
	</div>
{/if}

