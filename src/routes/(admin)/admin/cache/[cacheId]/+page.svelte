<script lang="ts">
	import type { PageData } from './$types';
	import type { BrightdataCacheRecord } from '$lib/server/admin/brightdata-cache';

	let { data }: { data: PageData } = $props();
	const entry = data.entry as BrightdataCacheRecord;

	const formatDate = (value: number | null | undefined): string => {
		if (!value) return '—';
		const date = new Date(value);
		return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
	};

	const isExpired = (): boolean => {
		const expiresAt = entry.expires_at;
		if (typeof expiresAt !== 'number') return false;
		return expiresAt < Date.now();
	};
</script>

<svelte:head>
	<title>Cache Entry {entry.profile_url ?? entry.id} - Admin</title>
</svelte:head>

<section class="detail-page">
	<header class="detail-header">
		<div>
			<a class="back-link" href="/admin/cache">← Back to cache</a>
			<h2>Cache Entry</h2>
			<p class="mono">{entry.profile_url ?? entry.id}</p>
		</div>
		<span class={`status-pill ${isExpired() ? 'status-expired' : 'status-active'}`}>
			{isExpired() ? 'expired' : 'active'}
		</span>
	</header>

	<section class="section-card">
		<h3>Metadata</h3>
		<div class="meta-grid">
			<div class="meta-item"><span>Doc ID</span><strong class="mono">{entry.id}</strong></div>
			<div class="meta-item"><span>Platform</span><strong>{entry.platform ?? '—'}</strong></div>
			<div class="meta-item"><span>Cached</span><strong>{formatDate(entry.cached_at)}</strong></div>
			<div class="meta-item"><span>Expires</span><strong>{formatDate(entry.expires_at)}</strong></div>
		</div>
	</section>

	<section class="section-card">
		<h3>Raw Payload</h3>
		<pre class="code-block">{JSON.stringify(entry.raw_data ?? {}, null, 2)}</pre>
	</section>
</section>

<style>
	.detail-page {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.detail-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
	}

	.detail-header h2 {
		margin: 6px 0 4px 0;
		font-size: 22px;
		color: #0f172a;
	}

	.back-link {
		text-decoration: none;
		color: rgba(15, 23, 42, 0.6);
		font-size: 13px;
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

	.meta-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 12px;
	}

	.meta-item {
		display: flex;
		justify-content: space-between;
		padding: 8px 0;
		border-bottom: 1px solid rgba(15, 23, 42, 0.05);
		font-size: 13px;
		color: rgba(15, 23, 42, 0.6);
	}

	.meta-item strong {
		color: #0f172a;
		font-weight: 600;
	}

	.code-block {
		margin: 0;
		padding: 12px;
		background: rgba(15, 23, 42, 0.06);
		border-radius: 12px;
		font-size: 12px;
		overflow-x: auto;
	}

	.mono {
		font-family: 'SFMono-Regular', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
		font-size: 12px;
		word-break: break-all;
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 4px 8px;
		border-radius: 999px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.status-active {
		background: rgba(34, 197, 94, 0.12);
		color: #16a34a;
	}

	.status-expired {
		background: rgba(239, 68, 68, 0.12);
		color: #dc2626;
	}
</style>

