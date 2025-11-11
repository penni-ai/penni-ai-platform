<script lang="ts">
import { onDestroy } from 'svelte';
import { page } from '$app/stores';
import Button from '$lib/components/Button.svelte';
import SearchResultsTable from '$lib/components/SearchResultsTable.svelte';
	import {
		STAGE_NAMES,
		type StageName,
		type PipelineStatus,
		type StreamEvent,
		type ProgressEvent,
		type StageCompleteEvent,
		type CompleteEvent,
		type ErrorEvent,
		type PipelineStageDocument,
		type SearchPipelineRequest,
		type CreatorProfile
	} from '$lib/types/search';

	type StageMetricStatus = 'pending' | 'running' | 'complete' | 'error';

	type StageMetric = {
		status: StageMetricStatus;
		count?: number;
		duration?: number;
		startedAt?: number;
		completedAt?: number;
	};

	const stageOrder: StageName[] = [...STAGE_NAMES];

	const stageStatusLabels: Record<StageMetricStatus, string> = {
		pending: 'Pending',
		running: 'Running',
		complete: 'Complete',
		error: 'Error'
	};

	const stageStatusClasses: Record<StageMetricStatus, { container: string; badge: string; dot: string }> = {
		pending: {
			container: 'border-gray-200 bg-gray-50/80 text-gray-600',
			badge: 'bg-gray-100 text-gray-600',
			dot: 'bg-gray-400'
		},
		running: {
			container: 'border-blue-200 bg-blue-50 text-blue-700 shadow-[0_0_25px_-10px_rgba(59,130,246,0.7)]',
			badge: 'bg-blue-100 text-blue-700',
			dot: 'bg-blue-500'
		},
		complete: {
			container: 'border-emerald-200 bg-emerald-50 text-emerald-700',
			badge: 'bg-emerald-100 text-emerald-700',
			dot: 'bg-emerald-500'
		},
		error: {
			container: 'border-red-200 bg-red-50 text-red-700',
			badge: 'bg-red-100 text-red-700',
			dot: 'bg-red-500'
		}
	};

	const stageLiveMessages: Record<StageName, string> = {
		SEARCH: 'Searching vector database...',
		BRIGHTDATA: 'Enriching profiles with recent posts...',
		LLM_FIT: 'Scoring profiles against your brief...'
	};

	const stageCompleteMessages: Record<StageName, string> = {
		SEARCH: 'Search completed.',
		BRIGHTDATA: 'Enrichment finished.',
		LLM_FIT: 'LLM fit stage finished.'
	};

	const createStageMetrics = () =>
		new Map<StageName, StageMetric>(stageOrder.map((stage) => [stage, { status: 'pending' }]));

	let searchQuery = $state('sustainable beauty creators');
	let businessQuery = $state('Looking for sustainable beauty influencers for a holiday campaign.');
	let searchLimit = $state(10);
	let includeRaw = $state(false);
let selectedStages = $state<StageName[]>([...stageOrder]);
let lexicalOnly = $state(false);
	let isRunning = $state(false);
	let errorMessage = $state<string | null>(null);
	let pipelineId = $state<string | null>(null);
	let pipelineStatus = $state<PipelineStatus | null>(null);
	let stageMetrics = $state<Map<StageName, StageMetric>>(createStageMetrics());
	let finalResults = $state<PipelineStageDocument[] | null>(null);
	const allProfiles = $derived(finalResults?.flatMap((doc) => doc.profiles ?? []) ?? []);
	const lastStage = $derived(
		finalResults && finalResults.length ? finalResults[finalResults.length - 1] : null
	);
	const lastStageProfiles = $derived(lastStage?.profiles ?? allProfiles);
	let liveMessage = $state<string | null>(null);
	let eventSource = $state<EventSource | null>(null);

	const formatJson = (value: unknown) => JSON.stringify(value ?? null, null, 2);

let streamAbortController: AbortController | null = null;
let streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let sseBuffer = '';
let messageTimeout: ReturnType<typeof setTimeout> | null = null;
let streamCancelledByUser = false;

