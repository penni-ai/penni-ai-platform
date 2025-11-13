<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>Penni AI</title>
	<link rel="icon" href="/images/icon/pink_white_icon.png" type="image/png" />
	<link rel="apple-touch-icon" href="/images/icon/pink_white_icon.png" />
</svelte:head>

<div style="min-height: 100vh; display: flex; flex-direction: column;">
	{@render children()}
</div>
