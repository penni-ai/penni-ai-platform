<script lang="ts">
	import { page } from '$app/stores';

	let { children } = $props();

	const currentPath = $derived($page.url.pathname);
	const isAccount = $derived(currentPath === '/my-account' || currentPath === '/my-account/');
	const isBilling = $derived(currentPath === '/my-account/billing');
	const isGmail = $derived(currentPath === '/my-account/gmail');
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
	<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet">
</svelte:head>

<div class="settings-layout">
	<div class="settings-container">
		<!-- Tab Navigation -->
		<nav class="settings-tabs">
			<a href="/my-account" class="tab" class:active={isAccount}>
				<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
				</svg>
				Account
			</a>
			<a href="/my-account/billing" class="tab" class:active={isBilling}>
				<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
				</svg>
				Billing
			</a>
			<a href="/my-account/gmail" class="tab" class:active={isGmail}>
				<svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
				</svg>
				Gmail
			</a>
		</nav>

		<!-- Content Area -->
		<div class="settings-content">
			{@render children()}
		</div>
	</div>
</div>

<style>
	.settings-layout {
		min-height: 100%;
		background: var(--color-bg, #fafaf9);
		font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
	}

	.settings-container {
		width: 100%;
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 2rem;
	}

	.settings-tabs {
		display: flex;
		gap: 0.5rem;
		padding: 1.5rem 0;
		border-bottom: 1px solid var(--color-border, #e8e6e3);
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.25rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--color-text-muted, #8a8a8a);
		text-decoration: none;
		border-radius: 6px;
		transition: all 0.2s ease;
	}

	.tab:hover {
		color: var(--color-text-secondary, #4a4a4a);
		background: var(--color-bg-elevated, rgba(0, 0, 0, 0.03));
	}

	.tab.active {
		color: var(--color-text, #1a1a1a);
		background: var(--color-bg-elevated, rgba(0, 0, 0, 0.05));
	}

	.tab-icon {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
	}

	.settings-content {
		padding: 2.5rem 0 4rem;
	}

	@media (max-width: 768px) {
		.settings-container {
			padding: 0 1.25rem;
		}

		.settings-tabs {
			gap: 0.25rem;
			padding: 1rem 0;
			overflow-x: auto;
			-webkit-overflow-scrolling: touch;
		}

		.tab {
			padding: 0.625rem 1rem;
			font-size: 0.8125rem;
			white-space: nowrap;
		}

		.tab-icon {
			width: 16px;
			height: 16px;
		}

		.settings-content {
			padding: 1.5rem 0 3rem;
		}
	}
</style>
