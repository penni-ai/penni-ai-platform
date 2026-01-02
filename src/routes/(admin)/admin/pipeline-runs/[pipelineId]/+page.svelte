<script lang="ts">
	import type { PageData } from './$types';
	import type { PipelineBatchRecord, PipelineRunRecord } from '$lib/server/admin/pipeline-runs';
	import PipelineWaterfallTimeline from '$lib/components/admin/PipelineWaterfallTimeline.svelte';
	import PipelineInfluencersTable from '$lib/components/admin/PipelineInfluencersTable.svelte';

	let { data }: { data: PageData } = $props();
	const run = data.run as PipelineRunRecord;
	const batches = (data.batches ?? []) as PipelineBatchRecord[];
	const stageOrder = ['query_expansion', 'weaviate_search', 'brightdata_collection', 'llm_analysis'];

	const stageLabels: Record<string, string> = {
		query_expansion: 'Query Expansion',
		weaviate_search: 'Weaviate Search',
		brightdata_collection: 'BrightData Collection',
		llm_analysis: 'LLM Analysis'
	};

	const formatDate = (value: number | null | undefined): string => {
		if (!value) return '—';
		const date = new Date(value);
		return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
	};

	const formatDuration = (seconds: number | undefined): string => {
		if (typeof seconds !== 'number') return '—';
		if (seconds < 60) return `${seconds.toFixed(1)}s`;
		const minutes = Math.floor(seconds / 60);
		const remainder = Math.round(seconds % 60);
		return `${minutes}m ${remainder}s`;
	};

	const formatCost = (value: number | undefined): string => {
		if (typeof value !== 'number') return '—';
		const formatted = value < 1 ? value.toFixed(4) : value.toFixed(2);
		return `$${formatted}`;
	};

	const getStat = (key: string): number | undefined => {
		const stats = run.pipeline_stats as Record<string, unknown> | null;
		const value = stats?.[key];
		return typeof value === 'number' ? value : undefined;
	};

	const getStageNumber = (stageKey: string, field: string): number | undefined => {
		const stage = (run.stages as any)?.[stageKey];
		const value = stage?.[field];
		return typeof value === 'number' ? value : undefined;
	};

	const cacheHits = getStageNumber('brightdata_collection', 'cache_hits');
	const apiCalls = getStageNumber('brightdata_collection', 'api_calls');
	const candidatesCount = getStageNumber('weaviate_search', 'candidates_count');

	const cacheHitRate = (() => {
		if (typeof cacheHits !== 'number' || typeof apiCalls !== 'number') return null;
		const denom = cacheHits + apiCalls;
		if (denom <= 0) return null;
		return cacheHits / denom;
	})();

	const batchesByType = (type: string): PipelineBatchRecord[] =>
		batches.filter((batch) => (batch.type ?? '').toLowerCase() === type.toLowerCase());

	const batchesByStatus = (status: string): PipelineBatchRecord[] =>
		batches.filter((batch) => (batch.status ?? '').toLowerCase() === status.toLowerCase());
</script>

<svelte:head>
	<title>Pipeline Run {run.job_id ?? run.id} - Admin</title>
</svelte:head>

