<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { FlowMetrics } from '$lib/types/search';

	type SearchMetricsSnapshot = {
		initial_found: number;
		deduped_kept: number;
		deduped_discarded: number;
	} | null;

	type AnimatedMetricKey =
		| 'initial_found'
		| 'deduped_kept'
		| 'deduped_discarded'
		| 'brightdata_success'
		| 'brightdata_dead'
		| 'llm_above_5'
		| 'llm_below_5';

	type AnimatedValues = Record<AnimatedMetricKey, number>;

	const METRIC_KEYS: AnimatedMetricKey[] = [
		'initial_found',
		'deduped_kept',
		'deduped_discarded',
		'brightdata_success',
		'brightdata_dead',
		'llm_above_5',
		'llm_below_5'
	];

	const PLACEHOLDER_SEQUENCE: AnimatedMetricKey[] = [
		'initial_found',
		'deduped_kept',
		'deduped_discarded',
		'brightdata_success',
		'brightdata_dead',
		'llm_above_5',
		'llm_below_5'
	];

	const zeroMetrics = (): AnimatedValues => ({
		initial_found: 0,
		deduped_kept: 0,
		deduped_discarded: 0,
		brightdata_success: 0,
		brightdata_dead: 0,
		llm_above_5: 0,
		llm_below_5: 0
	});

