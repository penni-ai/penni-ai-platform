<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import type { BrightdataCacheRecord, BrightdataCacheStats } from '$lib/server/admin/brightdata-cache';

	let { data }: { data: PageData } = $props();

	let lookupUrl = $state(data.lookupUrl ?? '');
	let entries = $state<BrightdataCacheRecord[]>(data.entries ?? []);
	let nextCursor = $state<string | null>(data.nextCursor ?? null);
	let stats = $state<BrightdataCacheStats | null>(data.stats ?? null);
	let isLoadingMore = $state(false);
	let errorMessage = $state('');

	const formatCount = (value: number | null | undefined): string => {
		if (typeof value !== 'number') return '—';
		return Intl.NumberFormat().format(value);
	};

	const formatDate = (value: number | null | undefined): string => {
		if (!value) return '—';
		const date = new Date(value);
		return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
	};

	const isExpired = (entry: BrightdataCacheRecord): boolean => {
		const expiresAt = entry.expires_at;
		if (typeof expiresAt !== 'number') return false;
		return expiresAt < Date.now();
	};

	const handleLookup = (event: SubmitEvent) => {
		event.preventDefault();
		const url = lookupUrl.trim();
		void goto(url ? `/admin/cache?url=${encodeURIComponent(url)}` : '/admin/cache');
	};

	const loadMore = async () => {
		if (!nextCursor || isLoadingMore) return;
		isLoadingMore = true;
		errorMessage = '';
		try {
			const response = await fetch(`/api/admin/cache?cursor=${encodeURIComponent(nextCursor)}`);
			if (!response.ok) throw new Error('Failed to load more cache entries');
			const result = await response.json();
			entries = [...entries, ...(result.entries ?? [])];
			nextCursor = result.nextCursor ?? null;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to load more cache entries.';
		} finally {
			isLoadingMore = false;
		}
	};
</script>

<svelte:head>
	<title>Cache - Admin</title>
</svelte:head>