const parseLexicalFlag = (value: string | null): boolean => {
	if (!value) return false;
	return ['1', 'true', 'yes', 'on', 'lexical'].includes(value.toLowerCase());
};

	function toggleStage(stage: StageName) {
		const next = new Set(selectedStages);
		if (next.has(stage)) {
			next.delete(stage);
		} else {
			next.add(stage);
		}
		selectedStages = stageOrder.filter((name) => next.has(name));
	}

	function setStagesPreset(preset: StageName[]) {
		const presetSet = new Set(preset);
		selectedStages = stageOrder.filter((stage) => presetSet.has(stage));
	}

	function getStageMetric(stage: StageName): StageMetric {
		return stageMetrics.get(stage) ?? { status: 'pending' };
	}

	function setLiveStatus(message: string | null, persistent = true, ttl = 4000) {
		if (messageTimeout) {
			clearTimeout(messageTimeout);
			messageTimeout = null;
		}
		liveMessage = message;
		if (message && !persistent) {
			messageTimeout = setTimeout(() => {
				liveMessage = null;
				messageTimeout = null;
			}, ttl);
		}
	}

	const computePipelineProgress = () =>
		Math.round(Math.min(100, Math.max(0, pipelineStatus?.overall_progress ?? (isRunning ? 5 : 0))));

	function formatFollowersCompact(count: number | undefined | null): string {
		if (count === null || count === undefined) {
			return '—';
		}
		if (count < 1000) {
			return Math.round(count).toString();
		}
		const formatRoundedLabel = (value: number) => {
			const text = value.toFixed(1);
			return text.endsWith('.0') ? text.slice(0, -2) : text;
		};
		if (count < 1_000_000) {
			const thousands = Math.round((count / 1000) * 10) / 10;
			return `${formatRoundedLabel(thousands)}K`;
		}
		const millions = Math.round((count / 1_000_000) * 10) / 10;
		return `${formatRoundedLabel(millions)}M`;
	}

	function formatEngagementRate(rate: number | undefined | null): string {
		if (rate === null || rate === undefined) {
			return '—';
		}
		const normalized = rate > 0 && rate < 1 ? rate * 100 : rate;
		return `${normalized.toFixed(1)}%`;
	}

	function formatFitScore(score: number | undefined | null): string {
		if (score === null || score === undefined) {
			return '—';
		}
		return `${Math.round(score)}/10`;
	}

	const trimIfString = (candidate: unknown): string | undefined => {
		if (typeof candidate !== 'string') {
			return undefined;
		}
		const trimmed = candidate.trim();
		return trimmed.length ? trimmed : undefined;
	};

	function extractUsername(profile: CreatorProfile): string {
		const handle = trimIfString(profile.username);
		if (handle) return handle;
		const account = trimIfString(profile.account);
		if (account) return account;
		const display = trimIfString(profile.display_name);
		if (display) return display;
		return '—';
	}

	function extractEmail(profile: CreatorProfile): string {
		const business = trimIfString(profile.business_email);
		if (business) return business;
		const fallback = trimIfString(profile.email_address);
		if (fallback) return fallback;
		return '—';
	}

	function extractProfileUrl(profile: CreatorProfile): string | null {
		const primary = trimIfString(profile.profile_url);
		if (primary) return primary;
		const fallback = trimIfString(profile.url);
		return fallback ?? null;
	}

	function extractPlatform(profile: CreatorProfile): string {
		const basePlatform = trimIfString(profile.platform) ?? trimIfString(profile.platform_type);
		if (!basePlatform) {
			return 'Unknown';
		}
		return basePlatform.charAt(0).toUpperCase() + basePlatform.slice(1);
	}

	function getPlatformBadgeClass(platform: string): string {
		switch (platform.toLowerCase()) {
			case 'instagram':
				return 'bg-pink-100 text-pink-700';
			case 'tiktok':
				return 'bg-purple-100 text-purple-700';
			case 'youtube':
				return 'bg-red-100 text-red-700';
			default:
				return 'bg-gray-100 text-gray-600';
		}
	}

	function resetStreamingState() {
		pipelineId = null;
		pipelineStatus = null;
		stageMetrics = createStageMetrics();
		finalResults = null;
		liveMessage = null;
	}

	function cleanupStream(abort = false) {
		if (abort) {
			streamAbortController?.abort();
			streamReader?.cancel().catch(() => undefined);
		}
		eventSource = null;
		streamAbortController = null;
		streamReader = null;
	}

	function cancelRun() {
		if (!isRunning) return;
		streamCancelledByUser = true;
		cleanupStream(true);
		isRunning = false;
		setLiveStatus('Pipeline run cancelled.', false, 3000);
	}

	function applyStageMetric(stage: StageName, mutator: (metric: StageMetric) => StageMetric) {
		const next = new Map(stageMetrics);
		const current: StageMetric = {
			status: 'pending',
			...(next.get(stage) ?? {})
		};
		next.set(stage, mutator(current));
		stageMetrics = next;
	}

	function mergePipelineStatus(update: Partial<PipelineStatus> & { pipeline_id: string }) {
		const base: PipelineStatus = pipelineStatus ?? {
			pipeline_id: update.pipeline_id,
			userId: update.userId ?? 'stream-test',
			status: update.status ?? 'running',
			current_stage: update.current_stage ?? null,
			completed_stages: update.completed_stages ?? [],
			overall_progress: update.overall_progress ?? 0
		};

		pipelineStatus = {
			...base,
			...update,
			userId: update.userId ?? base.userId,
			current_stage: update.current_stage ?? base.current_stage ?? null,
			completed_stages: update.completed_stages ?? base.completed_stages,
			overall_progress: update.overall_progress ?? base.overall_progress,
			status: update.status ?? base.status
		};
	}

	function handleProgressEvent(event: ProgressEvent) {
		pipelineId = event.pipeline_id;
		mergePipelineStatus({
			pipeline_id: event.pipeline_id,
			status: event.status,
			current_stage: event.stage,
			completed_stages: event.completed_stages,
			overall_progress: event.progress
		});

		if (event.stage) {
			const startedAt = performance.now();
			applyStageMetric(event.stage, (current) => ({
				...current,
				status: 'running',
				startedAt: current.startedAt ?? startedAt
			}));
			setLiveStatus(stageLiveMessages[event.stage], true);
		}
	}

	function handleStageCompleteEvent(event: StageCompleteEvent) {
		pipelineId = event.pipeline_id;
		applyStageMetric(event.stage, (current) => {
			const completedAt = performance.now();
			const duration =
				current.startedAt !== undefined ? completedAt - current.startedAt : current.duration;
			return {
				...current,
				status: 'complete',
				count: event.count ?? current.count,
				duration: duration ?? current.duration,
				completedAt
			};
		});

		const message =
			event.count !== undefined
				? `${stageCompleteMessages[event.stage]} ${event.count} profiles processed.`
				: stageCompleteMessages[event.stage];
		setLiveStatus(message, true);
	}

	function handleCompleteEvent(event: CompleteEvent) {
		pipelineId = event.pipeline_id;
		finalResults = event.stages ?? [];
		for (const doc of finalResults) {
			applyStageMetric(doc.stage, (current) => ({
				...current,
				status: doc.status === 'error' ? 'error' : 'complete',
				count: doc.profiles?.length ?? current.count
			}));
		}
		setLiveStatus('Pipeline completed successfully!', false, 5000);
		isRunning = false;
	}

	function handleErrorEvent(event: ErrorEvent) {
		pipelineId = event.pipeline_id;
		errorMessage = event.message;
		if (event.stage) {
			applyStageMetric(event.stage, (current) => ({ ...current, status: 'error' }));
		}
		setLiveStatus(event.message, false, 6000);
		isRunning = false;
	}

	function handleConnectionError(message?: string) {
		errorMessage = message ?? 'Connection lost. Please try again.';
		setLiveStatus('Connection lost. Please try again.', false, 5000);
		isRunning = false;
	}

	function dispatchSseEvent(eventName: string, payload: string) {
		if (!payload?.trim()) return;

		if (eventName === 'ack') {
			try {
				const data = JSON.parse(payload) as { pipeline_id?: string };
				pipelineId = data.pipeline_id ?? pipelineId;
				if (!liveMessage) {
					setLiveStatus('Pipeline acknowledged. Waiting for progress...');
				}
			} catch (error) {
				console.error('Failed to parse ack event', error);
			}
			return;
		}

		let parsed: StreamEvent;
		try {
			parsed = JSON.parse(payload) as StreamEvent;
		} catch (error) {
			console.error('Failed to parse stream event', error, payload);
			return;
		}

		switch (eventName) {
			case 'progress':
				handleProgressEvent(parsed as ProgressEvent);
				break;
			case 'stage_complete':
				handleStageCompleteEvent(parsed as StageCompleteEvent);
				break;
			case 'complete':
				handleCompleteEvent(parsed as CompleteEvent);
				break;
			case 'error':
				handleErrorEvent(parsed as ErrorEvent);
				break;
			default:
				console.debug('Unhandled stream event', eventName, parsed);
		}
	}

	function processSseBuffer(buffer: string, flush = false) {
		let working = buffer;
		let boundary = working.indexOf('\n\n');
		while (boundary !== -1) {
			const rawEvent = working.slice(0, boundary);
			working = working.slice(boundary + 2);
			deliverRawEvent(rawEvent);
			boundary = working.indexOf('\n\n');
		}
		if (flush && working.trim()) {
			deliverRawEvent(working);
			working = '';
		}
		return working;
	}

	function deliverRawEvent(raw: string) {
		const sanitized = raw.replace(/\r/g, '');
		if (!sanitized.trim()) return;
		let eventName = 'message';
		const dataLines: string[] = [];
		for (const line of sanitized.split('\n')) {
			if (line.startsWith('event:')) {
				eventName = line.slice(6).trim() || eventName;
			} else if (line.startsWith('data:')) {
				dataLines.push(line.slice(5).trim());
			}
		}
		if (!dataLines.length) return;
		dispatchSseEvent(eventName, dataLines.join('\n'));
	}

	function isAbortError(error: unknown): boolean {
		return (
			(error instanceof DOMException && error.name === 'AbortError') ||
			(error instanceof Error && error.name === 'AbortError')
		);
	}

	async function runTest(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedStages.length) {
			errorMessage = 'Select at least one stage to run the test.';
			return;
		}
		if (!searchQuery.trim()) {
			errorMessage = 'Search query cannot be empty.';
			return;
		}
		if (!businessQuery.trim()) {
			errorMessage = 'Business brief cannot be empty.';
			return;
		}

		cleanupStream(true);
		streamCancelledByUser = false;
		resetStreamingState();
		errorMessage = null;
		isRunning = true;
		setLiveStatus('Initializing pipeline...');
		sseBuffer = '';

	const payload: SearchPipelineRequest = {
		search: {
			query: searchQuery.trim(),
			limit: Number(searchLimit) || 10,
			method: lexicalOnly ? 'lexical' : 'hybrid'
		},
		business_fit_query: businessQuery.trim()
	};

	if (lexicalOnly) {
		payload.search.lexical_scope = payload.search.lexical_scope ?? 'bio';
	}

		if (selectedStages.length && selectedStages.length < stageOrder.length) {
			payload.stop_at_stage = selectedStages[selectedStages.length - 1] ?? null;
		}

		const controller = new AbortController();
		streamAbortController = controller;

		try {
		const response = await fetch('/api/search/stream', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				signal: controller.signal
			});

			if (!response.ok) {
				throw new Error('Streaming endpoint returned an error.');
			}

			if (!response.body) {
				throw new Error('Streaming response is missing a body.');
			}

			const reader = response.body.getReader();
			streamReader = reader;
			const decoder = new TextDecoder('utf-8');

			const connection = {
				close() {
					cleanupStream(true);
				}
			};
			eventSource = connection as unknown as EventSource;

			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				if (value) {
					sseBuffer += decoder.decode(value, { stream: true });
					sseBuffer = processSseBuffer(sseBuffer);
				}
			}
			sseBuffer += decoder.decode();
			sseBuffer = processSseBuffer(sseBuffer, true);
		} catch (error) {
			if (isAbortError(error) && streamCancelledByUser) {
				return;
			}
			if (isAbortError(error)) {
				handleConnectionError('Stream aborted unexpectedly.');
			} else {
				handleConnectionError(error instanceof Error ? error.message : 'Streaming request failed.');
			}
		} finally {
			cleanupStream(false);
			streamCancelledByUser = false;
			if (isRunning && !pipelineStatus && !finalResults) {
				isRunning = false;
			}
		}
	}

	onDestroy(() => {
		cleanupStream(true);
		if (messageTimeout) {
			clearTimeout(messageTimeout);
		}
	});

	const stagePresets: Array<{ label: string; stages: StageName[] }> = [
		{ label: 'Search only', stages: ['SEARCH'] },
		{ label: 'Search + BrightData', stages: ['SEARCH', 'BRIGHTDATA'] },
		{ label: 'Full pipeline', stages: [...stageOrder] }
	];
