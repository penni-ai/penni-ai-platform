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
		<div class="border-b border-gray-100 pb-4">
			<h2 class="text-xl font-semibold text-gray-900 tracking-tight">Influencer Search</h2>
			<p class="mt-1 text-sm text-gray-500">
				<span class="uppercase text-[10px] tracking-wider text-gray-400">Status</span>
				<span class="ml-2 font-medium capitalize text-gray-900">{status.status}</span>
				{#if status.status === 'running'}
					<span class="ml-2 inline-flex items-center gap-1.5">
						<span class="h-1.5 w-1.5 animate-pulse bg-[#FF6F61]"></span>
						<span class="text-xs text-gray-500">Processing</span>
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
					<div class="border border-gray-100 bg-white p-4">
						<QuerySearchAnimation
							queries={status.stages.query_expansion.queries}
							stage={isWeaviateSearchRunning ? 'weaviate_search' : 'query_expansion'}
							isRunning={shouldShowQueries}
						/>
					</div>
				{/if}
			{/if}

			{#if status.error_message}
				<div class="border-l-2 border-red-400 bg-red-50/50 px-4 py-3 text-sm text-gray-700">
					<span class="font-medium text-gray-900">Error:</span> {status.error_message}
				</div>
			{/if}
		</div>
	{/if}
</div>
