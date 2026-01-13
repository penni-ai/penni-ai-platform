<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
</script>

<svelte:head>
	<title>Sign Out - Penny</title>
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
				<svg class="logout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
				</svg>
			</div>

			<h1 class="auth-title">You've signed out</h1>

			<p class="auth-subtitle">
				Your session has ended. Thank you for using Penny.
			</p>

			<div class="action-buttons">
				<a href="/" class="btn-primary">
					Return home
				</a>
				<a href="/sign-in" class="btn-secondary">
					Sign in again
				</a>
			</div>
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
		color: var(--color-primary, #FF6F61);
	}

	.logout-icon {
		width: 3rem;
		height: 3rem;
	}

	.auth-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: clamp(2rem, 6vw, 2.5rem);
		font-weight: 400;
		line-height: 1.1;
		color: var(--color-text, #1a1a1a);
		margin: 0 0 1rem 0;
	}

	.auth-subtitle {
		font-size: 1.0625rem;
		line-height: 1.6;
		color: var(--color-text-secondary, #4a4a4a);
		margin: 0 0 2.5rem 0;
	}

	.action-buttons {
		display: flex;
		flex-direction: column;
		gap: 1rem;
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
		text-decoration: none;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-secondary:hover {
		border-color: var(--color-text-secondary, #4a4a4a);
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

		.logout-icon {
			width: 2.5rem;
			height: 2.5rem;
		}
	}

	@media (min-width: 640px) {
		.action-buttons {
			flex-direction: row;
			justify-content: center;
			gap: 1rem;
		}

		.btn-primary,
		.btn-secondary {
			min-width: 160px;
		}
	}
</style>