</script>

<div class="max-w-5xl mx-auto px-6 py-10 space-y-8">
	<section class="space-y-3">
		<p class="text-xs uppercase tracking-wide text-gray-500">Diagnostics</p>
		<h1 class="text-2xl font-semibold text-gray-900">Search Pipeline Stage Tester</h1>
		<p class="text-sm text-gray-600">
			This page calls <code>/api/search/stream</code> to execute the full streaming pipeline with real-time
			feedback. Use it in development environments to quickly diagnose each stage without digging through
			logs.
		</p>
	</section>

	<form class="space-y-6 bg-white border border-gray-200 rounded-3xl shadow-sm p-6" onsubmit={runTest}>
		<div class="grid gap-4 md:grid-cols-2">
			<div>
				<label for="dev-search-query" class="block text-sm font-medium text-gray-700 mb-2">Search Query</label>
				<input
					id="dev-search-query"
					type="text"
					class="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
					bind:value={searchQuery}
					required
				/>
			</div>
			<div>
				<label for="dev-business-brief" class="block text-sm font-medium text-gray-700 mb-2">Business Brief</label>
				<input
					id="dev-business-brief"
					type="text"
					class="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
					bind:value={businessQuery}
					required
				/>
			</div>
		</div>

	<div class="grid gap-4 md:grid-cols-3">
			<div>
				<label for="dev-search-limit" class="block text-sm font-medium text-gray-700 mb-2">Search Limit</label>
				<input
					id="dev-search-limit"
					type="number"
					min="1"
					class="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
					bind:value={searchLimit}
				/>
			</div>
			<div>
				<p class="text-sm font-medium text-gray-700 mb-2">Stage Selection</p>
				<div class="space-y-2">
					{#each stageOrder as stage}
						<label class="flex items-center gap-2 text-sm text-gray-600">
							<input
								type="checkbox"
								checked={selectedStages.includes(stage)}
								onchange={() => toggleStage(stage)}
								class="rounded border-gray-300 text-[#FF6F61] focus:ring-[#FF6F61]"
							/>
							<span>{stage}</span>
						</label>
					{/each}
		</div>
	</div>

	<div class="rounded-2xl border border-gray-200 px-4 py-3 flex items-start gap-3">
		<input
			id="lexical-only-toggle"
			type="checkbox"
			bind:checked={lexicalOnly}
			class="mt-1 rounded border-gray-300 text-[#FF6F61] focus:ring-[#FF6F61]"
		/>
		<div>
			<label for="lexical-only-toggle" class="text-sm font-semibold text-gray-700">Force lexical-only search</label>
			<p class="text-xs text-gray-500 mt-1">
				Appends <code>?lexical_only=1</code> to the streaming request and sets <code>search.method</code> to
				<strong>lexical</strong> for the external API.
			</p>
		</div>
	</div>
			<div>
				<p class="text-sm font-medium text-gray-700 mb-2">Presets</p>
				<div class="space-y-2">
					{#each stagePresets as preset}
						<button
							type="button"
							class="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
							onclick={() => setStagesPreset(preset.stages)}
						>
							{preset.label}
						</button>
					{/each}
				</div>
			</div>
		</div>

		<label class="inline-flex items-center gap-2 text-sm text-gray-600">
			<input
				type="checkbox"
				bind:checked={includeRaw}
				class="rounded border-gray-300 text-[#FF6F61] focus:ring-[#FF6F61]"
			/>
			Include raw callable envelopes in response
		</label>

		<div class="flex flex-wrap gap-3 items-center">
			<Button type="submit" variant="primary" disabled={isRunning}>
				{isRunning ? 'Running...' : 'Run stage test'}
			</Button>
			{#if isRunning}
				<button
					type="button"
					onclick={cancelRun}
					class="rounded-2xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
				>
					Cancel
				</button>
			{/if}
		</div>
	</form>

	{#if isRunning || pipelineStatus || finalResults || liveMessage}
		<section class="bg-white border border-gray-200 rounded-3xl shadow-sm p-6 space-y-5">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<p class="text-xs uppercase tracking-wide text-gray-500">Pipeline Progress</p>
					<p class="text-sm text-gray-600">
						Monitor each stage as events stream from Firebase in real time.
					</p>
				</div>
				{#if pipelineId}
					<span class="font-mono text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
						Pipeline ID: {pipelineId}
					</span>
				{/if}
			</div>

				<div>
					<div class="h-3 w-full rounded-full bg-gray-100 overflow-hidden">
						<div
							class="h-full rounded-full bg-[#FF6F61] transition-all duration-500 ease-out"
							style={`width: ${computePipelineProgress()}%`}
						>
						</div>
					</div>
					<p class="mt-2 text-xs text-gray-600">{computePipelineProgress()}% complete</p>
				</div>

			{#if liveMessage}
				<p class="text-sm font-semibold text-gray-900">{liveMessage}</p>
			{/if}

			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{#each stageOrder as stage}
					{@const metric = getStageMetric(stage)}
					{@const theme = stageStatusClasses[metric.status]}
					<div
						class={`rounded-3xl border-2 p-4 transition-all duration-300 ${theme.container}`}
					>
						<div class="flex items-start justify-between gap-3">
							<div>
								<p class="text-xs uppercase tracking-wide text-gray-500">Stage</p>
								<p class="text-lg font-semibold text-gray-900">{stage}</p>
							</div>
							<span class={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${theme.badge}`}>
								<span class={`h-2 w-2 rounded-full ${theme.dot}`}></span>
								{stageStatusLabels[metric.status]}
							</span>
						</div>
						{#if metric.count !== undefined}
							<p class="mt-3 text-sm text-gray-700">{metric.count} profiles processed</p>
						{/if}
						{#if metric.duration !== undefined}
							<p class="text-xs text-gray-500">{Math.round(metric.duration)} ms</p>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if errorMessage}
		<div class="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
			<p class="font-semibold">Test failed</p>
			<p>{errorMessage}</p>
		</div>
	{/if}

	{#if finalResults && finalResults.length}
		<section class="space-y-4">
			<h2 class="text-lg font-semibold text-gray-900">Stage Documents</h2>
			<div class="space-y-4">
				{#each finalResults as doc}
					<div class="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
						<div class="flex flex-wrap items-center justify-between gap-4">
							<div>
								<p class="text-xs uppercase tracking-wide text-gray-500">Stage</p>
								<p class="text-lg font-semibold text-gray-900">{doc.stage}</p>
							</div>
							<span class={`text-xs font-semibold px-3 py-1 rounded-full ${doc.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
								{doc.status}
							</span>
							<div>
								<p class="text-xs uppercase tracking-wide text-gray-500">Profiles</p>
								<p class="font-semibold text-gray-900">{doc.profiles?.length ?? 0}</p>
							</div>
						</div>

						{#if Object.keys(doc.metadata ?? {}).length}
							<div>
								<p class="text-xs uppercase tracking-wide text-gray-500 mb-2">Metadata preview</p>
								<pre class="rounded-2xl bg-gray-900/5 p-3 text-xs font-mono text-gray-800 overflow-auto">{formatJson(doc.metadata)}</pre>
							</div>
						{/if}

						{#if doc.debug && Object.keys(doc.debug ?? {}).length}
							<div>
								<p class="text-xs uppercase tracking-wide text-gray-500 mb-2">Debug</p>
								<pre class="rounded-2xl bg-gray-900/5 p-3 text-xs font-mono text-gray-800 overflow-auto">{formatJson(doc.debug)}</pre>
							</div>
						{/if}

						{#if includeRaw}
							<div>
								<p class="text-xs uppercase tracking-wide text-gray-500 mb-2">Full document</p>
								<pre class="rounded-2xl bg-gray-900 text-gray-100 p-4 text-xs font-mono overflow-auto">{formatJson(doc)}</pre>
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<div class="space-y-3">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div>
						<p class="text-xs uppercase tracking-wide text-gray-500">Results</p>
						<h3 class="text-lg font-semibold text-gray-900">Creator Profiles</h3>
					</div>
					<p class="text-sm text-gray-600">
						Showing {lastStageProfiles.length} profiles{#if lastStage}
						 	from {lastStage.stage} stage
						{/if}
					</p>
				</div>
				<SearchResultsTable profiles={lastStageProfiles as CreatorProfile[]} />
			</div>

			<div class="bg-white border border-gray-200 rounded-3xl shadow-sm p-6 space-y-3">
				<p class="text-sm font-semibold text-gray-700">All Results (JSON)</p>
				<pre class="rounded-2xl bg-gray-900/5 p-4 text-xs font-mono text-gray-800 overflow-auto">{formatJson(finalResults)}</pre>
			</div>
		</section>
	{:else if !isRunning}
		<p class="text-sm text-gray-500">Run a test to see live pipeline updates.</p>
	{/if}
</div>
