<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import type { PipelineRunRecord } from '$lib/server/admin/pipeline-runs';

	let { data }: { data: PageData } = $props();

	let runs = $state<PipelineRunRecord[]>(data.runs ?? []);
	let nextCursor = $state<string | null>(data.nextCursor ?? null);
	let status = $state(data.filters?.status ?? '');
	let uid = $state(data.filters?.uid ?? '');
	let campaignId = $state(data.filters?.campaignId ?? '');
	let start = $state(data.filters?.start ?? '');
	let end = $state(data.filters?.end ?? '');
	let isLoadingMore = $state(false);
	let errorMessage = $state('');

	const statusOptions = ['pending', 'running', 'completed', 'error', 'cancelled'];

	const getTotalCost = (run: PipelineRunRecord): number | null => {
		const stats = run.pipeline_stats as { total_cost?: number } | null;
		return typeof stats?.total_cost === 'number' ? stats.total_cost : null;
	};

	const getProfilesCollected = (run: PipelineRunRecord): number | null => {
		const stats = run.pipeline_stats as { profiles_collected?: number } | null;
		if (typeof stats?.profiles_collected === 'number') return stats.profiles_collected;
		return typeof run.profiles_count === 'number' ? run.profiles_count : null;
	};

	const formatCost = (value: number | null): string => {
		if (typeof value !== 'number') return '—';
		const formatted = value < 1 ? value.toFixed(4) : value.toFixed(2);
		return `$${formatted}`;
	};

	const formatProgress = (value: number | undefined): string => {
		if (typeof value !== 'number') return '—';
		return `${Math.round(value)}%`;
	};

	const formatDate = (value: number | null | undefined): string => {
		if (!value) return '—';
		const date = new Date(value);
		return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
	};

	const buildParams = (cursor?: string | null): URLSearchParams => {
		const params = new URLSearchParams();
		if (status) params.set('status', status);
		if (uid) params.set('uid', uid);
		if (campaignId) params.set('campaign_id', campaignId);
		if (start) params.set('start', start);
		if (end) params.set('end', end);
		if (cursor) params.set('cursor', cursor);
		return params;
	};

	const applyFilters = async () => {
		const params = buildParams();
		const query = params.toString();
		await goto(query ? `/admin/pipeline-runs?${query}` : '/admin/pipeline-runs');
	};

	const loadMore = async () => {
		if (!nextCursor || isLoadingMore) return;
		isLoadingMore = true;
		errorMessage = '';
		try {
			const params = buildParams(nextCursor);
			const response = await fetch(`/api/admin/pipeline-runs?${params.toString()}`);
			if (!response.ok) {
				throw new Error('Failed to load more runs');
			}
			const result = await response.json();
			runs = [...runs, ...(result.runs ?? [])];
			nextCursor = result.nextCursor ?? null;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Failed to load more runs.';
		} finally {
			isLoadingMore = false;
		}
	};
</script>

<svelte:head>
	<title>Pipeline Runs - Admin</title>
</svelte:head>

