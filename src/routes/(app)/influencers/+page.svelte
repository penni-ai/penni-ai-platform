<script lang="ts">
    import { browser } from '$app/environment';
    import { onDestroy, onMount } from 'svelte';
    import Button from '$lib/components/Button.svelte';
    import { firebaseFirestore } from '$lib/firebase/client';
    import { doc, updateDoc } from 'firebase/firestore';
    import type {
        BatchCompleteEvent,
        CancelledEvent,
        CompleteEvent,
        CreatorProfile,
        ErrorEvent,
        FlowMetrics,
        FlowMetricsEvent,
        PipelineRunStatus,
        ProgressEvent,
        SearchPipelineRequest,
        StageName
    } from '$lib/types/search';

    	let { data }: {
    		data: {
    			influencers: CreatorProfile[];
    			campaigns: Array<{ id: string; name: string }>;
    			profile: { full_name?: string };
    			error: string | null;
    			searchParams?: {
    				query: string;
    				business_query: string;
    				min_followers: number | null;
    				max_followers: number | null;
    				location?: string | null;
    				category?: string | null;
    			};
    			searchPayload?: SearchPipelineRequest;
    		};
    	} = $props();

    const campaigns = data.campaigns ?? [];
    const brandLabel = data.profile?.full_name ?? 'your brand';
    const SSE_BUFFER_OVERFLOW_BYTES = 1_500_000;

    	let platformFilter = $state('all');
    	let selectedCampaignId = $state<string | null>(campaigns[0]?.id ?? null);
    	let searchQuery = $state(data.searchParams?.query ?? '');
    	let businessQuery = $state(data.searchParams?.business_query ?? '');
    	let minFollowers = $state<number | null>(data.searchParams?.min_followers ?? null);
    	let maxFollowers = $state<number | null>(data.searchParams?.max_followers ?? null);
    	let locationFilter = $state<string | null>(data.searchParams?.location ?? null);
    	let categoryFilter = $state<string | null>(data.searchParams?.category ?? null);
    	let liveInfluencers = $state<CreatorProfile[]>(data.influencers ?? []);
    	let pipelineId = $state<string | null>(null);
    	let streamingProgress = $state(0);
    	let streamingStatus = $state('idle');
    	let streamError = $state<string | null>(data.error ?? null);
    	let isSearching = $state(false);
    	let showAdvancedFilters = $state(false);

    const batchProfiles = new Map<number, CreatorProfile[]>();
    const batchSegments = new Map<number, { start: number; length: number }>();
    let sseBuffer = '';
    let streamAbortController: AbortController | null = null;
    let streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let flowMetrics = $state<FlowMetrics | null>(null);
    let pendingCancelSignal = $state(false);
    let cancellingPipeline = $state(false);
    let wasCancelled = $state(false);

    	const platforms = $derived(
    		Array.from(
    			liveInfluencers.reduce((set, influencer) => {
    				const platform =
    					(influencer.platform as string | undefined) ??
    					(influencer.platform_type as string | undefined);
    				if (platform) set.add(platform);
    				return set;
    			}, new Set<string>())
    		).sort()
    	);

    const filteredInfluencers = $derived(
        liveInfluencers.filter((influencer) => {
            if (platformFilter === 'all') return true;
            const platform =
                (influencer.platform as string | undefined) ??
                (influencer.platform_type as string | undefined);
            return platform === platformFilter;
        })
    );

    const flowMetricCards = $derived(
        flowMetrics
            ? [
                    { label: 'Initial matches', value: flowMetrics.initial_count.toLocaleString() },
                    { label: 'Deduped kept', value: flowMetrics.deduped_kept.toLocaleString() },
                    { label: 'Deduped discarded', value: flowMetrics.deduped_discarded.toLocaleString() },
                    { label: 'Advancing to enrichment', value: flowMetrics.deduped_kept.toLocaleString() },
                    { label: 'BrightData success', value: flowMetrics.brightdata_success.toLocaleString() },
                    { label: 'LLM ≥5', value: flowMetrics.llm_above_5.toLocaleString() },
                    { label: 'Batches', value: `${flowMetrics.completed_batches}/${flowMetrics.total_batches}` }
                ] satisfies Array<{ label: string; value: string }>
            : []
    );

    	function buildSearchPayload(): SearchPipelineRequest {
    		const payload: SearchPipelineRequest = {
    			search: {
    				query: searchQuery.trim(),
    				method: 'hybrid',
    				limit: 50
    			},
    			business_fit_query: businessQuery.trim(),
    			debug_mode: false
    		};
    		if (minFollowers != null) payload.search.min_followers = minFollowers;
    		if (maxFollowers != null) payload.search.max_followers = maxFollowers;
    		if (locationFilter) payload.search.location = locationFilter;
    		if (categoryFilter) payload.search.category = categoryFilter;
    		return payload;
    	}

    	function syncSearchParamsToUrl() {
    		if (typeof window === 'undefined') return;
    		const url = new URL(window.location.href);
    		const setOrDelete = (key: string, value: string | null) => {
    			if (value && value.length) {
    				url.searchParams.set(key, value);
    			} else {
    				url.searchParams.delete(key);
    			}
    		};
    		setOrDelete('query', searchQuery.trim() || null);
    		setOrDelete('business_query', businessQuery.trim() || null);
    		setOrDelete('min_followers', minFollowers != null ? String(minFollowers) : null);
    		setOrDelete('max_followers', maxFollowers != null ? String(maxFollowers) : null);
    		setOrDelete('location', locationFilter?.trim() || null);
    		setOrDelete('category', categoryFilter?.trim() || null);
    		window.history.replaceState({}, '', url);
    	}

    function resetStreamState() {
        streamError = null;
        streamingProgress = 0;
        streamingStatus = 'initializing';
        pipelineId = null;
        batchProfiles.clear();
        batchSegments.clear();
        liveInfluencers = [];
        sseBuffer = '';
        flowMetrics = null;
        wasCancelled = false;
        pendingCancelSignal = false;
        cancellingPipeline = false;
    }

    function cleanupStream(abortActive: boolean) {
        if (abortActive && streamReader) {
            try {
                streamReader.cancel();
            } catch (error) {
                console.debug('Stream reader cancel failed', error);
            }
        }
        if (abortActive && streamAbortController) {
            try {
                streamAbortController.abort();
            } catch (error) {
                console.debug('Stream abort failed', error);
            }
        }
        streamAbortController = null;
        streamReader = null;
    }

    function updateInfluencersFromBatches(seq: number, profiles: CreatorProfile[]) {
        const incoming = Array.isArray(profiles) ? profiles : [];
        const existing = batchSegments.get(seq);
        if (!existing) {
            const startIndex = liveInfluencers.length;
            if (!incoming.length) {
                batchSegments.set(seq, { start: startIndex, length: 0 });
                return;
            }
            const next = liveInfluencers.slice();
            next.push(...incoming);
            liveInfluencers = next;
            batchSegments.set(seq, { start: startIndex, length: incoming.length });
            return;
        }

        const next = liveInfluencers.slice();
        next.splice(existing.start, existing.length, ...incoming);
        liveInfluencers = next;
        const delta = incoming.length - existing.length;
        existing.length = incoming.length;
        if (delta !== 0) {
            batchSegments.forEach((segment, batchSeq) => {
                if (batchSeq !== seq && segment.start > existing.start) {
                    segment.start += delta;
                }
            });
        }
    }

    function handleAckEvent(payload: { pipeline_id?: string }) {
        pipelineId = payload.pipeline_id ?? null;
        if (!streamingStatus.startsWith('search')) {
            streamingStatus = 'searching creators';
        }
        if (pipelineId && pendingCancelSignal) {
            pendingCancelSignal = false;
            void requestPipelineCancellation(pipelineId);
        }
    }

	function stageStatusLabel(stage: StageName | null, status: PipelineRunStatus): string {
		if (status === 'completed') return 'Search complete';
		if (status === 'error') return 'Pipeline encountered an error';
		if (!stage) return 'Starting pipeline...';
		switch (stage) {
			case 'SEARCH':
				return 'Searching creators';
			case 'LIVE_ANALYSIS':
				return 'Live analysis';
			default:
				return 'Running pipeline';
		}
	}

    	function handleProgressEvent(event: ProgressEvent) {
    		streamingProgress = Math.max(0, Math.min(100, Math.round(event.progress ?? 0)));
    		streamingStatus = stageStatusLabel(event.stage ?? null, event.status);
    	}

    function handleBatchCompleteEvent(event: BatchCompleteEvent) {
        const { batch } = event;
        if (!batch || typeof batch.seq !== 'number') {
            return;
        }
        const profiles = Array.isArray(batch.profiles) ? batch.profiles : [];
        batchProfiles.set(batch.seq, profiles);
        updateInfluencersFromBatches(batch.seq, profiles);
    }

    function handleCompleteEvent(event: CompleteEvent) {
        streamingProgress = 100;
        streamingStatus = 'complete';
        isSearching = false;
        wasCancelled = false;
        cancellingPipeline = false;
        pendingCancelSignal = false;
        if (!pipelineId) {
            pipelineId = event.pipeline_id;
        }
        if (event.flow_metrics) {
            flowMetrics = event.flow_metrics;
        }
    }

    function handleErrorEvent(event: ErrorEvent) {
        streamError = event.message ?? 'Pipeline failed. Please try again.';
        streamingStatus = 'error';
        isSearching = false;
        wasCancelled = false;
        cancellingPipeline = false;
        pendingCancelSignal = false;
    }

    function handleFlowMetricsEvent(event: FlowMetricsEvent) {
        flowMetrics = event.metrics;
    }

    function handleCancelledEvent(event: CancelledEvent) {
        wasCancelled = true;
        isSearching = false;
        streamingStatus = 'cancelled';
        streamError = null;
        pendingCancelSignal = false;
        cancellingPipeline = false;
        if (!pipelineId) {
            pipelineId = event.pipeline_id ?? null;
        }
    }

    function handleConnectionError(message: string) {
        streamError = message;
        streamingStatus = 'error';
        isSearching = false;
        cancellingPipeline = false;
        pendingCancelSignal = false;
    }

    	function dispatchSseEvent(eventName: string, rawData: string) {
    		try {
    			const parsed = JSON.parse(rawData);
    			switch (eventName) {
    				case 'ack':
    					handleAckEvent(parsed as { pipeline_id?: string });
    					break;
    				case 'progress':
    					handleProgressEvent(parsed as ProgressEvent);
    					break;
                case 'batch_complete':
                    handleBatchCompleteEvent(parsed as BatchCompleteEvent);
                    break;
                case 'complete':
                    handleCompleteEvent(parsed as CompleteEvent);
                    break;
                case 'error':
                    handleErrorEvent(parsed as ErrorEvent);
                    break;
                case 'flow_metrics':
                    handleFlowMetricsEvent(parsed as FlowMetricsEvent);
                    break;
                case 'cancelled':
                    handleCancelledEvent(parsed as CancelledEvent);
                    break;
                default:
                    console.debug('Unhandled stream event', eventName, parsed);
            }
    		} catch (error) {
    			console.error('Failed to parse stream event', eventName, rawData, error);
    		}
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
        if (!flush && working.length > SSE_BUFFER_OVERFLOW_BYTES) {
            console.warn('SSE buffer exceeded threshold; forcing flush');
            deliverRawEvent(working);
            working = '';
        }
        return working;
    }

	function isAbortError(error: unknown): boolean {
    		return (
    			(error instanceof DOMException && error.name === 'AbortError') ||
    			(error instanceof Error && error.name === 'AbortError')
    		);
    	}

    async function startStreamingSearch(updateUrl: boolean) {
        if (!searchQuery.trim() || !businessQuery.trim()) {
            return;
        }
    		if (updateUrl) {
    			syncSearchParamsToUrl();
    		}
    		resetStreamState();
    		cleanupStream(true);
    		isSearching = true;
    		const payload = buildSearchPayload();
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

    			const body = response.body;
    			if (!body) {
    				throw new Error('Streaming response is missing a body.');
    			}

    			const reader = body.getReader();
    			streamReader = reader;
    			const decoder = new TextDecoder('utf-8');

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
    			if (isAbortError(error)) {
    				return;
    			}
    			handleConnectionError(error instanceof Error ? error.message : 'Streaming request failed.');
    		} finally {
    			cleanupStream(false);
    			isSearching = false;
    			if (streamingStatus === 'initializing' && !streamError) {
    				streamingStatus = 'idle';
    			}
        }
    }

    async function requestPipelineCancellation(id: string | null) {
        if (!browser || !id) return;
        cancellingPipeline = true;
        try {
            const pipelineRef = doc(firebaseFirestore, 'search_pipeline_runs', id);
            await updateDoc(pipelineRef, { cancel_requested: true });
        } catch (error) {
            console.error('Failed to request pipeline cancellation', error);
            streamError = 'Failed to notify the backend about cancellation. Some work may continue briefly.';
        } finally {
            cancellingPipeline = false;
        }
    }

    async function handleSearch(event: SubmitEvent) {
        event.preventDefault();
        await startStreamingSearch(true);
    }

    async function cancelSearch() {
        cleanupStream(true);
        isSearching = false;
        streamingStatus = 'cancelling...';
        wasCancelled = true;
        if (!pipelineId) {
            pendingCancelSignal = true;
            return;
        }
        await requestPipelineCancellation(pipelineId);
        streamingStatus = 'cancelled';
    }

    	onMount(() => {
    		if (data.searchPayload && searchQuery.trim() && businessQuery.trim()) {
    			startStreamingSearch(false);
    		}
    	});

    	onDestroy(() => {
    		cleanupStream(true);
    	});

    	function formatFollowers(count: number | undefined | null): string {
    		if (!count) return '—';
    		return count.toLocaleString();
    	}

    	function formatEngagement(rate: number | undefined | null): string {
    		if (rate == null) return '—';
    		return `${rate.toFixed(1)}%`;
    	}

    	function getDisplayName(profile: CreatorProfile): string {
    		const displayName = profile.display_name as string | undefined;
    		const username = profile.username as string | undefined;
    		const account = profile.account;
    		const name = profile.name as string | undefined;
    		return displayName ?? username ?? account ?? name ?? 'Unknown';
    	}

    	function getHandle(profile: CreatorProfile): string {
    		const handle = profile.account ?? (profile.username as string | undefined);
    		return handle ?? '—';
    	}

    	function getPlatform(profile: CreatorProfile): string {
    		const platform = (profile.platform as string | undefined) ?? (profile.platform_type as string | undefined);
    		return platform ?? 'Unknown';
    	}

    	function getLocation(profile: CreatorProfile): string {
    		const address = profile.business_address as string | undefined;
    		const location = profile.location as string | undefined;
    		return address ?? location ?? '—';
    	}

    	function getBio(profile: CreatorProfile): string {
    		const bio = (profile.biography as string | undefined) ?? (profile.bio as string | undefined) ?? '';
    		return bio.length > 100 ? `${bio.slice(0, 97)}...` : bio;
    	}

    	function hasBio(profile: CreatorProfile): boolean {
    		const bio = (profile.biography as string | undefined) ?? (profile.bio as string | undefined) ?? '';
    		return bio.trim().length > 0;
    	}

    	function getFitScore(profile: CreatorProfile): string {
    		if (profile.fit_score == null) return '—';
    		return `${Math.round(profile.fit_score)}/100`;
    	}
    </script>


