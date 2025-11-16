<script lang="ts">
	import { browser } from '$app/environment';
	
	interface Props {
		size?: 'sm' | 'md' | 'lg';
	}

	let { size = 'md' }: Props = $props();

const sizeStyles = {
	sm: { width: 'w-32', height: 'h-20' },
	md: { width: 'w-40', height: 'h-24' },
	lg: { width: 'w-60', height: 'h-36' }
};
</script>

{#if browser}
	<img
	src="/images/branding/main%20logo%20SVG.svg"
		alt="Penny logo"
		loading="lazy"
	class={`${sizeStyles[size].width} ${sizeStyles[size].height} object-cover`}
	/>
{:else}
	<!-- SSR placeholder to prevent hydration mismatch -->
	<div class={`${sizeStyles[size].width} ${sizeStyles[size].height} bg-gray-200 animate-pulse`}></div>
{/if}
