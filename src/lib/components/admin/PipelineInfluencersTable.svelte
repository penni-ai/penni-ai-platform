<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';

	type InfluencerRow = {
		rank: number;
		fit_score: number | null;
		profile_url: string | null;
		display_name: string | null;
		platform: string | null;
		followers: number | null;
		fit_summary: string | null;
	};

	type Props = {
		pipelineId: string;
	};

	let { pipelineId }: Props = $props();

	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let source = $state<'none' | 'final' | 'progressive'>('none');
	let profiles = $state<InfluencerRow[]>([]);
	let filter = $state('');

	const computeFiltered = (rows: InfluencerRow[], raw: string): InfluencerRow[] => {
		const term = raw.trim().toLowerCase();
		if (!term) return rows;
		return rows.filter((row) => {
			const name = row.display_name?.toLowerCase() ?? '';
			const url = row.profile_url?.toLowerCase() ?? '';
			const platform = row.platform?.toLowerCase() ?? '';
			return name.includes(term) || url.includes(term) || platform.includes(term);
		});
	};

	const filtered = $derived(computeFiltered(profiles, filter));

	const formatScore = (score: number | null): string => {
		if (typeof score !== 'number') return '—';
		const outOfTen = Math.round(score / 10);
		return `${outOfTen}/10`;
	};

	const formatFollowers = (followers: number | null): string => {
		if (typeof followers !== 'number') return '—';
		return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(followers);
	};

	async function loadProfiles() {
		if (!browser) return;
		loading = true;
		loadError = null;
		try {
			const res = await fetch(`/admin/pipeline-runs/${pipelineId}/influencers`);
			if (!res.ok) {
				throw new Error(`Request failed: ${res.status}`);
			}
			const data = (await res.json()) as { source: typeof source; total: number; profiles: InfluencerRow[] };
			source = data.source ?? 'none';
			profiles = Array.isArray(data.profiles) ? data.profiles : [];
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void loadProfiles();
	});
</script>

<div class="influencers">
	<div class="toolbar">
		<div class="toolbar-left">
			<span class="pill">source {source}</span>
			<span class="pill">profiles {profiles.length}</span>
			{#if filtered.length !== profiles.length}
				<span class="pill">filtered {filtered.length}</span>
			{/if}
		</div>
		<div class="toolbar-right">
			<input class="filter" placeholder="Filter by name, url, platform" bind:value={filter} />
			<button class="button" onclick={loadProfiles} disabled={loading}>Reload</button>
		</div>
	</div>

	{#if loadError}
		<p class="note error">Failed to load influencers: {loadError}</p>
	{:else if loading && profiles.length === 0}
		<p class="note">Loading influencers…</p>
	{:else if profiles.length === 0}
		<p class="note">No influencer results found for this run yet.</p>
	{:else}
		<div class="table-wrap">
			<table class="table">
				<thead>
					<tr>
						<th>#</th>
						<th>Fit</th>
						<th>Name</th>
						<th>Platform</th>
						<th>Followers</th>
						<th>URL</th>
						<th>Summary</th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as row (row.rank)}
						<tr>
							<td class="mono">{row.rank}</td>
							<td class="mono">{formatScore(row.fit_score)}</td>
							<td>{row.display_name ?? '—'}</td>
							<td>{row.platform ?? '—'}</td>
							<td class="mono">{formatFollowers(row.followers)}</td>
							<td class="mono">
								{#if row.profile_url}
									<a href={row.profile_url} target="_blank" rel="noreferrer">{row.profile_url}</a>
								{:else}
									—
								{/if}
							</td>
							<td class="summary">{row.fit_summary ?? '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.influencers {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.toolbar {
		display: flex;
		gap: 10px;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
	}

	.toolbar-left,
	.toolbar-right {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		height: 26px;
		padding: 0 10px;
		border-radius: 999px;
		font-size: 12px;
		color: rgba(15, 23, 42, 0.75);
		border: 1px solid rgba(15, 23, 42, 0.1);
		background: rgba(15, 23, 42, 0.03);
	}

	.filter {
		height: 32px;
		min-width: min(420px, 80vw);
		border-radius: 10px;
		padding: 0 10px;
		border: 1px solid rgba(15, 23, 42, 0.12);
		background: #fff;
		font-size: 13px;
	}

	.button {
		height: 32px;
		border-radius: 10px;
		padding: 0 12px;
		border: 1px solid rgba(15, 23, 42, 0.12);
		background: rgba(15, 23, 42, 0.03);
		font-size: 13px;
		cursor: pointer;
	}

	.button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.note {
		margin: 0;
		font-size: 12px;
		color: rgba(15, 23, 42, 0.6);
	}

	.note.error {
		color: rgba(185, 28, 28, 0.9);
	}

	.table-wrap {
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 16px;
		overflow: auto;
		max-height: 520px;
		background: #fff;
	}

	.table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}

	.table thead th {
		position: sticky;
		top: 0;
		background: #fff;
		text-align: left;
		padding: 10px 12px;
		border-bottom: 1px solid rgba(15, 23, 42, 0.08);
		color: rgba(15, 23, 42, 0.75);
		font-weight: 600;
	}

	.table tbody td {
		padding: 10px 12px;
		border-bottom: 1px solid rgba(15, 23, 42, 0.06);
		vertical-align: top;
	}

	.table tbody tr:hover td {
		background: rgba(15, 23, 42, 0.02);
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
		font-size: 12px;
	}

	.summary {
		max-width: 520px;
		white-space: nowrap;
		text-overflow: ellipsis;
		overflow: hidden;
	}
	@media (max-width: 720px) {
		.filter {
			min-width: 0;
			width: 100%;
		}
	}
</style>
