<script lang="ts">
	import { page } from '$app/stores';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: any } = $props();
	const pathname = $derived($page.url.pathname);
	const adminUser = $derived(data.adminUser);

	const isActive = (path: string) =>
		pathname === path || (path !== '/admin' && pathname.startsWith(`${path}/`));
</script>

<svelte:head>
	<title>Admin - Penny Platform</title>
</svelte:head>

<div class="admin-shell">
	<header class="admin-header">
		<div>
			<p class="admin-eyebrow">Admin Console</p>
			<h1>Operations</h1>
			<p class="admin-subtitle">Monitor pipeline runs, users, and billing.</p>
		</div>
		<div class="admin-user">
			<span>{adminUser?.email ?? adminUser?.uid}</span>
		</div>
	</header>

	<nav class="admin-nav">
		<a class:active={isActive('/admin')} href="/admin">Overview</a>
		<a class:active={isActive('/admin/pipeline-runs')} href="/admin/pipeline-runs">Pipeline Runs</a>
	</nav>

	<main class="admin-content">
		{@render children()}
	</main>
</div>

<style>
	.admin-shell {
		display: flex;
		flex-direction: column;
		gap: 24px;
		padding: 32px 40px 64px;
	}

	.admin-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 24px;
		border-bottom: 1px solid rgba(15, 23, 42, 0.08);
		padding-bottom: 16px;
	}

	.admin-eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 11px;
		color: rgba(15, 23, 42, 0.5);
		margin: 0 0 4px 0;
	}

	.admin-header h1 {
		margin: 0;
		font-size: 28px;
		color: #0f172a;
	}

	.admin-subtitle {
		margin: 6px 0 0 0;
		color: rgba(15, 23, 42, 0.6);
	}

	.admin-user {
		padding: 8px 12px;
		border-radius: 999px;
		background: rgba(15, 23, 42, 0.05);
		font-size: 13px;
		color: rgba(15, 23, 42, 0.7);
	}

	.admin-nav {
		display: flex;
		gap: 12px;
	}

	.admin-nav a {
		padding: 8px 14px;
		border-radius: 999px;
		font-size: 14px;
		color: rgba(15, 23, 42, 0.7);
		text-decoration: none;
		background: rgba(15, 23, 42, 0.04);
		transition: all 0.2s ease;
	}

	.admin-nav a.active {
		background: #0f172a;
		color: #fff;
	}

	.admin-content {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	@media (max-width: 720px) {
		.admin-shell {
			padding: 24px 20px 48px;
		}

		.admin-header {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
