<script lang="ts">
import { goto } from '$app/navigation';
import Button from '$lib/components/Button.svelte';
import Logo from '$lib/components/Logo.svelte';
import { FirebaseError } from 'firebase/app';
import { GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup, signOut } from 'firebase/auth';
import { firebaseAuth } from '$lib/firebase/client';
import { onMount } from 'svelte';

let email = $state('');
let password = $state('');
let remember = $state(true);
let loading = $state(false);
let errorMessage = $state<string | null>(null);
let verifiedNotice = $state(false);
let showEmailForm = $state(false);

const TEST_USER = {
	email: 'search-tester@example.com',
	password: 'TestPass123!'
};

	onMount(() => {
		const params = new URL(window.location.href).searchParams;
		verifiedNotice = params.get('verified') === '1';
	});

async function createSession(idToken: string, rememberChoice: boolean) {
	const response = await fetch('/api/public/session', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ idToken, remember: rememberChoice })
	});

	if (!response.ok) {
		const payload = await response.json().catch(() => ({}));
		if (response.status === 403) {
			await signOut(firebaseAuth);
		}
		const code = typeof payload?.error?.code === 'string' ? payload.error.code : null;
		const message = typeof payload?.error?.message === 'string' ? payload.error.message : 'Unable to start session.';
		const combined = code ? `${code}: ${message}` : message;
		throw new Error(combined);
	}

	await goto('/dashboard', { invalidateAll: true });
}

