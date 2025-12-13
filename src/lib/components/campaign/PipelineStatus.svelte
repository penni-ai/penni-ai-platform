<script lang="ts">
	import type { PipelineStatus as PipelineStatusType } from '$lib/types/campaign';
	import QuerySearchAnimation from './QuerySearchAnimation.svelte';
	import UnifiedProgressBar from './UnifiedProgressBar.svelte';

	interface Props {
		status: PipelineStatusType;
	}

	let { status }: Props = $props();
</script>

<div class="mx-auto w-full max-w-6xl space-y-6">
	{#if status.status !== 'completed'}
		<div>
			<h2 class="text-2xl font-semibold text-gray-900">Influencer Search</h2>
			<p class="mt-1 text-sm text-gray-500">
				Pipeline Status: <span class="font-medium capitalize text-gray-900">{status.status}</span>
				{#if status.status === 'running'}
					<span class="ml-2 inline-flex items-center gap-1">
						<span class="h-2 w-2 animate-pulse rounded-full bg-green-500"></span>
						<span class="text-xs text-gray-500">Processing...</span>
					</span>
				{/if}
			</p>
		</div>
	{/if}

	<!-- Pipeline Progress -->
	{#if status.status !== 'completed'}
		<div class="space-y-4">
			<!-- Unified Progress Bar -->
			<UnifiedProgressBar {status} />

			<!-- Query Search Animation - only show during query expansion and weaviate search stages -->
			{#if status.status === 'running' && status.stages.query_expansion?.queries && status.stages.query_expansion.queries.length > 0}
				{@const isQueryExpansionRunning = status.stages.query_expansion?.status === 'running'}
				{@const isWeaviateSearchRunning = status.stages.weaviate_search?.status === 'running'}
				{@const isBrightDataRunning = status.stages.brightdata_collection?.status === 'running'}
				{@const isLLMRunning = status.stages.llm_analysis?.status === 'running'}
				{@const isInAnalysisPhase = isBrightDataRunning || isLLMRunning || status.overall_progress > 50}
				{@const shouldShowQueries = (isQueryExpansionRunning || isWeaviateSearchRunning) && !isInAnalysisPhase}
				{#if shouldShowQueries}
					<div class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
						<QuerySearchAnimation
							queries={status.stages.query_expansion.queries}
							stage={isWeaviateSearchRunning ? 'weaviate_search' : 'query_expansion'}
							isRunning={shouldShowQueries}
						/>
					</div>
				{/if}
			{/if}

			{#if status.error_message}
				<div class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
					<strong>Error:</strong> {status.error_message}
				</div>
			{/if}
		</div>
	{/if}
</div>