<section class="admin-page">
	<header class="page-header">
		<div>
			<h2>Pipeline Runs</h2>
			<p>Search by status, user, campaign, or time window.</p>
		</div>
	</header>

	<form class="filter-bar" onsubmit|preventDefault={applyFilters}>
		<div class="filter-field">
			<label for="status">Status</label>
			<select id="status" bind:value={status}>
				<option value="">All</option>
				{#each statusOptions as option}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</div>
		<div class="filter-field">
			<label for="uid">User UID</label>
			<input id="uid" type="text" placeholder="uid" bind:value={uid} />
		</div>
		<div class="filter-field">
			<label for="campaign">Campaign</label>
			<input id="campaign" type="text" placeholder="campaign_id" bind:value={campaignId} />
		</div>
		<div class="filter-field">
			<label for="start">Start</label>
			<input id="start" type="date" bind:value={start} />
		</div>
		<div class="filter-field">
			<label for="end">End</label>
			<input id="end" type="date" bind:value={end} />
		</div>
		<button type="submit" class="filter-cta">Apply</button>
	</form>

	{#if runs.length === 0}
		<div class="empty-state">
			<p>No pipeline runs match the current filters.</p>
		</div>
	{:else}
		<div class="table">
			<div class="table-header">
				<span>Job</span>
				<span>Status</span>
				<span>Stage</span>
				<span>Progress</span>
				<span>Profiles</span>
				<span>Total Cost</span>
				<span>Created</span>
			</div>
			{#each runs as run}
				<a class="table-row" href={`/admin/pipeline-runs/${run.id}`}>
					<span class="mono">{run.job_id ?? run.id}</span>
					<span class={`status-pill status-${run.status ?? 'unknown'}`}>{run.status ?? 'unknown'}</span>
					<span>{run.current_stage ?? '—'}</span>
					<span>{formatProgress(run.overall_progress)}</span>
					<span>{getProfilesCollected(run) ?? '—'}</span>
					<span>{formatCost(getTotalCost(run))}</span>
					<span>{formatDate(run.created_at)}</span>
				</a>
			{/each}
		</div>

		<div class="table-footer">
			{#if errorMessage}
				<p class="error-text">{errorMessage}</p>
			{/if}
			<button class="load-more" on:click={loadMore} disabled={!nextCursor || isLoadingMore}>
				{#if isLoadingMore}
					Loading...
				{:else if nextCursor}
					Load more
				{:else}
					No more runs
				{/if}
			</button>
		</div>
	{/if}
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

	.filter-bar {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 12px;
		align-items: end;
		background: rgba(15, 23, 42, 0.03);
		border-radius: 16px;
		padding: 16px;
	}

	.filter-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
		color: rgba(15, 23, 42, 0.6);
	}

	.filter-field input,
	.filter-field select {
		padding: 8px 10px;
		border-radius: 10px;
		border: 1px solid rgba(15, 23, 42, 0.1);
		font-size: 14px;
	}

	.filter-cta {
		padding: 10px 16px;
		border-radius: 12px;
		border: none;
		background: #0f172a;
		color: #fff;
		font-size: 14px;
		cursor: pointer;
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
		grid-template-columns: 1.5fr 0.7fr 0.9fr 0.7fr 0.7fr 0.8fr 1fr;
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
		transition: background 0.2s ease;
	}

	.table-row:hover {
		background: rgba(15, 23, 42, 0.04);
	}

	.mono {
		font-family: 'SFMono-Regular', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
		font-size: 12px;
		color: rgba(15, 23, 42, 0.7);
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

	.status-pending {
		background: rgba(59, 130, 246, 0.12);
		color: #2563eb;
	}

	.status-running {
		background: rgba(14, 116, 144, 0.12);
		color: #0e7490;
	}

	.status-completed {
		background: rgba(34, 197, 94, 0.12);
		color: #16a34a;
	}

	.status-error,
	.status-cancelled {
		background: rgba(239, 68, 68, 0.12);
		color: #dc2626;
	}

	.table-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
	}

	.load-more {
		border: none;
		background: rgba(15, 23, 42, 0.08);
		padding: 10px 16px;
		border-radius: 999px;
		cursor: pointer;
		font-size: 13px;
	}

	.load-more:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.error-text {
		color: #dc2626;
		font-size: 13px;
	}

	.empty-state {
		padding: 24px;
		border-radius: 16px;
		background: rgba(15, 23, 42, 0.03);
		color: rgba(15, 23, 42, 0.6);
	}

	@media (max-width: 960px) {
		.table-header,
		.table-row {
			grid-template-columns: 1.4fr 0.8fr 0.8fr 0.6fr 0.6fr 0.8fr 0.9fr;
		}
	}

	@media (max-width: 720px) {
		.filter-bar {
			grid-template-columns: 1fr;
		}

		.table-header {
			display: none;
		}

		.table-row {
			grid-template-columns: 1fr;
			gap: 8px;
			padding: 16px;
		}
	}
</style>
