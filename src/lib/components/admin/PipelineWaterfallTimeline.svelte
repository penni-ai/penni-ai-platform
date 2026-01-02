<script lang="ts">
	import { browser } from '$app/environment';
	import { onDestroy, onMount } from 'svelte';
	import type { PipelineBatchRecord, PipelineRunRecord } from '$lib/server/admin/pipeline-runs';

	import 'vis-timeline/styles/vis-timeline-graph2d.min.css';

	type Props = {
		run: PipelineRunRecord;
		batches: PipelineBatchRecord[];
	};

	let { run, batches }: Props = $props();

	let container = $state<HTMLDivElement | null>(null);
	let timeline: any = null;

	const stageOrder: Array<{ key: string; label: string; order: number }> = [
		{ key: 'query_expansion', label: 'Query Expansion', order: 1 },
		{ key: 'weaviate_search', label: 'Weaviate Search', order: 2 },
		{ key: 'brightdata_collection', label: 'BrightData Collection', order: 3 },
		{ key: 'llm_analysis', label: 'LLM Analysis', order: 4 }
	];

	const getStageMs = (stageKey: string, field: string): number | null => {
		const stage = (run.stages as any)?.[stageKey];
		const value = stage?.[field];
		return typeof value === 'number' ? value : null;
	};

	const getStageStatus = (stageKey: string): string => {
		const stage = (run.stages as any)?.[stageKey];
		const value = stage?.status;
		return typeof value === 'string' ? value : 'unknown';
	};

	const normalizeBatchType = (value: unknown): string => {
		if (typeof value !== 'string') return 'unknown';
		const lower = value.toLowerCase();
		if (lower === 'cache' || lower === 'brightdata') return lower;
		return lower || 'unknown';
	};

	const normalizePlatform = (value: unknown): string => {
		if (typeof value !== 'string') return 'unknown';
		const lower = value.toLowerCase();
		if (lower === 'instagram') return 'instagram';
		if (lower === 'tiktok') return 'tiktok';
		return lower || 'unknown';
	};

	const formatTimestamp = (ms: number | null | undefined): string => {
		if (typeof ms !== 'number') return '—';
		return new Date(ms).toLocaleString();
	};

	const computeBounds = (nowMs: number): { startMs: number; endMs: number } => {
		const candidates: number[] = [];

		if (typeof run.start_time === 'number') candidates.push(run.start_time);
		if (typeof run.created_at === 'number') candidates.push(run.created_at);

		for (const stage of stageOrder) {
			const started = getStageMs(stage.key, 'started_at');
			const completed = getStageMs(stage.key, 'completed_at');
			if (started) candidates.push(started);
			if (completed) candidates.push(completed);
		}

		for (const batch of batches) {
			if (typeof batch.started_at === 'number') candidates.push(batch.started_at);
			if (typeof batch.triggered_at === 'number') candidates.push(batch.triggered_at);
			if (typeof batch.completed_at === 'number') candidates.push(batch.completed_at);
			if (typeof batch.created_at === 'number') candidates.push(batch.created_at);
			if (typeof batch.updated_at === 'number') candidates.push(batch.updated_at);
		}

		if (typeof run.end_time === 'number') candidates.push(run.end_time);
		if (typeof run.updated_at === 'number') candidates.push(run.updated_at);
		candidates.push(nowMs);

		const startMs = Math.min(...candidates.filter((ms) => Number.isFinite(ms)));
		const endMs = Math.max(...candidates.filter((ms) => Number.isFinite(ms)));

		if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs === endMs) {
			return { startMs: nowMs - 60_000, endMs: nowMs + 60_000 };
		}

		return { startMs, endMs };
	};

	const buildGroupsAndItems = (nowMs: number) => {
		const { startMs, endMs } = computeBounds(nowMs);
		const groups: Array<{ id: string; content: string; order: number }> = [];
		const items: Array<Record<string, unknown>> = [];

		for (const stage of stageOrder) {
			groups.push({
				id: `stage:${stage.key}`,
				content: stage.label,
				order: stage.order
			});

			const started = getStageMs(stage.key, 'started_at');
			const completed = getStageMs(stage.key, 'completed_at');
			const status = getStageStatus(stage.key);
			if (!started) continue;

			items.push({
				id: `stage:${stage.key}`,
				group: `stage:${stage.key}`,
				start: new Date(started),
				end: new Date(completed ?? Math.min(nowMs, endMs)),
				content: '',
				title: `${stage.label}\nStatus: ${status}\nStart: ${formatTimestamp(started)}\nEnd: ${formatTimestamp(
					completed ?? null
				)}`,
				className: `stage stage-${stage.key} status-${status}`
			});
		}

		const groupOrderBase = 10;
		const batchGroupMap = new Map<string, { id: string; content: string; order: number }>();
		const ensureBatchGroup = (groupId: string, content: string, order: number) => {
			if (batchGroupMap.has(groupId)) return;
			batchGroupMap.set(groupId, { id: groupId, content, order });
		};

		ensureBatchGroup('batch:cache:instagram', 'Batch • Cache (Instagram)', groupOrderBase + 1);
		ensureBatchGroup('batch:cache:tiktok', 'Batch • Cache (TikTok)', groupOrderBase + 2);
		ensureBatchGroup('batch:brightdata:instagram', 'Batch • BrightData (Instagram)', groupOrderBase + 3);
		ensureBatchGroup('batch:brightdata:tiktok', 'Batch • BrightData (TikTok)', groupOrderBase + 4);
		ensureBatchGroup('batch:unknown:unknown', 'Batch • Other', groupOrderBase + 9);

		for (const [index, batch] of batches.entries()) {
			const batchId = typeof batch.batch_id === 'number' ? batch.batch_id : index;
			const label = `B${batchId + 1}`;

			const type = normalizeBatchType(batch.type);
			const platform = normalizePlatform(batch.platform);
			const status = typeof batch.status === 'string' ? batch.status.toLowerCase() : 'unknown';

			const groupId = `batch:${type}:${platform}`;
			if (!batchGroupMap.has(groupId)) {
				ensureBatchGroup(groupId, `Batch • ${type} (${platform})`, groupOrderBase + 8);
			}

			const stageStart = getStageMs('brightdata_collection', 'started_at') ?? startMs;
			const started =
				(typeof batch.started_at === 'number' ? batch.started_at : null) ??
				(typeof batch.created_at === 'number' ? batch.created_at : null) ??
				stageStart;
			const triggered = typeof batch.triggered_at === 'number' ? batch.triggered_at : null;
			const completed =
				(typeof batch.completed_at === 'number' ? batch.completed_at : null) ??
				((status === 'completed' || status === 'failed' || status === 'skipped') &&
				typeof batch.updated_at === 'number'
					? batch.updated_at
					: null);

			const end = completed ?? Math.min(nowMs, endMs);
			const urlsCount = batch.urls?.length ?? 0;

			const baseTitle = [
				`${label}`,
				`Type: ${type}`,
				`Platform: ${platform}`,
				`Status: ${status}`,
				`URLs: ${urlsCount}`,
				`Started: ${formatTimestamp(started)}`,
				`Triggered: ${formatTimestamp(triggered)}`,
				`Completed: ${formatTimestamp(completed)}`,
				batch.snapshot_id ? `Snapshot: ${batch.snapshot_id}` : null,
				typeof batch.poll_attempts === 'number' ? `Poll Attempts: ${batch.poll_attempts}` : null,
				batch.last_error ? `Last Error: ${batch.last_error}` : null
			]
				.filter(Boolean)
				.join('\n');

			if (triggered && triggered > started) {
				items.push({
					id: `batch:${batchId}:run`,
					group: groupId,
					start: new Date(started),
					end: new Date(triggered),
					content: label,
					title: baseTitle,
					className: `batch batch-${type} phase-run status-${status}`
				});
				items.push({
					id: `batch:${batchId}:poll`,
					group: groupId,
					start: new Date(triggered),
					end: new Date(end),
					content: label,
					title: baseTitle,
					className: `batch batch-${type} phase-poll status-${status}`
				});
			} else {
				items.push({
					id: `batch:${batchId}`,
					group: groupId,
					start: new Date(started),
					end: new Date(end),
					content: label,
					title: baseTitle,
					className: `batch batch-${type} phase-run status-${status}`
				});
			}
		}

		const batchGroups = Array.from(batchGroupMap.values()).sort((a, b) => a.order - b.order);
		groups.push(...batchGroups);

		const paddingMs = Math.min(10 * 60_000, Math.max(10_000, Math.round((endMs - startMs) * 0.05)));
		return {
			groups,
			items,
			min: new Date(startMs - paddingMs),
			max: new Date(endMs + paddingMs)
		};
	};

	onMount(async () => {
		if (!browser || !container) return;

		const mod = (await import('vis-timeline/standalone')) as any;
		const Timeline = mod.Timeline;
		const DataSet = mod.DataSet;
		const nowMs = Date.now();
		const { groups, items, min, max } = buildGroupsAndItems(nowMs);

		const groupSet = new DataSet(groups);
		const itemSet = new DataSet(items);

		timeline = new Timeline(container, itemSet, groupSet, {
			stack: true,
			verticalScroll: true,
			horizontalScroll: true,
			zoomKey: 'ctrlKey',
			zoomMin: 5_000,
			margin: { item: 10, axis: 8 },
			orientation: 'top',
			showCurrentTime: true,
			min,
			max
		});
	});

	onDestroy(() => {
		if (timeline) {
			timeline.destroy();
			timeline = null;
		}
	});