async function authenticate() {
	if (loading) return;
	errorMessage = null;
	loading = true;

	try {
		const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
		await credential.user.reload();
		const idToken = await credential.user.getIdToken(true);
		await createSession(idToken, remember);
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

function buildGoogleProvider() {
	const provider = new GoogleAuthProvider();
	provider.setCustomParameters({ prompt: 'select_account' });
	return provider;
}

async function signInWithGoogle() {
	if (loading) return;
	errorMessage = null;
	loading = true;

	try {
		const provider = buildGoogleProvider();
		const result = await signInWithPopup(firebaseAuth, provider);
		const idToken = await result.user.getIdToken(true);
		await createSession(idToken, remember);
	} catch (error) {
		console.error('[auth] google sign-in failed', error);
		await signOut(firebaseAuth);
		if (error instanceof FirebaseError) {
			if (error.code === 'auth/popup-closed-by-user') {
				errorMessage = 'Google sign-in was closed before completion. Please try again.';
			} else {
				errorMessage = error.message;
			}
		} else if (error instanceof Error) {
			errorMessage = error.message;
		} else {
			errorMessage = 'Unexpected error during Google sign-in.';
		}
	} finally {
		loading = false;
	}
}

async function handleSubmit(event: SubmitEvent) {
	event.preventDefault();
	await authenticate();
}

async function loginAsTestUser() {
	email = TEST_USER.email;
	password = TEST_USER.password;
	remember = true;
	await authenticate();
}
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
	<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet">
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center px-6" style="background-color: var(--paper); font-family: 'DM Sans', sans-serif;">
	<div class="w-full max-w-md">
		<!-- Logo -->
		<div class="mb-8 flex justify-center">
			<a href="/" aria-label="Penny home">
				<Logo size="md" />
			</a>
		</div>

		<!-- Page Title -->
		<h1 class="mb-2 text-center text-4xl tracking-tight" style="color: var(--ink); font-family: 'Instrument Serif', serif; font-weight: 400;">
			Welcome back
		</h1>
		<p class="mb-8 text-center text-base" style="color: var(--ink-muted);">
			Sign in to continue your influencer outreach
		</p>

		<!-- Notices -->
		{#if verifiedNotice}
			<div class="mb-6 rounded-lg border px-4 py-3 text-sm" style="background-color: var(--color-success-bg); border-color: var(--color-success-border); color: var(--color-success-text);">
				Your email has been verified. You can sign in now.
			</div>
		{/if}
		{#if errorMessage}
			<div class="mb-6 rounded-lg border px-4 py-3 text-sm" style="background-color: var(--color-error-bg); border-color: var(--color-error-border); color: var(--color-error-text);">
				{errorMessage}
			</div>
		{/if}

		<!-- Main Card -->
		<div class="rounded-xl border p-8" style="background-color: var(--color-bg-elevated); border-color: var(--border);">
			<!-- Google Sign In Button -->
			<button
				type="button"
				class="mb-6 flex w-full items-center justify-center gap-3 rounded-lg border px-4 py-3 text-base font-medium transition-all disabled:opacity-60"
				style="border-color: var(--border); color: var(--ink); background-color: var(--color-bg-elevated);"
				onmouseenter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg)'}
				onmouseleave={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-elevated)'}
				onclick={signInWithGoogle}
				disabled={loading}
			>
				<svg viewBox="0 0 24 24" class="h-5 w-5">
					<path fill="#4285F4" d="M21.805 10.023h-9.18v3.955h5.3c-.229 1.248-.917 2.304-1.955 3.005l3.155 2.447c1.843-1.699 2.881-4.201 2.881-7.187 0-.692-.069-1.365-.201-2.02z" />
					<path fill="#34A853" d="M12.625 21.5c2.479 0 4.56-.82 6.08-2.223l-3.156-2.447c-.874.586-1.989.93-3.21.93-2.464 0-4.555-1.664-5.298-3.907l-3.248 2.522C5.534 19.632 8.825 21.5 12.625 21.5z" />
					<path fill="#FBBC05" d="M7.327 13.853a5.983 5.983 0 0 1-.314-1.853c0-.646.114-1.27.314-1.853l-3.25-2.523A10.248 10.248 0 0 0 3.5 12c0 1.667.402 3.246 1.13 4.576l3.248-2.723z" />
					<path fill="#EA4335" d="M12.625 6.25a5.56 5.56 0 0 1 3.922 1.495l2.94-2.94C17.192 3.273 14.9 2.25 12.625 2.25 8.825 2.25 5.534 4.118 3.93 7.147l3.248 2.523C7.07 7.427 9.161 6.25 12.625 6.25z" />
				</svg>
				{loading ? 'Opening Google…' : 'Continue with Google'}
			</button>

			<!-- Divider -->
			<div class="relative mb-6">
				<div class="absolute inset-0 flex items-center">
					<div class="w-full border-t" style="border-color: var(--border);"></div>
				</div>
				<div class="relative flex justify-center text-sm">
					<span class="px-4 text-sm" style="background-color: var(--color-bg-elevated); color: var(--ink-muted);">Or sign in with email</span>
				</div>
			</div>

			<!-- Email/Password Form -->
			<form class="space-y-5" onsubmit={handleSubmit}>
				<div class="space-y-2">
					<label for="signin-email" class="block text-sm font-medium" style="color: var(--ink-light);">Email</label>
					<input
						id="signin-email"
						type="email"
						required
						placeholder="you@example.com"
						class="w-full rounded-lg border px-4 py-2.5 text-base transition-all focus:outline-none focus:ring-2"
						style="border-color: var(--border); color: var(--ink); background-color: var(--color-bg-elevated); --tw-ring-color: var(--coral);"
						bind:value={email}
					/>
				</div>

				<div class="space-y-2">
					<label for="signin-password" class="block text-sm font-medium" style="color: var(--ink-light);">Password</label>
					<input
						id="signin-password"
						type="password"
						required
						placeholder="Enter your password"
						class="w-full rounded-lg border px-4 py-2.5 text-base transition-all focus:outline-none focus:ring-2"
						style="border-color: var(--border); color: var(--ink); background-color: var(--color-bg-elevated); --tw-ring-color: var(--coral);"
						bind:value={password}
					/>
				</div>

				<div class="flex items-center justify-between">
					<label class="flex items-center gap-2 text-sm" style="color: var(--ink-light);">
						<input
							type="checkbox"
							class="h-4 w-4 rounded focus:ring-2"
							style="color: var(--coral); border-color: var(--color-border); --tw-ring-color: var(--coral);"
							bind:checked={remember}
						/>
						<span>Remember me</span>
					</label>
					<a href="/forgot-password" class="text-sm font-medium hover:underline" style="color: var(--coral);">
						Forgot password?
					</a>
				</div>

				<button
					type="submit"
					class="w-full rounded-lg px-4 py-3 text-base font-medium text-white transition-all hover:opacity-90 disabled:opacity-60"
					style="background-color: var(--coral);"
					disabled={loading}
				>
					{loading ? 'Signing in…' : 'Sign in'}
				</button>

				<button
					type="button"
					class="w-full rounded-lg border px-4 py-2 text-sm transition-all disabled:opacity-60"
					style="border-color: var(--border); color: var(--ink-muted); background-color: var(--color-bg-elevated);"
					onmouseenter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg)'}
					onmouseleave={(e) => e.currentTarget.style.backgroundColor = 'var(--color-bg-elevated)'}
					onclick={loginAsTestUser}
					disabled={loading}
				>
					Use test account
				</button>
			</form>
		</div>

		<!-- Sign Up Link -->
		<p class="mt-6 text-center text-sm" style="color: var(--ink-muted);">
			Don't have an account?
			<a href="/sign-up" class="font-medium hover:underline" style="color: var(--coral);">
				Sign up
			</a>
		</p>
	</div>
</div>

<style>
	:root {
		--coral: var(--color-primary);
		--ink: var(--color-text);
		--ink-light: var(--color-text-secondary);
		--ink-muted: var(--color-text-muted);
		--paper: var(--color-bg);
		--paper-warm: var(--color-bg-subtle);
		--border: var(--color-border);

		/* Fallback values for notice messages */
		--color-success-bg: #ecfdf5;
		--color-success-border: #a7f3d0;
		--color-success-text: #065f46;
		--color-error-bg: #fef2f2;
		--color-error-border: #fecaca;
		--color-error-text: #991b1b;
	}
</style>
