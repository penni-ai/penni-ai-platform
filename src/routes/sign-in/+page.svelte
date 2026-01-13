<script lang="ts">
import { goto } from '$app/navigation';
import Logo from '$lib/components/Logo.svelte';
import { FirebaseError } from 'firebase/app';
import { GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup, signOut } from 'firebase/auth';
import { firebaseAuth } from '$lib/firebase/client';

let { data } = $props();

let email = $state('');
let password = $state('');
let remember = $state(true);
let loading = $state(false);
let errorMessage = $state<string | null>(null);

const verifiedNotice = data.verifiedNotice;

const TEST_USER = {
	email: 'search-tester@example.com',
	password: 'TestPass123!'
};

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
	<title>Sign In - Penny</title>
</svelte:head>

<div class="auth-page">
	<header class="auth-header">
		<a href="/" aria-label="Penny home">
			<Logo size="md" />
		</a>
	</header>

	<main class="auth-main">
		<div class="auth-container">
			<div class="auth-title-section">
				<h1 class="auth-title">Welcome back</h1>
				<p class="auth-subtitle">Sign in to continue your influencer outreach</p>
			</div>

			{#if verifiedNotice}
				<div class="notice notice-success">
					Your email has been verified. You can sign in now.
				</div>
			{/if}

			{#if errorMessage}
				<div class="notice notice-error">
					{errorMessage}
				</div>
			{/if}

			<button
				type="button"
				class="google-btn"
				onclick={signInWithGoogle}
				disabled={loading}
			>
				<svg viewBox="0 0 24 24" class="google-icon">
					<path fill="#4285F4" d="M21.805 10.023h-9.18v3.955h5.3c-.229 1.248-.917 2.304-1.955 3.005l3.155 2.447c1.843-1.699 2.881-4.201 2.881-7.187 0-.692-.069-1.365-.201-2.02z" />
					<path fill="#34A853" d="M12.625 21.5c2.479 0 4.56-.82 6.08-2.223l-3.156-2.447c-.874.586-1.989.93-3.21.93-2.464 0-4.555-1.664-5.298-3.907l-3.248 2.522C5.534 19.632 8.825 21.5 12.625 21.5z" />
					<path fill="#FBBC05" d="M7.327 13.853a5.983 5.983 0 0 1-.314-1.853c0-.646.114-1.27.314-1.853l-3.25-2.523A10.248 10.248 0 0 0 3.5 12c0 1.667.402 3.246 1.13 4.576l3.248-2.723z" />
					<path fill="#EA4335" d="M12.625 6.25a5.56 5.56 0 0 1 3.922 1.495l2.94-2.94C17.192 3.273 14.9 2.25 12.625 2.25 8.825 2.25 5.534 4.118 3.93 7.147l3.248 2.523C7.07 7.427 9.161 6.25 12.625 6.25z" />
				</svg>
				{loading ? 'Opening Google...' : 'Continue with Google'}
			</button>

			<div class="divider">
				<span class="divider-text">or sign in with email</span>
			</div>

			<form class="auth-form" onsubmit={handleSubmit}>
				<div class="form-field">
					<label for="signin-email" class="field-label">Email</label>
					<input
						id="signin-email"
						type="email"
						required
						placeholder="you@example.com"
						class="field-input"
						bind:value={email}
					/>
				</div>

				<div class="form-field">
					<label for="signin-password" class="field-label">Password</label>
					<input
						id="signin-password"
						type="password"
						required
						placeholder="Enter your password"
						class="field-input"
						bind:value={password}
					/>
				</div>

				<div class="form-row">
					<label class="checkbox-field">
						<input
							type="checkbox"
							class="checkbox-input"
							bind:checked={remember}
						/>
						<span class="checkbox-label">Remember me</span>
					</label>
					<a href="/forgot-password" class="link-muted">
						Forgot password?
					</a>
				</div>

				<button
					type="submit"
					class="submit-btn"
					disabled={loading}
				>
					{loading ? 'Signing in...' : 'Sign in'}
				</button>

				<button
					type="button"
					class="test-btn"
					onclick={loginAsTestUser}
					disabled={loading}
				>
					Use test account
				</button>
			</form>

			<p class="auth-footer-text">
				Don't have an account?
				<a href="/sign-up" class="link-coral">Sign up</a>
			</p>
		</div>
	</main>
</div>

<style>
	.auth-page {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background-color: var(--paper, #fafaf9);
		font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
	}

	.auth-header {
		display: flex;
		justify-content: center;
		padding: 2rem 1.5rem;
	}

	.auth-main {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem 1.5rem 4rem;
	}

	.auth-container {
		width: 100%;
		max-width: 400px;
	}

	.auth-title-section {
		text-align: center;
		margin-bottom: 3rem;
	}

	.auth-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: clamp(2.5rem, 6vw, 3.5rem);
		font-weight: 400;
		line-height: 1.1;
		color: var(--color-text, #1a1a1a);
		margin: 0 0 0.75rem 0;
	}

	.auth-subtitle {
		font-size: 1.0625rem;
		line-height: 1.5;
		color: var(--color-text-secondary, #4a4a4a);
		margin: 0;
	}

	.notice {
		padding: 1rem 1.25rem;
		margin-bottom: 2rem;
		font-size: 0.9375rem;
		line-height: 1.5;
		border-left: 3px solid;
	}

	.notice-success {
		background-color: #f0fdf4;
		border-color: #22c55e;
		color: #166534;
	}

	.notice-error {
		background-color: #fef2f2;
		border-color: #ef4444;
		color: #991b1b;
	}

	.google-btn {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 0.875rem 1.5rem;
		font-family: 'DM Sans', sans-serif;
		font-size: 1rem;
		font-weight: 500;
		color: var(--color-text, #1a1a1a);
		background-color: white;
		border: 1px solid var(--color-border, #e8e6e3);
		border-radius: 2px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.google-btn:hover:not(:disabled) {
		border-color: var(--color-text-secondary, #4a4a4a);
	}

	.google-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.google-icon {
		width: 1.25rem;
		height: 1.25rem;
	}

	.divider {
		position: relative;
		text-align: center;
		margin: 2.5rem 0;
	}

	.divider::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: 1px;
		background-color: var(--color-border, #e8e6e3);
	}

	.divider-text {
		position: relative;
		display: inline-block;
		padding: 0 1rem;
		background-color: var(--paper, #fafaf9);
		font-size: 0.8125rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted, #8a8a8a);
	}

	.auth-form {
		display: flex;
		flex-direction: column;
		gap: 1.75rem;
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.field-label {
		font-size: 0.8125rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-text-muted, #8a8a8a);
	}

	.field-input {
		width: 100%;
		padding: 0.75rem 0;
		font-family: 'DM Sans', sans-serif;
		font-size: 1.0625rem;
		color: var(--color-text, #1a1a1a);
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--color-border, #e8e6e3);
		border-radius: 0;
		transition: border-color 0.2s ease;
	}

	.field-input::placeholder {
		color: var(--color-text-muted, #8a8a8a);
	}

	.field-input:focus {
		outline: none;
		border-bottom-color: var(--color-primary, #FF6F61);
	}

	.form-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.checkbox-field {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
	}

	.checkbox-input {
		width: 1rem;
		height: 1rem;
		accent-color: var(--color-primary, #FF6F61);
		cursor: pointer;
	}

	.checkbox-label {
		font-size: 0.9375rem;
		color: var(--color-text-secondary, #4a4a4a);
	}

	.link-muted {
		font-size: 0.9375rem;
		color: var(--color-text-muted, #8a8a8a);
		text-decoration: none;
		transition: color 0.2s ease;
	}

	.link-muted:hover {
		color: var(--color-primary, #FF6F61);
	}

	.submit-btn {
		width: 100%;
		padding: 1rem 1.5rem;
		font-family: 'DM Sans', sans-serif;
		font-size: 1rem;
		font-weight: 600;
		color: white;
		background-color: var(--color-primary, #FF6F61);
		border: none;
		border-radius: 2px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.submit-btn:hover:not(:disabled) {
		opacity: 0.9;
		transform: translateY(-1px);
	}

	.submit-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.test-btn {
		width: 100%;
		padding: 0.75rem 1.5rem;
		font-family: 'DM Sans', sans-serif;
		font-size: 0.9375rem;
		font-weight: 500;
		color: var(--color-text-muted, #8a8a8a);
		background: transparent;
		border: 1px solid var(--color-border, #e8e6e3);
		border-radius: 2px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.test-btn:hover:not(:disabled) {
		border-color: var(--color-text-secondary, #4a4a4a);
		color: var(--color-text-secondary, #4a4a4a);
	}

	.test-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.auth-footer-text {
		text-align: center;
		margin-top: 3rem;
		font-size: 0.9375rem;
		color: var(--color-text-secondary, #4a4a4a);
	}

	.link-coral {
		color: var(--color-primary, #FF6F61);
		font-weight: 600;
		text-decoration: none;
		transition: opacity 0.2s ease;
	}

	.link-coral:hover {
		opacity: 0.8;
	}

	@media (max-width: 640px) {
		.auth-header {
			padding: 1.5rem 1rem;
		}

		.auth-main {
			padding: 1.5rem 1.25rem 3rem;
		}

		.auth-title {
			font-size: 2.25rem;
		}

		.auth-title-section {
			margin-bottom: 2.5rem;
		}
	}
</style>
