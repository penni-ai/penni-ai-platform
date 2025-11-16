<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import { afterNavigate } from '$app/navigation';
	import Navbar from '$lib/components/Navbar.svelte';
	import Footer from '$lib/components/Footer.svelte';

	let { data, children } = $props();

	// Track current pathname to handle navigation transitions
	// Initialize with current pathname from page store
	let currentPath = $state<string>($page.url.pathname);

	// Sync with page store changes (handles navigation)
	$effect(() => {
		currentPath = $page.url.pathname;
	});

	afterNavigate(() => {
		if (typeof window !== 'undefined') {
			window.scrollTo(0, 0);
		}
		// Ensure pathname is updated immediately after navigation
		currentPath = $page.url.pathname;
	});

	// Determine if we're on a public/marketing page (not in app routes)
	const isPublicPage = $derived(() => {
		try {
			// Use currentPath if available (handles navigation transitions), otherwise fall back to $page
			const path = currentPath || $page?.url?.pathname;
			// If pathname is not available yet, default to showing navbar (prevents flicker)
			if (!path) {
				return true;
			}
		return !path.startsWith('/dashboard') && 
		       !path.startsWith('/campaign') && 
		       !path.startsWith('/my-account') &&
		       !path.startsWith('/inbox') &&
		       !path.startsWith('/chatbot') &&
		       !path.startsWith('/sign-in') &&
		       !path.startsWith('/sign-up') &&
		       !path.startsWith('/logout') &&
		       !path.startsWith('/auth');
		} catch {
			// Fallback: show navbar if we can't determine the path
			return true;
		}
	});
</script>

<svelte:head>
	<title>Penni AI</title>
	<link rel="icon" href="/images/icon/pink_white_icon.png" type="image/png" />
	<link rel="apple-touch-icon" href="/images/icon/pink_white_icon.png" />
</svelte:head>

<div style="min-height: 100vh; display: flex; flex-direction: column;">
	{#if isPublicPage()}
		<Navbar firebaseUser={data.firebaseUser} profile={data.profile} />
		<main class="flex-1">
			{@render children()}
		</main>
		<Footer />
	{:else}
		{@render children()}
	{/if}
</div>
