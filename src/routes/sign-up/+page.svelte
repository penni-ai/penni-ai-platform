<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
	import { createUserWithEmailAndPassword, sendEmailVerification, signOut, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
	import { firebaseAuth } from '$lib/firebase/client';
	import { goto } from '$app/navigation';
	import { FirebaseError } from 'firebase/app';

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

	function buildGoogleProvider() {
		const provider = new GoogleAuthProvider();
		provider.setCustomParameters({ prompt: 'select_account' });
		return provider;
	}

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

	async function signUpWithGoogle() {
		if (loading) return;
		errorMessage = null;
		loading = true;

		try {
			const provider = buildGoogleProvider();
			const result = await signInWithPopup(firebaseAuth, provider);
			const idToken = await result.user.getIdToken(true);
			await createSession(idToken, true);
		} catch (error) {
			console.error('[auth] google sign-up failed', error);
			await signOut(firebaseAuth);
			if (error instanceof FirebaseError) {
				if (error.code === 'auth/popup-closed-by-user') {
					errorMessage = 'Google sign-up was closed before completion. Please try again.';
				} else {
					errorMessage = error.message;
				}
			} else if (error instanceof Error) {
				errorMessage = error.message;
			} else {
				errorMessage = 'Unexpected error during Google sign-up.';
			}
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head>
	<title>Sign Up - Penny</title>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
	<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet">
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
				<h1 class="auth-title">Create Your Account</h1>
				<p class="auth-subtitle">Join Penny and start building meaningful connections.</p>
			</div>

			{#if errorMessage}
				<div class="notice notice-error">
					{errorMessage}
				</div>
			{/if}

			<button
				type="button"
				class="google-btn"
				onclick={signUpWithGoogle}
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
				<span class="divider-text">or sign up with email</span>
			</div>

			<form class="auth-form" onsubmit={handleSubmit}>
				<div class="form-field">
					<label for="signup-email" class="field-label">Email Address</label>
					<input
						id="signup-email"
						type="email"
						required
						placeholder="your@email.com"
						class="field-input"
						bind:value={email}
					/>
				</div>

				<div class="form-field">
					<label for="signup-password" class="field-label">Password</label>
					<div class="password-wrapper">
						<input
							id="signup-password"
							type={passwordInputType()}
							required
							minlength="8"
							placeholder="At least 8 characters"
							class="field-input"
							bind:value={password}
						/>
						<button
							type="button"
							class="password-toggle"
							onclick={() => (showPassword = !showPassword)}
							aria-label={showPassword ? 'Hide password' : 'Show password'}
							aria-pressed={showPassword}
						>
							{#if showPassword}
								<svg class="toggle-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.45 10.45 0 0 0 1.75 12c2.205 4.478 6.656 7.5 11.25 7.5 1.625 0 3.187-.337 4.622-.95m3.628-3.073A10.478 10.478 0 0 0 22.25 12c-2.205-4.478-6.656-7.5-11.25-7.5a11.42 11.42 0 0 0-4.258.79" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M9.53 9.53a3 3 0 0 0 4.24 4.24" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 0 0-3-3" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M3 3l18 18" />
								</svg>
							{:else}
								<svg class="toggle-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7Z" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
								</svg>
							{/if}
						</button>
					</div>
				</div>

				<div class="form-field">
					<label for="signup-confirm" class="field-label">Confirm Password</label>
					<div class="password-wrapper">
						<input
							id="signup-confirm"
							type={confirmInputType()}
							required
							minlength="8"
							placeholder="Re-enter your password"
							class="field-input"
							bind:value={confirmPassword}
						/>
						<button
							type="button"
							class="password-toggle"
							onclick={() => (showConfirmPassword = !showConfirmPassword)}
							aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
							aria-pressed={showConfirmPassword}
						>
							{#if showConfirmPassword}
								<svg class="toggle-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.45 10.45 0 0 0 1.75 12c2.205 4.478 6.656 7.5 11.25 7.5 1.625 0 3.187-.337 4.622-.95m3.628-3.073A10.478 10.478 0 0 0 22.25 12c-2.205-4.478-6.656-7.5-11.25-7.5a11.42 11.42 0 0 0-4.258.79" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M9.53 9.53a3 3 0 0 0 4.24 4.24" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 0 0-3-3" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M3 3l18 18" />
								</svg>
							{:else}
								<svg class="toggle-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7Z" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
								</svg>
							{/if}
						</button>
					</div>
				</div>

				<label class="checkbox-field">
					<input type="checkbox" bind:checked={termsAccepted} class="checkbox-input" />
					<span class="checkbox-label">
						I agree to the <a href="/terms" class="link-text">Terms of Service</a> and <a href="/privacy" class="link-text">Privacy Policy</a>.
					</span>
				</label>

				<button
					type="submit"
					class="submit-btn"
					disabled={loading || !canSubmit()}
				>
					{loading ? 'Creating account...' : 'Create Account'}
				</button>
			</form>

			<p class="auth-footer-text">
				Already have an account?
				<a href="/sign-in" class="link-coral">Sign in</a>
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
		font-size: clamp(2.25rem, 6vw, 3rem);
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

	.password-wrapper {
		position: relative;
	}

	.password-toggle {
		position: absolute;
		right: 0;
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.5rem;
		color: var(--color-text-muted, #8a8a8a);
		transition: color 0.2s ease;
	}

	.password-toggle:hover {
		color: var(--color-text-secondary, #4a4a4a);
	}

	.toggle-icon {
		width: 1.25rem;
		height: 1.25rem;
		display: block;
	}

	.checkbox-field {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		cursor: pointer;
	}

	.checkbox-input {
		margin-top: 0.125rem;
		width: 1rem;
		height: 1rem;
		accent-color: var(--color-primary, #FF6F61);
		cursor: pointer;
		flex-shrink: 0;
	}

	.checkbox-label {
		font-size: 0.9375rem;
		line-height: 1.5;
		color: var(--color-text-secondary, #4a4a4a);
	}

	.link-text {
		color: var(--color-text, #1a1a1a);
		font-weight: 500;
		text-decoration: underline;
		text-underline-offset: 2px;
		transition: color 0.2s ease;
	}

	.link-text:hover {
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
		margin-top: 0.5rem;
	}

	.submit-btn:hover:not(:disabled) {
		opacity: 0.9;
		transform: translateY(-1px);
	}

	.submit-btn:disabled {
		opacity: 0.5;
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
			font-size: 2rem;
		}

		.auth-title-section {
			margin-bottom: 2.5rem;
		}
	}
</style>