<div class="max-w-6xl mx-auto px-6 lg:px-12 py-12 space-y-10">
	<section class="space-y-3">
		<p class="text-xs uppercase tracking-wide text-gray-500">Influencer directory</p>
		<h1 class="text-3xl font-semibold text-gray-900">Build your next creator shortlist</h1>
	<p class="text-sm text-gray-500">
		Browsing {liveInfluencers.length} creators picked for {brandLabel}. Filter by platform or keyword to narrow your list.
	</p>
	</section>

	<section class="bg-white border border-gray-200 rounded-3xl shadow-sm p-6 space-y-4">
		<form onsubmit={handleSearch} class="space-y-4">
			<div class="grid gap-4 md:grid-cols-2">
				<div>
					<label for="search-query" class="block text-sm font-medium text-gray-700 mb-2">Search Query</label>
					<input
						type="text"
						id="search-query"
						bind:value={searchQuery}
						placeholder="e.g., beauty influencers in Los Angeles"
						required
						class="w-full rounded-2xl border border-gray-200 px-5 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
					/>
				</div>
				<div>
					<label for="business-query" class="block text-sm font-medium text-gray-700 mb-2">Business Brief</label>
					<input
						type="text"
						id="business-query"
						bind:value={businessQuery}
						placeholder="e.g., Looking for authentic lifestyle creators"
						required
						class="w-full rounded-2xl border border-gray-200 px-5 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
					/>
				</div>
			</div>

			<button
				type="button"
				onclick={() => (showAdvancedFilters = !showAdvancedFilters)}
				class="text-sm text-gray-600 hover:text-gray-900"
			>
				{showAdvancedFilters ? '− Hide' : '+ Show'} advanced filters
			</button>

			{#if showAdvancedFilters}
				<div class="grid gap-4 md:grid-cols-2">
					<div>
						<label for="min-followers" class="block text-sm font-medium text-gray-700 mb-2">Min Followers</label>
						<input
							type="number"
							id="min-followers"
							bind:value={minFollowers}
							placeholder="e.g., 10000"
							class="w-full rounded-2xl border border-gray-200 px-5 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
						/>
					</div>
					<div>
						<label for="max-followers" class="block text-sm font-medium text-gray-700 mb-2">Max Followers</label>
						<input
							type="number"
							id="max-followers"
							bind:value={maxFollowers}
							placeholder="e.g., 100000"
							class="w-full rounded-2xl border border-gray-200 px-5 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
						/>
					</div>
				</div>
			{/if}

			<Button type="submit" variant="primary" disabled={isSearching || !searchQuery.trim() || !businessQuery.trim()}>
				{isSearching ? 'Searching...' : 'Search Creators'}
			</Button>
		</form>
</section>

	{#if (isSearching || pipelineId) && !streamError}
		<div class="bg-white border border-gray-200 rounded-3xl shadow-sm p-6 space-y-3">
			<div class="flex items-center justify-between text-sm text-gray-600">
				<p class="font-medium text-gray-900">{streamingStatus}</p>
				<p class="font-semibold text-gray-900">{streamingProgress}%</p>
			</div>
			<div class="h-2 rounded-full bg-gray-100 overflow-hidden">
				<div
					class="h-2 rounded-full bg-[#FF6F61] transition-all duration-200"
					style={`width: ${streamingProgress}%`}
				></div>
			</div>
            {#if pipelineId}
                <p class="text-xs text-gray-500">Pipeline ID: {pipelineId}</p>
            {/if}
            {#if flowMetricCards.length}
                <div class="grid gap-3 sm:grid-cols-3 text-sm text-gray-600">
                    {#each flowMetricCards as metric}
                        <div class="rounded-2xl border border-gray-100 px-4 py-3">
                            <p class="text-xs uppercase tracking-wide text-gray-500">{metric.label}</p>
                            <p class="mt-1 font-semibold text-gray-900">{metric.value}</p>
                        </div>
                    {/each}
                </div>
            {/if}
            {#if isSearching}
                <button
                    type="button"
                    onclick={cancelSearch}
                    class="text-xs text-gray-500 underline underline-offset-2 disabled:opacity-60"
                    disabled={cancellingPipeline}
                >
                    {cancellingPipeline ? 'Cancelling...' : 'Cancel search'}
                </button>
            {/if}
        </div>
    {/if}

    {#if streamError}
        <div class="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 shadow-sm">
            <p class="font-semibold">Search failed</p>
            <p>{streamError}</p>
        </div>
    {:else if wasCancelled}
        <div class="rounded-2xl border border-yellow-100 bg-yellow-50 px-5 py-4 text-sm text-yellow-800 shadow-sm">
            <p class="font-semibold">Search cancelled</p>
            <p>The pipeline stopped at your request. Start a new search when you're ready.</p>
        </div>
    {/if}

	<section class="bg-white border border-gray-200 rounded-3xl shadow-sm p-6 space-y-4">
		<div class="grid gap-4 md:grid-cols-2">
			<div>
				<label for="platform-filter" class="block text-sm font-medium text-gray-700 mb-2">Platform</label>
				<select
					id="platform-filter"
					bind:value={platformFilter}
					class="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
				>
					<option value="all">All platforms</option>
					{#each platforms as platform}
						<option value={platform}>{platform}</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="campaign-filter" class="block text-sm font-medium text-gray-700 mb-2">Campaign</label>
				<select
					id="campaign-filter"
					bind:value={selectedCampaignId}
					class="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
				>
					{#if !campaigns.length}
						<option value="">No campaigns yet</option>
					{:else}
						{#each campaigns as campaign}
							<option value={campaign.id}>{campaign.name}</option>
						{/each}
					{/if}
				</select>
			</div>
		</div>

	</section>

	<section class="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
		{#if filteredInfluencers.length}
			{#each filteredInfluencers as influencer}
				<article class="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
					<div class="flex items-start justify-between">
						<div>
							<h2 class="text-lg font-semibold text-gray-900">{getDisplayName(influencer)}</h2>
							<p class="text-sm text-gray-500">{getHandle(influencer)}</p>
						</div>
						<span class="rounded-full bg-gray-100 px-3 py-1 text-xs capitalize text-gray-600">{getPlatform(influencer)}</span>
					</div>
					<div class="grid grid-cols-2 gap-3 text-sm text-gray-600">
						<div>
							<p class="text-xs uppercase tracking-wide text-gray-500">Followers</p>
							<p class="mt-1 font-semibold text-gray-900">{formatFollowers(influencer.followers)}</p>
						</div>
						<div>
							<p class="text-xs uppercase tracking-wide text-gray-500">Engagement</p>
							<p class="mt-1 font-semibold text-gray-900">{formatEngagement(influencer.avg_engagement)}</p>
						</div>
						<div>
							<p class="text-xs uppercase tracking-wide text-gray-500">Location</p>
							<p class="mt-1">{getLocation(influencer)}</p>
						</div>
						<div>
							<p class="text-xs uppercase tracking-wide text-gray-500">Fit Score</p>
							<p class="mt-1 font-semibold text-gray-900">{getFitScore(influencer)}</p>
						</div>
					</div>
					{#if hasBio(influencer)}
						<p class="text-sm text-gray-600">{getBio(influencer)}</p>
					{/if}
					<Button
						class="w-full justify-center"
						onclick={() => alert('Add to campaign: demo interaction only')}
					>
						{selectedCampaignId
							? `Add to ${campaigns.find((c) => c.id === selectedCampaignId)?.name ?? 'campaign'}`
							: 'Select a campaign first'}
					</Button>
				</article>
			{/each}
		{:else}
			{#if isSearching}
				<div class="col-span-full text-center py-12">
					<p class="text-lg font-semibold text-gray-700">Streaming results…</p>
					<p class="text-sm text-gray-500 mt-2">Profiles will appear here as soon as each batch finishes.</p>
				</div>
			{:else if streamError}
				<div class="col-span-full text-center py-12">
					<p class="text-lg font-semibold text-gray-700">We couldn't load creators</p>
					<p class="text-sm text-gray-500 mt-2">Fix the error above, then try searching again.</p>
				</div>
			{:else}
				<div class="col-span-full text-center py-12">
					<p class="text-lg font-semibold text-gray-700">No creators match your filters</p>
					<p class="text-sm text-gray-500 mt-2">Adjust your brief or follower range to broaden the search.</p>
				</div>
			{/if}
		{/if}
	</section>
</div>