export let searchMetrics: SearchMetricsSnapshot = null;
export let flowMetrics: FlowMetrics | null = null;

	let animatedValues: AnimatedValues = zeroMetrics();
	let placeholderInterval: ReturnType<typeof setInterval> | null = null;
	let rampInterval: ReturnType<typeof setInterval> | null = null;
	let pendingTarget: AnimatedValues | null = null;
	let placeholderIndex = 0;
	let realDataSeen = false;

	const formatNumber = (value: number | null | undefined) =>
		typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—';

	const formatPercent = (value: number) => `${Math.round(value)}%`;

	type SegmentDefinition = {
		key: string;
		label: string;
		value: number;
		barClass: string;
		dotClass: string;
	};

	type Segment = SegmentDefinition & { percent: number };

	const buildSegments = (total: number, defs: SegmentDefinition[]): Segment[] => {
		const sanitized = defs.map((segment) => ({
			...segment,
			value: Math.max(0, segment.value ?? 0)
		}));
		const denominator = total > 0 ? total : sanitized.reduce((sum, segment) => sum + segment.value, 0);
		return sanitized.map((segment) => ({
			...segment,
			percent: denominator > 0 ? (segment.value / denominator) * 100 : 0
		}));
	};

	const ensurePlaceholder = () => {
		if (!placeholderInterval) {
			placeholderInterval = setInterval(() => {
				placeholderTick();
			}, 2500);
		}
	};

	const stopPlaceholder = () => {
		if (placeholderInterval) {
			clearInterval(placeholderInterval);
			placeholderInterval = null;
		}
	};

	const stopRamp = () => {
		if (rampInterval) {
			clearInterval(rampInterval);
			rampInterval = null;
		}
	};

	const cleanupIntervals = () => {
		stopPlaceholder();
		stopRamp();
	};

	const updateAnimated = (mutator: (draft: AnimatedValues) => void) => {
		const draft = { ...animatedValues };
		mutator(draft);
		animatedValues = draft;
	};

	const placeholderTick = () => {
		const key = PLACEHOLDER_SEQUENCE[placeholderIndex % PLACEHOLDER_SEQUENCE.length];
		placeholderIndex += 1;
		updateAnimated((draft) => {
			draft[key] = draft[key] + 1;
			if (key === 'deduped_kept' || key === 'deduped_discarded') {
				const dedupTotal = draft.deduped_kept + draft.deduped_discarded;
				if (dedupTotal > draft.initial_found) {
					draft.initial_found = dedupTotal;
				}
			}
		});
	};

	const hasDifference = (a: AnimatedValues, b: AnimatedValues) =>
		METRIC_KEYS.some((key) => a[key] !== b[key]);

	const scheduleRamp = (targets: AnimatedValues) => {
		pendingTarget = { ...targets };
		if (!rampInterval) {
			rampInterval = setInterval(() => {
				if (!pendingTarget) {
					stopRamp();
					return;
				}
				const draft = { ...animatedValues };
				let changed = false;
				for (const key of METRIC_KEYS) {
					const target = pendingTarget[key];
					const current = draft[key];
					if (current === target) continue;
					changed = true;
					const delta = target - current;
					const step = Math.max(1, Math.round(Math.abs(delta) / 5));
					draft[key] = current + Math.sign(delta) * Math.min(Math.abs(delta), step);
				}
				animatedValues = draft;
				if (!changed || !pendingTarget || !hasDifference(animatedValues, pendingTarget)) {
					pendingTarget = null;
					stopRamp();
				}
			}, 100);
		}
	};

	const buildTargetSnapshot = (): AnimatedValues => ({
		initial_found: searchMetrics?.initial_found ?? flowMetrics?.initial_count ?? 0,
		deduped_kept: searchMetrics?.deduped_kept ?? flowMetrics?.deduped_kept ?? 0,
		deduped_discarded: searchMetrics?.deduped_discarded ?? flowMetrics?.deduped_discarded ?? 0,
		brightdata_success: flowMetrics?.brightdata_success ?? 0,
		brightdata_dead: flowMetrics?.brightdata_dead ?? 0,
		llm_above_5: flowMetrics?.llm_above_5 ?? 0,
		llm_below_5: flowMetrics?.llm_below_5 ?? 0
	});

	const normalizeSnapshot = (snapshot: AnimatedValues): AnimatedValues => {
		const normalized = { ...snapshot };
		const dedupTotal = normalized.deduped_kept + normalized.deduped_discarded;
		if (dedupTotal > normalized.initial_found) {
			normalized.initial_found = dedupTotal;
		}
		return normalized;
	};

	onMount(() => {
		if (!searchMetrics && !flowMetrics) {
			ensurePlaceholder();
		}
	});

	onDestroy(() => {
		cleanupIntervals();
	});

	$: targetSnapshot = normalizeSnapshot(buildTargetSnapshot());
	$: {
		if (searchMetrics || flowMetrics) {
			realDataSeen = true;
			stopPlaceholder();
			if (
				hasDifference(animatedValues, targetSnapshot) ||
				(pendingTarget && hasDifference(pendingTarget, targetSnapshot))
			) {
				scheduleRamp(targetSnapshot);
			} else if (!pendingTarget) {
				animatedValues = { ...targetSnapshot };
			}
		} else {
			if (realDataSeen) {
				realDataSeen = false;
				pendingTarget = null;
				stopRamp();
				animatedValues = zeroMetrics();
			}
			ensurePlaceholder();
		}
	}

	$: initial = animatedValues.initial_found;
	$: dedupKept = animatedValues.deduped_kept;
	$: dedupDiscarded = animatedValues.deduped_discarded;
	$: brightdataSuccess = animatedValues.brightdata_success;
	$: brightdataDead = animatedValues.brightdata_dead;
	$: llmAbove = animatedValues.llm_above_5;
	$: llmBelow = animatedValues.llm_below_5;
	$: searchTotal = Math.max(initial, dedupKept + dedupDiscarded);
	$: liveAnalysisTotal = Math.max(brightdataSuccess + brightdataDead, 0);
	$: searchSegments = buildSegments(searchTotal, [
		{
			key: 'search-kept',
			label: 'Kept',
			value: dedupKept,
			barClass: 'bg-emerald-500',
			dotClass: 'bg-emerald-500'
		},
		{
			key: 'search-duplicates',
			label: 'Duplicates removed',
			value: dedupDiscarded,
			barClass: 'bg-amber-400',
			dotClass: 'bg-amber-400'
		}
	]);
	$: liveAnalysisSegments = buildSegments(liveAnalysisTotal, [
		{
			key: 'live-qualified',
			label: 'Qualified (score ≥ 5)',
			value: llmAbove,
			barClass: 'bg-indigo-500',
			dotClass: 'bg-indigo-500'
		},
		{
			key: 'live-low-score',
			label: 'Low score (< 5)',
			value: llmBelow,
			barClass: 'bg-gray-400',
			dotClass: 'bg-gray-400'
		},
		{
			key: 'live-failed-enrichment',
			label: 'Failed enrichment',
			value: brightdataDead,
			barClass: 'bg-rose-400',
			dotClass: 'bg-rose-400'
		}
	]);
