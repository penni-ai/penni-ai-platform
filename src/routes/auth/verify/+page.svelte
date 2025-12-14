<script lang="ts">
	import { onMount } from 'svelte';
	import { applyActionCode } from 'firebase/auth';
	import { firebaseAuth } from '$lib/firebase/client';
	import { goto } from '$app/navigation';
	import Logo from '$lib/components/Logo.svelte';

	let { data } = $props();

	let status = $state<'pending' | 'success' | 'error'>('pending');
	let message = $state('Verifying your email...');

	// Get params from server load function (prevents hydration mismatch)
	const mode = data.mode;
	const oobCode = data.oobCode;

	onMount(async () => {
		try {
			if (mode !== 'verifyEmail' || !oobCode) {
				throw new Error('Verification link is invalid or expired.');
			}

			await applyActionCode(firebaseAuth, oobCode);
			try {
				if (firebaseAuth.currentUser) {
					await firebaseAuth.currentUser.reload();
					if (firebaseAuth.currentUser.emailVerified) {
						const idToken = await firebaseAuth.currentUser.getIdToken(true);
						await fetch('/api/public/session', {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json'
							},
							body: JSON.stringify({ idToken, remember: true })
						});
					}
				}
			} catch (sessionError) {
				console.warn('[auth] session refresh after verification failed', sessionError);
			}
			status = 'success';
			message = 'Email verified! You can sign in now.';
			setTimeout(() => {
				goto('/sign-in?verified=1');
			}, 1500);
		} catch (error) {
			status = 'error';
			message =
				error instanceof Error ? error.message : 'We could not verify your email. Please request a new link.';
		}
	});
</script>

<svelte:head>
	<title>Email Verification - Penny</title>
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
			<div class="icon-wrapper">
				{#if status === 'pending'}
					<svg class="status-icon spinning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
					</svg>
				{:else if status === 'success'}
					<svg class="status-icon success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
					</svg>
				{:else}
					<svg class="status-icon error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
					</svg>
				{/if}
			</div>

			<h1 class="auth-title">Email Verification</h1>

			<p class="status-message" class:success={status === 'success'} class:error={status === 'error'}>
				{message}
			</p>

			{#if status === 'error'}
				<a href="/sign-up/confirm" class="btn-primary">
					Request another link
				</a>
			{/if}

			{#if status === 'success'}
				<p class="redirect-hint">Redirecting you to sign in...</p>
			{/if}
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
		text-align: center;
	}

	.icon-wrapper {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 4rem;
		height: 4rem;
		margin-bottom: 1.5rem;
	}

	.status-icon {
		width: 3rem;
		height: 3rem;
	}

	.status-icon.spinning {
		color: var(--color-text-muted, #8a8a8a);
		animation: spin 1.5s linear infinite;
	}

	.status-icon.success {
		color: #22c55e;
	}

	.status-icon.error {
		color: #ef4444;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.auth-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: clamp(2rem, 6vw, 2.5rem);
		font-weight: 400;
		line-height: 1.1;
		color: var(--color-text, #1a1a1a);
		margin: 0 0 1rem 0;
	}

	.status-message {
		font-size: 1.0625rem;
		line-height: 1.6;
		color: var(--color-text-secondary, #4a4a4a);
		margin: 0 0 2rem 0;
	}

	.status-message.success {
		color: #166534;
	}

	.status-message.error {
		color: #991b1b;
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 1rem 2rem;
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

	.redirect-hint {
		font-size: 0.875rem;
		color: var(--color-text-muted, #8a8a8a);
		margin: 0;
	}

	@media (max-width: 640px) {
		.auth-header {
			padding: 1.5rem 1rem;
		}

		.auth-main {
			padding: 1.5rem 1.25rem 3rem;
		}

		.auth-title {
			font-size: 1.75rem;
		}

		.icon-wrapper {
			width: 3.5rem;
			height: 3.5rem;
		}

		.status-icon {
			width: 2.5rem;
			height: 2.5rem;
		}
	}
</style>