</script>

<div class="waterfall">
	<div class="waterfall-legend">
		<span class="legend-item"><span class="legend-swatch stage"></span>Stage</span>
		<span class="legend-item"><span class="legend-swatch cache"></span>Cache batch</span>
		<span class="legend-item"><span class="legend-swatch brightdata"></span>BrightData batch</span>
		<span class="legend-item"><span class="legend-swatch failed"></span>Failed</span>
		<span class="legend-item"><span class="legend-swatch skipped"></span>Skipped</span>
	</div>

	<div class="waterfall-canvas" bind:this={container}></div>

	{#if !browser}
		<p class="waterfall-note">Timeline renders client-side.</p>
	{/if}
</div>

<style>
	.waterfall {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.waterfall-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		font-size: 12px;
		color: rgba(15, 23, 42, 0.65);
	}

	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.legend-swatch {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		background: rgba(15, 23, 42, 0.2);
		display: inline-block;
	}

	.legend-swatch.stage {
		background: rgba(15, 23, 42, 0.35);
	}

	.legend-swatch.cache {
		background: rgba(59, 130, 246, 0.5);
	}

	.legend-swatch.brightdata {
		background: rgba(245, 158, 11, 0.55);
	}

	.legend-swatch.failed {
		background: rgba(239, 68, 68, 0.7);
	}

	.legend-swatch.skipped {
		background: rgba(100, 116, 139, 0.6);
	}

	.waterfall-canvas {
		width: 100%;
		height: 520px;
		border-radius: 16px;
		border: 1px solid rgba(15, 23, 42, 0.08);
		background: #fff;
		overflow: hidden;
	}

	.waterfall-note {
		margin: 0;
		font-size: 12px;
		color: rgba(15, 23, 42, 0.55);
	}

	:global(.waterfall-canvas .vis-timeline) {
		border: none;
	}

	:global(.waterfall-canvas .vis-item.stage) {
		background: rgba(15, 23, 42, 0.14);
		border: 1px solid rgba(15, 23, 42, 0.28);
		color: rgba(15, 23, 42, 0.85);
		font-weight: 600;
	}

	:global(.waterfall-canvas .vis-item.batch-cache) {
		background: rgba(59, 130, 246, 0.2);
		border: 1px solid rgba(59, 130, 246, 0.45);
		color: rgba(30, 64, 175, 0.95);
	}

	:global(.waterfall-canvas .vis-item.batch-brightdata) {
		background: rgba(245, 158, 11, 0.22);
		border: 1px solid rgba(245, 158, 11, 0.5);
		color: rgba(120, 53, 15, 0.95);
	}

	:global(.waterfall-canvas .vis-item.status-failed),
	:global(.waterfall-canvas .vis-item.status-error) {
		background: rgba(239, 68, 68, 0.18) !important;
		border: 1px solid rgba(239, 68, 68, 0.55) !important;
		color: rgba(185, 28, 28, 0.95) !important;
	}

	:global(.waterfall-canvas .vis-item.status-skipped) {
		background: rgba(100, 116, 139, 0.16) !important;
		border: 1px solid rgba(100, 116, 139, 0.45) !important;
		color: rgba(51, 65, 85, 0.95) !important;
	}

	:global(.waterfall-canvas .vis-item.phase-poll) {
		background-image: linear-gradient(
			135deg,
			rgba(255, 255, 255, 0.0) 0%,
			rgba(255, 255, 255, 0.0) 45%,
			rgba(255, 255, 255, 0.35) 45%,
			rgba(255, 255, 255, 0.35) 55%,
			rgba(255, 255, 255, 0.0) 55%,
			rgba(255, 255, 255, 0.0) 100%
		);
		background-size: 12px 12px;
	}

	@media (max-width: 720px) {
		.waterfall-canvas {
			height: 420px;
		}
	}
</style>
