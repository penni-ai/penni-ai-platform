<script lang="ts">
	import { page } from '$app/stores';

	let { data, children } = $props();
	
	const currentPath = $derived($page.url.pathname);
	const isAccount = $derived(currentPath === '/my-account' || currentPath === '/my-account/');
	const isBilling = $derived(currentPath === '/my-account/billing');
	const isGmail = $derived(currentPath === '/my-account/gmail');
</script>

<div class="min-h-screen" style="background-color: var(--color-bg-elevated)">
	<main class="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-8">
		<section class="flex flex-col gap-1">
			<h1 class="text-2xl font-semibold" style="color: var(--color-text)">My account</h1>
			<p class="text-sm" style="color: var(--color-text-muted)">Manage your identity, language preferences, and billing details.</p>
		</section>

		<!-- Tab Navigation -->
		<div class="border-b -mx-8 px-8" style="border-color: var(--color-border)">
			<div class="flex gap-1">
				<a
					href="/my-account"
					class={`px-4 py-2 text-sm font-medium transition ${
						isAccount
							? 'border-b-2'
							: ''
					}`}
					style={isAccount
						? 'border-color: var(--color-primary); color: var(--color-text)'
						: 'color: var(--color-text-muted)'}
					onmouseenter={(e) => !isAccount && (e.currentTarget.style.color = 'var(--color-text-secondary)')}
					onmouseleave={(e) => !isAccount && (e.currentTarget.style.color = 'var(--color-text-muted)')}
				>
					Account
				</a>
				<a
					href="/my-account/billing"
					class={`px-4 py-2 text-sm font-medium transition ${
						isBilling
							? 'border-b-2'
							: ''
					}`}
					style={isBilling
						? 'border-color: var(--color-primary); color: var(--color-text)'
						: 'color: var(--color-text-muted)'}
					onmouseenter={(e) => !isBilling && (e.currentTarget.style.color = 'var(--color-text-secondary)')}
					onmouseleave={(e) => !isBilling && (e.currentTarget.style.color = 'var(--color-text-muted)')}
				>
					Billing
				</a>
				<a
					href="/my-account/gmail"
					class={`px-4 py-2 text-sm font-medium transition ${
						isGmail
							? 'border-b-2'
							: ''
					}`}
					style={isGmail
						? 'border-color: var(--color-primary); color: var(--color-text)'
						: 'color: var(--color-text-muted)'}
					onmouseenter={(e) => !isGmail && (e.currentTarget.style.color = 'var(--color-text-secondary)')}
					onmouseleave={(e) => !isGmail && (e.currentTarget.style.color = 'var(--color-text-muted)')}
				>
					Gmail Mailboxes
				</a>
			</div>
		</div>

		{@render children()}
	</main>
</div>

