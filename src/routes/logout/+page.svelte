<script lang="ts">
	import Button from '$lib/components/Button.svelte';
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
	<div class="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center space-y-4">
		<h1 class="text-2xl font-semibold text-gray-900">Sign-out preview</h1>
		<p class="text-sm text-gray-600">This is a static demo. In a full integration, this page would clear the user session and redirect to the landing page.</p>
		<Button href="/" class="w-full justify-center">Return home</Button>
	</div>
</div>