</script>

<div class="rounded-3xl border border-gray-100 bg-gray-50/80 p-4 space-y-4">
	<div class="flex items-center justify-between">
		<h3 class="text-sm font-semibold text-gray-900">Flow Metrics</h3>
		{#if flowMetrics}
			<span class="text-xs text-gray-500">
				{flowMetrics.completed_batches} / {flowMetrics.total_batches} batches complete
			</span>
		{/if}
	</div>
	<div class="grid gap-3 sm:grid-cols-2">
		<div class="rounded-2xl border border-white bg-white/70 p-3 space-y-3">
			<div class="flex items-center justify-between text-xs uppercase tracking-wide text-gray-500">
				<span>Search</span>
				<span class="metric-value">{formatNumber(initial)}</span>
			</div>
			{#if searchTotal > 0}
				<div class="space-y-2">
					<div class="h-3 w-full overflow-hidden rounded-full bg-gray-100">
						<div class="flex h-full w-full">
							{#each searchSegments as segment (segment.key)}
								<div
									class={`h-full ${segment.barClass}`}
									style={`width: ${segment.percent}%;`}
									title={`${segment.label}: ${formatNumber(segment.value)} (${formatPercent(segment.percent)})`}
								></div>
							{/each}
						</div>
					</div>
					<ul class="space-y-1 text-xs text-gray-600">
						{#each searchSegments as segment (segment.key)}
							<li class="flex items-center justify-between gap-2">
								<span class="flex items-center gap-1">
									<span class={`h-2 w-2 rounded-full ${segment.dotClass}`}></span>
									{segment.label}
								</span>
								<span class="font-medium text-gray-900 metric-value">
									{formatNumber(segment.value)}
									<span class="text-gray-500">
										({formatPercent(segment.percent)})
									</span>
								</span>
							</li>
						{/each}
					</ul>
				</div>
			{:else}
				<div class="space-y-2 text-xs text-gray-500">
					<div class="h-3 w-full rounded-full bg-gray-100"></div>
					<p>No search metrics yet</p>
				</div>
			{/if}
		</div>
		<div class="rounded-2xl border border-white bg-white/70 p-3 space-y-3">
			<div class="flex items-center justify-between text-xs uppercase tracking-wide text-gray-500">
				<span>Live Analysis</span>
				<span class="metric-value">{formatNumber(liveAnalysisTotal)}</span>
			</div>
			{#if liveAnalysisTotal > 0}
				<div class="space-y-2">
					<div class="h-3 w-full overflow-hidden rounded-full bg-gray-100">
						<div class="flex h-full w-full">
							{#each liveAnalysisSegments as segment (segment.key)}
								<div
									class={`h-full ${segment.barClass}`}
									style={`width: ${segment.percent}%;`}
									title={`${segment.label}: ${formatNumber(segment.value)} (${formatPercent(segment.percent)})`}
								></div>
							{/each}
						</div>
					</div>
					<ul class="space-y-1 text-xs text-gray-600">
						{#each liveAnalysisSegments as segment (segment.key)}
							<li class="flex items-center justify-between gap-2">
								<span class="flex items-center gap-1">
									<span class={`h-2 w-2 rounded-full ${segment.dotClass}`}></span>
									{segment.label}
								</span>
								<span class="font-medium text-gray-900 metric-value">
									{formatNumber(segment.value)}
									<span class="text-gray-500">
										({formatPercent(segment.percent)})
									</span>
								</span>
							</li>
						{/each}
					</ul>
				</div>
			{:else}
				<div class="space-y-2 text-xs text-gray-500">
					<div class="h-3 w-full rounded-full bg-gray-100"></div>
					<p>Waiting for live analysis batches</p>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.metric-value {
		display: inline-block;
		transition: color 180ms ease, transform 180ms ease;
	}
</style>
