<script lang="ts">
	import { goto } from '$app/navigation';
	import Button from '$lib/components/Button.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
	import { firebaseAuth } from '$lib/firebase/client';
	import { onMount } from 'svelte';

	let email = $state('');
	let password = $state('');
	let remember = $state(true);
	let loading = $state(false);
	let errorMessage = $state<string | null>(null);
	let verifiedNotice = $state(false);

	onMount(() => {
		const params = new URL(window.location.href).searchParams;
		verifiedNotice = params.get('verified') === '1';
	});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (loading) return;

		errorMessage = null;
		loading = true;

		try {
			const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
			const idToken = await credential.user.getIdToken();

			const response = await fetch('/api/session', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ idToken, remember })
			});

			if (!response.ok) {
				const payload = await response.json().catch(() => ({}));
				if (response.status === 403) {
					await signOut(firebaseAuth);
				}
				throw new Error(payload?.error ?? 'Unable to start session.');
			}

			await goto('/dashboard', { invalidateAll: true });
		} catch (error) {
			console.error('[auth] sign-in failed', error);
			await signOut(firebaseAuth);
			if (error instanceof Error) {
				errorMessage = error.message;
			} else {
				errorMessage = 'Unexpected error during sign-in.';
			}
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex min-h-screen flex-col bg-gradient-to-b from-white via-[#FFECEC] to-[#FFD6D6]">
	<header class="flex items-center justify-center py-10">
		<a href="/" aria-label="Penny home">
			<Logo size="md" />
		</a>
	</header>

	<main class="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-6 pb-16">
		<section class="w-full max-w-xl rounded-[32px] bg-white shadow-[0_20px_60px_-20px_rgba(255,111,97,0.45)] p-10 space-y-8">
			<div class="space-y-3 text-center">
				<h1 class="text-3xl font-semibold text-gray-900">Welcome Back</h1>
				<p class="text-sm text-gray-500">Sign in to manage your company outreach.</p>
			</div>

			<form class="space-y-5" onsubmit={handleSubmit}>
				{#if verifiedNotice}
					<div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
						Your email has been verified. You can sign in now.
					</div>
				{/if}
				{#if errorMessage}
					<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
						{errorMessage}
					</div>
				{/if}
				<div class="space-y-2">
					<label for="signin-email" class="text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Email</label>
					<input
						id="signin-email"
						type="email"
						required
						placeholder="Enter email address"
						class="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
						bind:value={email}
					/>
				</div>
				<div class="space-y-2">
					<label for="signin-password" class="text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Password</label>
					<div class="relative">
						<input
							id="signin-password"
							type="password"
							required
							placeholder="Enter password"
						class="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
							bind:value={password}
						/>
						<span class="pointer-events-none absolute inset-y-0 right-4 flex items-center text-gray-400">
							<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7Z" />
								<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
							</svg>
						</span>
					</div>
				</div>
				<div class="flex items-center justify-between text-sm">
					<label class="flex items-center gap-2 text-gray-600">
						<input type="checkbox" class="h-4 w-4 rounded border-gray-300 text-[#FF6F61] focus:ring-[#FF6F61]" bind:checked={remember} />
						<span>Remember me</span>
					</label>
					<a href="/forgot-password" class="text-[#FF6F61] font-medium">Forgot password?</a>
				</div>
				<Button
					type="submit"
					size="lg"
					class="w-full justify-center rounded-2xl bg-[#FF8073] text-white hover:bg-[#ff9488] disabled:opacity-70"
					disabled={loading}
				>
					{loading ? 'Signing in…' : 'Sign in'}
				</Button>
			</form>

			<div class="relative">
				<div class="absolute inset-0 flex items-center" aria-hidden="true">
					<div class="w-full border-t border-dashed border-gray-200"></div>
				</div>
				<div class="relative flex justify-center">
					<span class="bg-white px-3 text-xs font-semibold uppercase tracking-[0.3em] text-gray-400">or sign in with</span>
				</div>
			</div>

			<Button variant="outline" href="javascript:void(0)" class="w-full justify-center rounded-2xl border-gray-200 bg-white text-gray-700 hover:bg-gray-50">
				<span class="mr-2 inline-flex h-4 w-4 items-center justify-center">
					<svg viewBox="0 0 24 24" class="h-4 w-4">
						<path fill="#4285F4" d="M21.805 10.023h-9.18v3.955h5.3c-.229 1.248-.917 2.304-1.955 3.005l3.155 2.447c1.843-1.699 2.881-4.201 2.881-7.187 0-.692-.069-1.365-.201-2.02z" />
						<path fill="#34A853" d="M12.625 21.5c2.479 0 4.56-.82 6.08-2.223l-3.156-2.447c-.874.586-1.989.93-3.21.93-2.464 0-4.555-1.664-5.298-3.907l-3.248 2.522C5.534 19.632 8.825 21.5 12.625 21.5z" />
						<path fill="#FBBC05" d="M7.327 13.853a5.983 5.983 0 0 1-.314-1.853c0-.646.114-1.27.314-1.853l-3.25-2.523A10.248 10.248 0 0 0 3.5 12c0 1.667.402 3.246 1.13 4.576l3.248-2.723z" />
						<path fill="#EA4335" d="M12.625 6.25a5.56 5.56 0 0 1 3.922 1.495l2.94-2.94C17.192 3.273 14.9 2.25 12.625 2.25 8.825 2.25 5.534 4.118 3.93 7.147l3.248 2.523C7.07 7.427 9.161 6.25 12.625 6.25z" />
					</svg>
				</span>
				Sign in with Google
			</Button>

			<p class="text-center text-sm text-gray-600">
				Don't have an account?
				<a href="/sign-up" class="font-medium text-[#FF6F61]">Create one</a>
			</p>
		</section>
	</main>
</div>
