<script lang="ts">
	import Button from '$lib/components/Button.svelte';
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
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
	<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet">
</svelte:head>

<div class="editorial-signup">
	<header class="header">
		<a href="/" aria-label="Penny home">
			<Logo size="md" />
		</a>
	</header>

	<main class="main-content">
		<div class="form-container">
			<div class="title-section">
				<h1 class="page-title">Create Your Account</h1>
				<p class="page-subtitle">Join Penny and start building meaningful connections.</p>
			</div>

			<form class="signup-form" onsubmit={handleSubmit}>
				{#if errorMessage}
					<div class="error-message">{errorMessage}</div>
				{/if}

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
								<svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.45 10.45 0 0 0 1.75 12c2.205 4.478 6.656 7.5 11.25 7.5 1.625 0 3.187-.337 4.622-.95m3.628-3.073A10.478 10.478 0 0 0 22.25 12c-2.205-4.478-6.656-7.5-11.25-7.5a11.42 11.42 0 0 0-4.258.79" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M9.53 9.53a3 3 0 0 0 4.24 4.24" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 0 0-3-3" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M3 3l18 18" />
								</svg>
							{:else}
								<svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
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
								<svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.45 10.45 0 0 0 1.75 12c2.205 4.478 6.656 7.5 11.25 7.5 1.625 0 3.187-.337 4.622-.95m3.628-3.073A10.478 10.478 0 0 0 22.25 12c-2.205-4.478-6.656-7.5-11.25-7.5a11.42 11.42 0 0 0-4.258.79" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M9.53 9.53a3 3 0 0 0 4.24 4.24" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 0 0-3-3" />
									<path stroke-linecap="round" stroke-linejoin="round" d="M3 3l18 18" />
								</svg>
							{:else}
								<svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
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
						I agree to the <a href="/terms" class="link">Terms of Service</a> and <a href="/privacy" class="link">Privacy Policy</a>.
					</span>
				</label>

				<button
					type="submit"
					class="submit-button"
					disabled={loading || !canSubmit()}
					data-can-submit={canSubmit()}
					data-terms={termsAccepted}
					data-password-ok={isValidPassword(password)}
					data-match={passwordsMatch(password, confirmPassword)}
				>
					{loading ? 'Creating account…' : 'Create Account'}
				</button>
			</form>

			<div class="divider">
				<div class="divider-line"></div>
				<span class="divider-text">or continue with</span>
			</div>

			<Button
				variant="outline"
				type="button"
				class="google-button"
				onclick={signUpWithGoogle}
				disabled={loading}
			>
				<span class="google-icon">
					<svg viewBox="0 0 24 24" class="icon">
						<path fill="#4285F4" d="M21.805 10.023h-9.18v3.955h5.3c-.229 1.248-.917 2.304-1.955 3.005l3.155 2.447c1.843-1.699 2.881-4.201 2.881-7.187 0-.692-.069-1.365-.201-2.02z" />
						<path fill="#34A853" d="M12.625 21.5c2.479 0 4.56-.82 6.08-2.223l-3.156-2.447c-.874.586-1.989.93-3.21.93-2.464 0-4.555-1.664-5.298-3.907l-3.248 2.522C5.534 19.632 8.825 21.5 12.625 21.5z" />
						<path fill="#FBBC05" d="M7.327 13.853a5.983 5.983 0 0 1-.314-1.853c0-.646.114-1.27.314-1.853l-3.25-2.523A10.248 10.248 0 0 0 3.5 12c0 1.667.402 3.246 1.13 4.576l3.248-2.723z" />
						<path fill="#EA4335" d="M12.625 6.25a5.56 5.56 0 0 1 3.922 1.495l2.94-2.94C17.192 3.273 14.9 2.25 12.625 2.25 8.825 2.25 5.534 4.118 3.93 7.147l3.248 2.523C7.07 7.427 9.161 6.25 12.625 6.25z" />
					</svg>
				</span>
				{loading ? 'Opening Google…' : 'Continue with Google'}
			</Button>

			<p class="signin-link">
				Already have an account?
				<a href="/sign-in" class="link-coral">Sign in</a>
			</p>
		</div>
	</main>
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
		--color-error-bg: #fef2f2;
		--color-error-border: #fecaca;
		--color-error-text: #991b1b;
		--color-primary-hover: #ff5a4a;
		--color-border-hover: var(--ink-muted);
	}

	.editorial-signup {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background-color: var(--paper);
		font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2.5rem 1.5rem;
	}

	.main-content {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem 1.5rem;
	}

	.form-container {
		width: 100%;
		max-width: 480px;
		background: var(--color-bg-elevated);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 3rem 2.5rem;
	}

	.title-section {
		text-align: center;
		margin-bottom: 2.5rem;
	}

	.page-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 2.5rem;
		font-weight: 400;
		line-height: 1.2;
		color: var(--ink);
		margin: 0 0 0.75rem 0;
	}

	.page-subtitle {
		font-size: 1rem;
		line-height: 1.5;
		color: var(--ink-light);
		margin: 0;
	}

	.signup-form {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		margin-bottom: 2rem;
	}

	.error-message {
		padding: 0.875rem 1rem;
		background-color: var(--color-error-bg);
		border: 1px solid var(--color-error-border);
		border-radius: 8px;
		color: var(--color-error-text);
		font-size: 0.875rem;
		line-height: 1.5;
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.field-label {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--ink);
		letter-spacing: -0.01em;
	}

	.field-input {
		width: 100%;
		padding: 0.75rem 1rem;
		font-family: 'DM Sans', sans-serif;
		font-size: 1rem;
		color: var(--ink);
		background-color: var(--color-bg-elevated);
		border: 1px solid var(--border);
		border-radius: 8px;
		transition: all 0.2s ease;
	}

	.field-input::placeholder {
		color: var(--ink-muted);
	}

	.field-input:focus {
		outline: none;
		border-color: var(--coral);
		box-shadow: 0 0 0 3px rgba(255, 111, 97, 0.1);
	}

	.password-wrapper {
		position: relative;
	}

	.password-toggle {
		position: absolute;
		right: 1rem;
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		color: var(--ink-muted);
		transition: color 0.2s ease;
	}

	.password-toggle:hover {
		color: var(--ink-light);
	}

	.password-toggle .icon {
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
		cursor: pointer;
		accent-color: var(--coral);
		flex-shrink: 0;
	}

	.checkbox-label {
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--ink-light);
	}

	.link {
		color: var(--ink);
		font-weight: 500;
		text-decoration: underline;
		text-underline-offset: 2px;
		transition: color 0.2s ease;
	}

	.link:hover {
		color: var(--coral);
	}

	.submit-button {
		width: 100%;
		padding: 0.875rem 1.5rem;
		font-family: 'DM Sans', sans-serif;
		font-size: 1rem;
		font-weight: 600;
		color: white;
		background-color: var(--coral);
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s ease;
		margin-top: 0.5rem;
	}

	.submit-button:hover:not(:disabled) {
		background-color: var(--color-primary-hover);
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(255, 111, 97, 0.25);
	}

	.submit-button:active:not(:disabled) {
		transform: translateY(0);
	}

	.submit-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.divider {
		position: relative;
		text-align: center;
		margin: 2rem 0;
	}

	.divider-line {
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: 1px;
		background-color: var(--border);
	}

	.divider-text {
		position: relative;
		display: inline-block;
		padding: 0 1rem;
		background-color: var(--color-bg-elevated);
		font-size: 0.75rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-muted);
	}

	:global(.google-button) {
		width: 100%;
		justify-content: center;
		border: 1px solid var(--border);
		background-color: var(--color-bg-elevated);
		color: var(--ink);
		border-radius: 8px;
		font-family: 'DM Sans', sans-serif;
		font-weight: 500;
		transition: all 0.2s ease;
	}

	:global(.google-button:hover:not(:disabled)) {
		background-color: var(--paper-warm);
		border-color: var(--color-border-hover);
	}

	.google-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-right: 0.5rem;
	}

	.google-icon .icon {
		width: 1.25rem;
		height: 1.25rem;
	}

	.signin-link {
		text-align: center;
		font-size: 0.875rem;
		color: var(--ink-light);
		margin-top: 2rem;
	}

	.link-coral {
		color: var(--coral);
		font-weight: 600;
		text-decoration: none;
		transition: color 0.2s ease;
	}

	.link-coral:hover {
		color: var(--color-primary-hover);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	@media (max-width: 640px) {
		.form-container {
			padding: 2rem 1.5rem;
		}

		.page-title {
			font-size: 2rem;
		}

		.header {
			padding: 1.5rem 1rem;
		}
	}
</style>
