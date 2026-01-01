<script lang="ts">
import { browser } from '$app/environment';

	interface Props {
		size?: 'sm' | 'md' | 'lg';
		variant?: 'auto' | 'light' | 'dark';
	}

	let { size = 'md', variant = 'auto' }: Props = $props();

	const sizeStyles = {
		sm: { width: 'w-32', height: 'h-20' },
		md: { width: 'w-40', height: 'h-24' },
		lg: { width: 'w-60', height: 'h-36' }
	};

	// Use the pink/white icon everywhere for now.
	const logoSrc = $derived(() => '/images/icon/pink_white_icon.png');
</script>

{#if browser}
	<img
		src={logoSrc()}
		alt="Penny logo"
		loading="lazy"
		class={`${sizeStyles[size].width} ${sizeStyles[size].height} object-contain`}
	/>
{:else}
	<!-- SSR placeholder to prevent hydration mismatch -->
	<div class={`${sizeStyles[size].width} ${sizeStyles[size].height}`}></div>
{/if}
