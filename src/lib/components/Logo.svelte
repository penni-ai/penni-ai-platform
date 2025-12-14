<script lang="ts">
	import { browser } from '$app/environment';
	import { theme } from '$lib/stores/theme';

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

	// Light logo (main icon) for dark backgrounds, dark logo (black icon) for light backgrounds
	const logoSrc = $derived(() => {
		if (variant === 'light') return '/images/branding/main%20icon%20SVG.svg';
		if (variant === 'dark') return '/images/branding/black%20icon%20SVG.svg';
		// Auto: use light logo on dark/mixed sidebar, dark logo on light sidebar
		return $theme === 'light'
			? '/images/branding/black%20icon%20SVG.svg'
			: '/images/branding/main%20icon%20SVG.svg';
	});
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
