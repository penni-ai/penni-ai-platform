<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import { createUserWithEmailAndPassword, sendEmailVerification, signOut } from 'firebase/auth';
	import { firebaseAuth } from '$lib/firebase/client';
	import { goto } from '$app/navigation';

let email = $state('');
let password = $state('');
let confirmPassword = $state('');
let termsAccepted = $state(false);
let loading = $state(false);
let errorMessage = $state<string | null>(null);
let showPassword = $state(false);
let showConfirmPassword = $state(false);

function isValidPassword(value: string) {
	return value.trim().length >= 8;
}

function passwordsMatch(a: string, b: string) {
	return a.trim().length > 0 && a.trim() === b.trim();
}

function canSubmit() {
	return termsAccepted && isValidPassword(password) && passwordsMatch(password, confirmPassword);
}

function passwordInputType() {
	return showPassword ? 'text' : 'password';
}

function confirmInputType() {
	return showConfirmPassword ? 'text' : 'password';
}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (loading) return;

	if (!termsAccepted) {
		errorMessage = 'Please accept the terms to continue.';
		return;
	}

	if (!passwordsMatch(password, confirmPassword)) {
		errorMessage = 'Passwords do not match.';
		return;
	}

	if (!isValidPassword(password)) {
		errorMessage = 'Password must be at least 8 characters.';
		return;
	}

		errorMessage = null;
		loading = true;

	const accountEmail = email.trim();
	const accountPassword = password.trim();

	try {
		const credential = await createUserWithEmailAndPassword(firebaseAuth, accountEmail, accountPassword);
		await sendEmailVerification(credential.user, {
			url: `${window.location.origin}/auth/verify`
		});
		await signOut(firebaseAuth);
		await goto(`/sign-up/confirm?email=${encodeURIComponent(accountEmail)}`);
		} catch (error) {
			console.error('[auth] sign-up failed', error);
			if (error instanceof Error) {
				errorMessage = error.message;
			} else {
				errorMessage = 'Unexpected error while creating your account.';
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
				<h1 class="text-3xl font-semibold text-gray-900">Create Your Company Account</h1>
				<p class="text-sm text-gray-500">Get started with company-level email tools in minutes.</p>
			</div>

			<form class="space-y-5" onsubmit={handleSubmit}>
				{#if errorMessage}
					<div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
				{/if}
				<div class="space-y-2">
					<label for="signup-email" class="text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Company email</label>
					<input
						id="signup-email"
						type="email"
						required
						placeholder="Enter email address"
						class="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
						bind:value={email}
					/>
				</div>
		<div class="space-y-2">
			<label for="signup-password" class="text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Password</label>
			<div class="relative">
				<input
					id="signup-password"
					type={passwordInputType()}
					required minlength="8"
					placeholder="Create your password"
					class="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
				bind:value={password}
				/>
				<button
					type="button"
					class="absolute inset-y-0 right-4 flex items-center text-gray-400 hover:text-gray-600"
					onclick={() => (showPassword = !showPassword)}
					aria-label={showPassword ? 'Hide password' : 'Show password'}
					aria-pressed={showPassword}
				>
					{#if showPassword}
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.45 10.45 0 0 0 1.75 12c2.205 4.478 6.656 7.5 11.25 7.5 1.625 0 3.187-.337 4.622-.95m3.628-3.073A10.478 10.478 0 0 0 22.25 12c-2.205-4.478-6.656-7.5-11.25-7.5a11.42 11.42 0 0 0-4.258.79" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M9.53 9.53a3 3 0 0 0 4.24 4.24" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 0 0-3-3" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M3 3l18 18" />
						</svg>
					{:else}
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7Z" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
						</svg>
					{/if}
				</button>
			</div>
		</div>
		<div class="space-y-2">
			<label for="signup-confirm" class="text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Confirm password</label>
			<div class="relative">
				<input
					id="signup-confirm"
					type={confirmInputType()}
					required minlength="8"
					placeholder="Re-create your password"
					class="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
				bind:value={confirmPassword}
				/>
				<button
					type="button"
					class="absolute inset-y-0 right-4 flex items-center text-gray-400 hover:text-gray-600"
					onclick={() => (showConfirmPassword = !showConfirmPassword)}
					aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
					aria-pressed={showConfirmPassword}
				>
					{#if showConfirmPassword}
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.45 10.45 0 0 0 1.75 12c2.205 4.478 6.656 7.5 11.25 7.5 1.625 0 3.187-.337 4.622-.95m3.628-3.073A10.478 10.478 0 0 0 22.25 12c-2.205-4.478-6.656-7.5-11.25-7.5a11.42 11.42 0 0 0-4.258.79" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M9.53 9.53a3 3 0 0 0 4.24 4.24" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 0 0-3-3" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M3 3l18 18" />
						</svg>
					{:else}
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7Z" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
						</svg>
					{/if}
				</button>
			</div>
		</div>
				<label class="flex items-start gap-3 text-sm text-gray-600">
					<input type="checkbox" bind:checked={termsAccepted} class="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#FF6F61] focus:ring-[#FF6F61]" />
					<span>I agree to the <a href="/terms" class="font-medium text-gray-900 underline">Terms of Service</a> and <a href="/privacy" class="font-medium text-gray-900 underline">Privacy Policy</a>.</span>
				</label>

		<button
			type="submit"
			class="flex w-full items-center justify-center rounded-2xl bg-[#FF8073] px-8 py-4 text-lg font-medium text-white transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#FF6F61] disabled:cursor-not-allowed disabled:opacity-60"
			disabled={loading || !canSubmit()}
			data-can-submit={canSubmit()}
			data-terms={termsAccepted}
			data-password-ok={isValidPassword(password)}
			data-match={passwordsMatch(password, confirmPassword)}
		>
			{loading ? 'Creating account…' : 'Create Account'}
		</button>
			</form>

			<div class="relative">
				<div class="absolute inset-0 flex items-center" aria-hidden="true">
					<div class="w-full border-t border-dashed border-gray-200"></div>
				</div>
				<div class="relative flex justify-center">
					<span class="bg-white px-3 text-xs font-semibold uppercase tracking-[0.3em] text-gray-400">or continue with</span>
				</div>
			</div>

			<Button
				variant="outline"
				href="javascript:void(0)"
				class="w-full justify-center rounded-2xl border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
			>
				<span class="mr-2 inline-flex h-4 w-4 items-center justify-center">
					<svg viewBox="0 0 24 24" class="h-4 w-4">
						<path fill="#4285F4" d="M21.805 10.023h-9.18v3.955h5.3c-.229 1.248-.917 2.304-1.955 3.005l3.155 2.447c1.843-1.699 2.881-4.201 2.881-7.187 0-.692-.069-1.365-.201-2.02z" />
						<path fill="#34A853" d="M12.625 21.5c2.479 0 4.56-.82 6.08-2.223l-3.156-2.447c-.874.586-1.989.93-3.21.93-2.464 0-4.555-1.664-5.298-3.907l-3.248 2.522C5.534 19.632 8.825 21.5 12.625 21.5z" />
						<path fill="#FBBC05" d="M7.327 13.853a5.983 5.983 0 0 1-.314-1.853c0-.646.114-1.27.314-1.853l-3.25-2.523A10.248 10.248 0 0 0 3.5 12c0 1.667.402 3.246 1.13 4.576l3.248-2.723z" />
						<path fill="#EA4335" d="M12.625 6.25a5.56 5.56 0 0 1 3.922 1.495l2.94-2.94C17.192 3.273 14.9 2.25 12.625 2.25 8.825 2.25 5.534 4.118 3.93 7.147l3.248 2.523C7.07 7.427 9.161 6.25 12.625 6.25z" />
					</svg>
				</span>
				Continue with Google
			</Button>

			<p class="text-center text-sm text-gray-600">
				Already have an account?
				<a href="/sign-in" class="font-medium text-[#FF6F61]">Sign in</a>
			</p>
		</section>
	</main>
</div>
