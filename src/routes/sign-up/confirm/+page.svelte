<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';

	let { data } = $props();
	const email = (data.email ?? '') as string;
	let resendMessage = $state<string | null>(null);
	let resendError = $state<string | null>(null);
	let isResending = $state(false);

	async function resendConfirmation() {
		if (!email) {
			resendError = 'Email address missing from request.';
			return;
		}

		resendError = null;
		resendMessage = null;
		isResending = true;
		try {
			const response = await fetch('/api/public/auth/send-verification', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email })
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw new Error(payload?.error ?? 'Unable to send verification email.');
			}
			const info = payload?.link ? `Email sent. Emulator preview link: ${payload.link}` : 'Email sent. Please check your inbox.';
			resendMessage = info;
		} catch (error) {
			resendError =
				error instanceof Error ? error.message : 'Unable to resend verification email. Try again in a moment.';
		} finally {
			isResending = false;
		}
	}
</script>

<svelte:head>
	<title>Confirm Your Email - Penny</title>
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
				<div class="icon-wrapper">
					<svg class="mail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
					</svg>
				</div>
				<h1 class="auth-title">Confirm your email</h1>
				<p class="auth-subtitle">
					{#if email}
						We sent a confirmation email to <strong>{email}</strong>. Please click the link inside to activate your account.
					{:else}
						We sent a confirmation email. Please locate the verification message in your inbox and click the link inside to activate your account.
					{/if}
				</p>
			</div>

			<div class="progress-section">
				<div class="progress-bar">
					<div class="progress-fill"></div>
				</div>
				<p class="progress-hint">
					Keep this tab open while you verify. Once confirmed, return to sign in.
				</p>
			</div>

			{#if resendMessage}
				<div class="notice notice-success">
					{resendMessage}
				</div>
			{/if}

			{#if resendError}
				<div class="notice notice-error">
					{resendError}
				</div>
			{/if}

			<div class="action-buttons">
				<a href="/sign-in" class="btn-primary">
					I've verified, sign me in
				</a>
				<button
					type="button"
					class="btn-secondary"
					onclick={resendConfirmation}
					disabled={isResending}
				>
					{isResending ? 'Sending...' : 'Resend email'}
				</button>
			</div>

			<p class="help-text">
				Didn't receive anything? Check your spam folder or add support@penny.ai to your contacts, then resend.
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
		max-width: 480px;
		text-align: center;
	}

	.auth-title-section {
		margin-bottom: 3rem;
	}

	.icon-wrapper {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 4rem;
		height: 4rem;
		margin-bottom: 1.5rem;
		color: var(--color-primary, #FF6F61);
	}

	.mail-icon {
		width: 3rem;
		height: 3rem;
	}

	.auth-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: clamp(2.25rem, 6vw, 3rem);
		font-weight: 400;
		line-height: 1.1;
		color: var(--color-text, #1a1a1a);
		margin: 0 0 1rem 0;
	}

	.auth-subtitle {
		font-size: 1.0625rem;
		line-height: 1.6;
		color: var(--color-text-secondary, #4a4a4a);
		margin: 0;
	}

	.auth-subtitle strong {
		color: var(--color-text, #1a1a1a);
		font-weight: 500;
	}

	.progress-section {
		margin-bottom: 2.5rem;
	}

	.progress-bar {
		height: 3px;
		background-color: var(--color-border, #e8e6e3);
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		width: 50%;
		background-color: var(--color-primary, #FF6F61);
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	.progress-hint {
		margin-top: 1rem;
		font-size: 0.875rem;
		color: var(--color-text-muted, #8a8a8a);
	}

	.notice {
		padding: 1rem 1.25rem;
		margin-bottom: 2rem;
		font-size: 0.9375rem;
		line-height: 1.5;
		text-align: left;
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

	.action-buttons {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 1rem 1.5rem;
		font-family: 'DM Sans', sans-serif;
		font-size: 1rem;
		font-weight: 600;
		color: white;
		background-color: var(--color-primary, #FF6F61);
		border: none;
		border-radius: 2px;
		text-decoration: none;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-primary:hover {
		opacity: 0.9;
		transform: translateY(-1px);
	}

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.875rem 1.5rem;
		font-family: 'DM Sans', sans-serif;
		font-size: 1rem;
		font-weight: 500;
		color: var(--color-text, #1a1a1a);
		background: transparent;
		border: 1px solid var(--color-border, #e8e6e3);
		border-radius: 2px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-secondary:hover:not(:disabled) {
		border-color: var(--color-text-secondary, #4a4a4a);
	}

	.btn-secondary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.help-text {
		font-size: 0.875rem;
		line-height: 1.6;
		color: var(--color-text-muted, #8a8a8a);
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

		.icon-wrapper {
			width: 3.5rem;
			height: 3.5rem;
		}

		.mail-icon {
			width: 2.5rem;
			height: 2.5rem;
		}
	}

	@media (min-width: 640px) {
		.action-buttons {
			flex-direction: row;
			justify-content: center;
		}

		.btn-primary,
		.btn-secondary {
			flex: 1;
			max-width: 200px;
		}
	}
</style>
