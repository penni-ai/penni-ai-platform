<script lang="ts">
	import { page } from '$app/stores';

	let { data } = $props();
	
	const currentPath = $derived($page.url.pathname);
	const isAccount = $derived(currentPath === '/my-account' || currentPath === '/my-account/');
	const isBilling = $derived(currentPath === '/my-account/billing');
	const isGmail = $derived(currentPath === '/my-account/gmail');
</script>

<div class="min-h-screen bg-white">
	<main class="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-8">
		<section class="flex flex-col gap-1">
			<h1 class="text-2xl font-semibold text-gray-900">My account</h1>
			<p class="text-sm text-gray-500">Manage your identity, language preferences, and billing details.</p>
		</section>

		<!-- Tab Navigation -->
		<div class="border-b border-gray-200 -mx-8 px-8">
			<div class="flex gap-1">
				<a
					href="/my-account"
					class={`px-4 py-2 text-sm font-medium transition ${
						isAccount
							? 'border-b-2 border-[#FF6F61] text-gray-900'
							: 'text-gray-500 hover:text-gray-700'
					}`}
				>
					Account
				</a>
				<a
					href="/my-account/billing"
					class={`px-4 py-2 text-sm font-medium transition ${
						isBilling
							? 'border-b-2 border-[#FF6F61] text-gray-900'
							: 'text-gray-500 hover:text-gray-700'
					}`}
				>
					Billing
				</a>
				<a
					href="/my-account/gmail"
					class={`px-4 py-2 text-sm font-medium transition ${
						isGmail
							? 'border-b-2 border-[#FF6F61] text-gray-900'
							: 'text-gray-500 hover:text-gray-700'
					}`}
				>
					Gmail Mailboxes
				</a>
			</div>
		</div>

		<slot />
	</main>
</div>