<section class="admin-page">
	<header class="page-header">
		<div>
			<h2>BrightData Cache</h2>
			<p>Inspect cached profile payloads and expiry.</p>
		</div>
	</header>

	<section class="section-card">
		<h3>Stats</h3>
		{#if !stats}
			<p class="muted">Unable to load cache stats.</p>
		{:else}
			<div class="stats-grid">
				<div class="stat">
					<span>Total cached</span>
					<strong>{formatCount(stats.total)}</strong>
				</div>
				<div class="stat">
					<span>Active (not expired)</span>
					<strong>{formatCount(stats.active)}</strong>
				</div>
				<div class="stat">
					<span>Expired</span>
					<strong>{formatCount(stats.expired)}</strong>
				</div>
				<div class="stat">
					<span>Cached (last 24h)</span>
					<strong>{formatCount(stats.last_24h)}</strong>
				</div>
				<div class="stat">
					<span>Cached (last 7d)</span>
					<strong>{formatCount(stats.last_7d)}</strong>
				</div>
				<div class="stat">
					<span>Cached (last 30d)</span>
					<strong>{formatCount(stats.last_30d)}</strong>
				</div>
			</div>
			<p class="muted">As of {formatDate(stats.as_of)}. Rolling windows are based on <span class="mono">cached_at</span>.</p>
		{/if}
	</section>

	<section class="section-card">
		<h3>Lookup</h3>
		<form class="lookup-form" onsubmit={handleLookup}>
			<input
				type="url"
				placeholder="https://instagram.com/username or https://tiktok.com/@username"
				bind:value={lookupUrl}
			/>
			<button type="submit">Lookup</button>
		</form>

		{#if data.lookupUrl}
			<div class="lookup-result">
				{#if data.lookup}
					<p>
						Found cache entry for <span class="mono">{data.lookup.profile_url ?? data.lookupUrl}</span>.
						<a class="inline-link" href={`/admin/cache/${data.lookup.id}`}>Open details</a>
					</p>
				{:else}
					<p class="muted">
						No cache entry found for <span class="mono">{data.lookupUrl}</span>.
					</p>
				{/if}
			</div>
		{/if}
	</section>

	<section class="section-card">
		<h3>Recent Entries</h3>
		{#if entries.length === 0}
			<p class="muted">No cache entries found.</p>
		{:else}
			<div class="table">
				<div class="table-header">
					<span>Platform</span>
					<span>Profile URL</span>
					<span>Cached</span>
					<span>Expires</span>
					<span>Status</span>
				</div>
				{#each entries as entry}
					<a class="table-row" href={`/admin/cache/${entry.id}`}>
						<span class="pill">{entry.platform ?? '—'}</span>
						<span class="mono">{entry.profile_url ?? entry.id}</span>
						<span>{formatDate(entry.cached_at)}</span>
						<span>{formatDate(entry.expires_at)}</span>
						<span class:expired={isExpired(entry)}>{isExpired(entry) ? 'expired' : 'active'}</span>
					</a>
				{/each}
			</div>

			<div class="table-footer">
				{#if errorMessage}
					<p class="error-text">{errorMessage}</p>
				{/if}
				<button class="load-more" onclick={loadMore} disabled={!nextCursor || isLoadingMore}>
					{#if isLoadingMore}
						Loading...
					{:else if nextCursor}
						Load more
					{:else}
						No more entries
					{/if}
				</button>
			</div>
		{/if}
	</section>
</section>

<style>
	.admin-page {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.page-header h2 {
		margin: 0 0 4px 0;
		font-size: 22px;
		color: #0f172a;
	}

	.page-header p {
		margin: 0;
		color: rgba(15, 23, 42, 0.6);
	}

	.section-card {
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 16px;
		padding: 16px;
		background: #fff;
	}

	.section-card h3 {
		margin: 0 0 12px 0;
		font-size: 16px;
	}

	.lookup-form {
		display: flex;
		gap: 10px;
		align-items: center;
	}

	.lookup-form input {
		flex: 1;
		min-width: 240px;
		padding: 10px 12px;
		border-radius: 12px;
		border: 1px solid rgba(15, 23, 42, 0.1);
		font-size: 14px;
	}

	.lookup-form button {
		padding: 10px 14px;
		border-radius: 12px;
		border: none;
		background: #0f172a;
		color: #fff;
		font-size: 14px;
		cursor: pointer;
	}

	.lookup-result {
		margin-top: 12px;
		font-size: 13px;
		color: rgba(15, 23, 42, 0.7);
	}

	.inline-link {
		margin-left: 10px;
		color: #0f172a;
		font-weight: 600;
		text-decoration: none;
	}

	.table {
		display: grid;
		border-radius: 16px;
		overflow: hidden;
		border: 1px solid rgba(15, 23, 42, 0.08);
	}

	.table-header,
	.table-row {
		display: grid;
		grid-template-columns: 0.7fr 2fr 1fr 1fr 0.6fr;
		gap: 12px;
		align-items: center;
		padding: 12px 16px;
	}

	.table-header {
		background: rgba(15, 23, 42, 0.06);
		font-size: 12px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: rgba(15, 23, 42, 0.55);
	}

	.table-row {
		background: #fff;
		text-decoration: none;
		color: inherit;
		border-top: 1px solid rgba(15, 23, 42, 0.06);
		font-size: 13px;
	}

	.table-row:hover {
		background: rgba(15, 23, 42, 0.02);
	}

	.table-footer {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 14px;
	}

	.load-more {
		padding: 10px 16px;
		border-radius: 999px;
		border: 1px solid rgba(15, 23, 42, 0.12);
		background: #fff;
		cursor: pointer;
	}

	.error-text {
		color: #dc2626;
		font-size: 12px;
	}

	.muted {
		color: rgba(15, 23, 42, 0.6);
	}

	.expired {
		color: #dc2626;
		font-weight: 600;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 4px 8px;
		border-radius: 999px;
		font-size: 11px;
		background: rgba(15, 23, 42, 0.06);
		color: rgba(15, 23, 42, 0.7);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.mono {
		font-family: 'SFMono-Regular', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
		font-size: 12px;
		word-break: break-all;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 12px;
		margin-bottom: 10px;
	}

	.stat {
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 14px;
		padding: 12px 14px;
		background: rgba(15, 23, 42, 0.02);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.stat span {
		font-size: 12px;
		color: rgba(15, 23, 42, 0.6);
	}

	.stat strong {
		font-size: 18px;
		color: #0f172a;
		font-weight: 700;
	}

	@media (max-width: 720px) {
		.lookup-form {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
