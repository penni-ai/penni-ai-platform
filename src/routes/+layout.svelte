<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	import { afterNavigate } from '$app/navigation';
	import Navbar from '$lib/components/Navbar.svelte';
	import Footer from '$lib/components/Footer.svelte';

	let { data, children } = $props();

	// Reset scroll position on navigation
	afterNavigate(() => {
		if (typeof window !== 'undefined') {
			window.scrollTo(0, 0);
		}
	});

	// Determine if we're on a public/marketing page (not in app routes)
	const isPublicPage = $derived(() => {
		const path = $page.url.pathname;
		return !path.startsWith('/dashboard') && 
		       !path.startsWith('/campaign') && 
		       !path.startsWith('/my-account') &&
		       !path.startsWith('/inbox') &&
		       !path.startsWith('/chatbot') &&
		       !path.startsWith('/sign-in') &&
		       !path.startsWith('/sign-up') &&
		       !path.startsWith('/logout') &&
		       !path.startsWith('/auth');
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
