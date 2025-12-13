<script lang="ts">
	import Logo from './Logo.svelte';
	import Button from './Button.svelte';

	interface Props {
		firebaseUser?: { email: string | null } | null;
		profile?: {
			full_name?: string | null;
		} | null;
	}

	let {
		firebaseUser = null,
		profile = null
	}: Props = $props();

	const displayName = $derived(() => profile?.full_name ?? firebaseUser?.email ?? 'there');
</script>

<nav class="fixed top-0 left-0 right-0 z-50 backdrop-blur-md border-b" style="background-color: var(--color-bg-elevated); opacity: 0.8; border-color: var(--color-border);">
	<div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
		<div class="flex items-center justify-between h-16">
			<!-- Logo -->
			<Logo />

			<!-- Navigation Links -->
			<div class="hidden md:flex items-center gap-8">
				<a href="/" class="transition-colors" style="color: var(--color-text-secondary);" onmouseenter={(e) => e.currentTarget.style.color = 'var(--color-text)'} onmouseleave={(e) => e.currentTarget.style.color = 'var(--color-text-secondary)'}>Home</a>
			</div>

			<!-- Auth Buttons -->
			<div class="flex items-center gap-3">
				{#if firebaseUser}
					<div class="hidden sm:flex flex-col items-end text-xs" style="color: var(--color-text-secondary);">
						<span class="font-semibold" style="color: var(--color-text-secondary);">{displayName()}</span>
					</div>
					<a href="/dashboard" class="transition-colors hidden sm:inline-block" style="color: var(--color-text-secondary);" onmouseenter={(e) => e.currentTarget.style.color = 'var(--color-text)'} onmouseleave={(e) => e.currentTarget.style.color = 'var(--color-text-secondary)'}>
						Dashboard
					</a>
					<a href="/logout" data-sveltekit-reload class="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-full border-2 border-black text-black hover:bg-black hover:text-white transition-all duration-200">
						Sign out
					</a>
				{:else}
					<a href="/sign-up" class="transition-colors hidden sm:inline-block" style="color: var(--color-text-secondary);" onmouseenter={(e) => e.currentTarget.style.color = 'var(--color-text)'} onmouseleave={(e) => e.currentTarget.style.color = 'var(--color-text-secondary)'}>
						Sign up
					</a>
					<Button size="sm" href="/sign-in">Sign in</Button>
				{/if}
			</div>
		</div>
	</div>
</nav>