<section class="detail-page">
	<header class="detail-header">
		<div>
			<a class="back-link" href="/admin/pipeline-runs">← Back to runs</a>
			<h2>Pipeline Run</h2>
			<p class="mono">{run.job_id ?? run.id}</p>
		</div>
		<span class={`status-pill status-${run.status ?? 'unknown'}`}>{run.status ?? 'unknown'}</span>
	</header>

	<section class="summary-grid">
		<div class="summary-card">
			<h3>Run Summary</h3>
			<div class="summary-item"><span>Status</span><strong>{run.status ?? '—'}</strong></div>
			<div class="summary-item"><span>Current Stage</span><strong>{run.current_stage ?? '—'}</strong></div>
			<div class="summary-item"><span>Progress</span><strong>{typeof run.overall_progress === 'number' ? `${Math.round(run.overall_progress)}%` : '—'}</strong></div>
			<div class="summary-item"><span>Profiles</span><strong>{run.profiles_count ?? '—'}</strong></div>
			<div class="summary-item"><span>Created</span><strong>{formatDate(run.created_at)}</strong></div>
			<div class="summary-item"><span>Updated</span><strong>{formatDate(run.updated_at)}</strong></div>
		</div>

		<div class="summary-card">
			<h3>Cost & Usage</h3>
			<div class="summary-item"><span>Queries</span><strong>{getStat('queries_generated') ?? '—'}</strong></div>
			<div class="summary-item"><span>Search Results</span><strong>{getStat('total_search_results') ?? '—'}</strong></div>
			<div class="summary-item"><span>Deduplicated</span><strong>{getStat('deduplicated_results') ?? '—'}</strong></div>
			<div class="summary-item"><span>Profiles Analyzed</span><strong>{getStat('profiles_analyzed') ?? '—'}</strong></div>
			<div class="summary-item"><span>BrightData Cost</span><strong>{formatCost(getStat('brightdata_cost'))}</strong></div>
			<div class="summary-item"><span>OpenAI Cost</span><strong>{formatCost(getStat('openai_cost'))}</strong></div>
			<div class="summary-item"><span>Total Cost</span><strong>{formatCost(getStat('total_cost'))}</strong></div>
		</div>

		<div class="summary-card">
			<h3>Ownership</h3>
			<div class="summary-item"><span>User UID</span><strong class="mono">{run.uid ?? '—'}</strong></div>
			<div class="summary-item"><span>Campaign</span><strong class="mono">{run.campaign_id ?? '—'}</strong></div>
			<div class="summary-item"><span>Start Time</span><strong>{formatDate(run.start_time)}</strong></div>
			<div class="summary-item"><span>End Time</span><strong>{formatDate(run.end_time)}</strong></div>
			<div class="summary-item"><span>Duration</span><strong>{formatDuration((run.timing as any)?.pipeline_duration)}</strong></div>
		</div>

		<div class="summary-card">
			<h3>Cache & Batches</h3>
			<div class="summary-item"><span>Candidates</span><strong>{candidatesCount ?? '—'}</strong></div>
			<div class="summary-item"><span>Cache Hits</span><strong>{cacheHits ?? '—'}</strong></div>
			<div class="summary-item"><span>API Calls</span><strong>{apiCalls ?? '—'}</strong></div>
			<div class="summary-item">
				<span>Hit Rate</span>
				<strong>{typeof cacheHitRate === 'number' ? `${Math.round(cacheHitRate * 100)}%` : '—'}</strong>
			</div>
			<div class="summary-item">
				<span>Cache Batches</span>
				<strong>
					{run.cache_batches_completed ?? 0}/{run.cache_batches_total ?? 0}
					{#if (run.cache_batches_failed ?? 0) > 0}
						<span class="danger-pill">+{run.cache_batches_failed} failed</span>
					{/if}
				</strong>
			</div>
			<div class="summary-item"><span>In Flight</span><strong>{run.brightdata_in_flight ?? '—'}</strong></div>
			<div class="summary-item"><span>Good Fits</span><strong>{run.good_fit_count ?? '—'}</strong></div>
			<div class="summary-item"><span>Stop Requested</span><strong>{run.stop_requested ? 'yes' : 'no'}</strong></div>
		</div>
	</section>

	<section class="section-card">
		<h3>Waterfall</h3>
		<PipelineWaterfallTimeline run={run} batches={batches} />
		{#if run.pipeline_waterfall}
			<details class="raw-waterfall">
				<summary>Raw waterfall (text)</summary>
				<pre class="code-block">{run.pipeline_waterfall}</pre>
			</details>
		{/if}
	</section>

	<section class="section-card">
		<h3>Influencers</h3>
		<PipelineInfluencersTable pipelineId={run.id} />
	</section>

	<section class="section-card">
		<h3>Stage Detail</h3>
		<div class="stage-grid">
			{#each stageOrder as stageKey}
				{@const stage = (run.stages as any)?.[stageKey]}
				<div class="stage-card">
					<div class="stage-title">
						<span>{stageLabels[stageKey]}</span>
						<span class={`status-pill status-${stage?.status ?? 'unknown'}`}>{stage?.status ?? '—'}</span>
					</div>
					<div class="stage-body">
						{#if stage}
							{#each Object.entries(stage) as [key, value]}
								{#if key !== 'queries' && key !== 'prompt'}
									<div class="stage-row">
										<span>{key}</span>
										<strong>{typeof value === 'number' ? value : value ?? '—'}</strong>
									</div>
								{/if}
							{/each}

							{#if stageKey === 'query_expansion' && Array.isArray(stage.queries) && stage.queries.length > 0}
								<details class="stage-details">
									<summary>Queries ({stage.queries.length})</summary>
									<ul class="query-list">
										{#each stage.queries as q (q)}
											<li class="mono">{q}</li>
										{/each}
									</ul>
								</details>
							{/if}

							{#if stageKey === 'query_expansion' && typeof stage.prompt === 'string' && stage.prompt.length > 0}
								<details class="stage-details">
									<summary>Prompt</summary>
									<pre class="code-block">{stage.prompt}</pre>
								</details>
							{/if}
						{:else}
							<p class="stage-empty">No data</p>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</section>

	<section class="section-card">
		<h3>Storage Paths</h3>
		<div class="storage-grid">
			<div>
				<span>Profiles</span>
				<strong class="mono">{run.storage?.profiles_storage_path ?? '—'}</strong>
			</div>
			<div>
				<span>Remaining</span>
				<strong class="mono">{run.storage?.remaining_profiles_storage_path ?? '—'}</strong>
			</div>
			<div>
				<span>Progressive</span>
				<strong class="mono">{run.storage?.progressive_profiles_storage_path ?? '—'}</strong>
			</div>
			<div>
				<span>Candidates</span>
				<strong class="mono">{run.storage?.candidates_storage_path ?? '—'}</strong>
			</div>
		</div>
	</section>

	<section class="section-card">
		<h3>Batches</h3>
		{#if batches.length === 0}
			<p class="stage-empty">No batch records</p>
		{:else}
			<div class="batch-summary">
				<div class="batch-pill-row">
					<span class="pill">total {batches.length}</span>
					<span class="pill">cache {batchesByType('cache').length}</span>
					<span class="pill">brightdata {batchesByType('brightdata').length}</span>
				</div>
				<div class="batch-pill-row">
					{#if batchesByStatus('pending').length > 0}
						<span class="pill">pending {batchesByStatus('pending').length}</span>
					{/if}
					{#if batchesByStatus('running').length > 0}
						<span class="pill">running {batchesByStatus('running').length}</span>
					{/if}
					{#if batchesByStatus('triggered').length > 0}
						<span class="pill">triggered {batchesByStatus('triggered').length}</span>
					{/if}
					{#if batchesByStatus('completed').length > 0}
						<span class="pill">completed {batchesByStatus('completed').length}</span>
					{/if}
					{#if batchesByStatus('failed').length > 0}
						<span class="pill danger-pill">failed {batchesByStatus('failed').length}</span>
					{/if}
					{#if batchesByStatus('skipped').length > 0}
						<span class="pill">skipped {batchesByStatus('skipped').length}</span>
					{/if}
				</div>
			</div>

			<div class="batch-list">
				{#each batches as batch, index (batch.id)}
					<details class="batch-item">
						<summary class="batch-summary-row">
							<span class="mono">#{typeof batch.batch_id === 'number' ? batch.batch_id + 1 : index + 1}</span>
							<span class="pill">{batch.type ?? '—'}</span>
							<span class="pill">{batch.platform ?? '—'}</span>
							<span class={`status-pill status-${batch.status ?? 'unknown'}`}>{batch.status ?? 'unknown'}</span>
							<span class="muted">{batch.urls?.length ?? 0} urls</span>
							<span class="muted">{formatDate(batch.updated_at)}</span>
						</summary>

						<div class="batch-body">
							<div class="batch-meta">
								<div><span>Snapshot</span><strong class="mono">{batch.snapshot_id ?? '—'}</strong></div>
								<div><span>Poll Attempts</span><strong>{batch.poll_attempts ?? '—'}</strong></div>
								<div><span>Created</span><strong>{formatDate(batch.created_at)}</strong></div>
								<div><span>Updated</span><strong>{formatDate(batch.updated_at)}</strong></div>
							</div>

							{#if batch.last_error}
								<div class="batch-error">
									<h4>Last Error</h4>
									<pre class="code-block">{batch.last_error}</pre>
								</div>
							{/if}

							{#if batch.urls && batch.urls.length > 0}
								<div class="batch-urls">
									<h4>URLs</h4>
									<pre class="code-block">{batch.urls.join('\n')}</pre>
								</div>
							{/if}
						</div>
					</details>
				{/each}
			</div>
		{/if}
	</section>

	{#if run.pipeline_summary || run.pipeline_waterfall}
		<section class="section-card">
			<h3>Pipeline Summary</h3>
			<pre class="code-block">{run.pipeline_summary ?? '—'}</pre>
		</section>
	{/if}

	<section class="section-card">
		<h3>Timing</h3>
		<pre class="code-block">{JSON.stringify(run.timing ?? {}, null, 2)}</pre>
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

	.summary-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 16px;
	}

	.summary-card {
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 16px;
		padding: 16px;
		background: #fff;
	}

	.summary-card h3 {
		margin: 0 0 12px 0;
		font-size: 16px;
		color: #0f172a;
	}

	.summary-item {
		display: flex;
		justify-content: space-between;
		font-size: 13px;
		padding: 6px 0;
		color: rgba(15, 23, 42, 0.6);
		border-bottom: 1px solid rgba(15, 23, 42, 0.04);
	}

	.summary-item strong {
		color: #0f172a;
		font-weight: 600;
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

	.stage-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 12px;
	}

	.stage-card {
		border: 1px solid rgba(15, 23, 42, 0.06);
		border-radius: 12px;
		padding: 12px;
		background: rgba(15, 23, 42, 0.02);
	}

	.stage-title {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 13px;
		color: #0f172a;
		margin-bottom: 8px;
	}

	.stage-body {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
		color: rgba(15, 23, 42, 0.6);
	}

	.stage-row {
		display: flex;
		justify-content: space-between;
	}

	.stage-row strong {
		color: #0f172a;
	}

	.stage-empty {
		margin: 0;
		color: rgba(15, 23, 42, 0.5);
	}

	.stage-details {
		margin-top: 10px;
	}

	.query-list {
		margin: 8px 0 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
		color: rgba(15, 23, 42, 0.85);
	}

	.query-list li {
		list-style: disc;
	}

	.storage-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 10px;
		font-size: 12px;
		color: rgba(15, 23, 42, 0.6);
	}

	.storage-grid strong {
		display: block;
		margin-top: 4px;
		color: #0f172a;
	}

	.code-block {
		margin: 0;
		padding: 12px;
		background: rgba(15, 23, 42, 0.06);
		border-radius: 12px;
		font-size: 12px;
		overflow-x: auto;
	}

	.raw-waterfall summary {
		cursor: pointer;
		font-size: 12px;
		color: rgba(15, 23, 42, 0.7);
		margin: 10px 0 8px 0;
	}

	.mono {
		font-family: 'SFMono-Regular', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
		font-size: 12px;
		word-break: break-all;
	}

	.muted {
		color: rgba(15, 23, 42, 0.6);
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

	.danger-pill {
		background: rgba(239, 68, 68, 0.12);
		color: #dc2626;
		margin-left: 8px;
		padding: 2px 6px;
		border-radius: 999px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.batch-summary {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.batch-pill-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.batch-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 12px;
	}

	.batch-item {
		border: 1px solid rgba(15, 23, 42, 0.08);
		border-radius: 14px;
		background: rgba(15, 23, 42, 0.015);
		overflow: hidden;
	}

	.batch-summary-row {
		display: grid;
		grid-template-columns: 64px 90px 90px 110px 90px 1fr;
		gap: 10px;
		align-items: center;
		padding: 12px 14px;
		cursor: pointer;
		font-size: 12px;
	}

	.batch-body {
		padding: 12px 14px 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		border-top: 1px solid rgba(15, 23, 42, 0.06);
		background: #fff;
	}

	.batch-meta {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 10px;
		font-size: 12px;
		color: rgba(15, 23, 42, 0.6);
	}

	.batch-meta strong {
		display: block;
		margin-top: 4px;
		color: #0f172a;
		font-weight: 600;
	}

	.batch-error h4,
	.batch-urls h4 {
		margin: 0 0 8px 0;
		font-size: 13px;
		color: rgba(15, 23, 42, 0.7);
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

	@media (max-width: 720px) {
		.detail-header {
			flex-direction: column;
			align-items: flex-start;
		}

		.batch-summary-row {
			grid-template-columns: 1fr;
			gap: 6px;
			align-items: flex-start;
		}
	}
</style>
