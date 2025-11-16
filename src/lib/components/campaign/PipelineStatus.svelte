<script lang="ts">
	import type { PipelineStatus as PipelineStatusType } from '$lib/types/campaign';

	interface Props {
		status: PipelineStatusType;
	}

	let { status }: Props = $props();

	function getEstimatedTimeRemaining(progress: number): string {
		if (progress >= 100) return "Complete";
		if (progress <= 0) return "~4 minutes";
		
		// Typical total time is 3-5 minutes, use 4 minutes (240 seconds) as average
		const totalEstimatedSeconds = 240;
		const remainingProgress = 100 - progress;
		const estimatedSecondsRemaining = Math.ceil((remainingProgress / 100) * totalEstimatedSeconds);
		
		if (estimatedSecondsRemaining < 60) {
			return `~${estimatedSecondsRemaining} seconds`;
		}
		
		const minutes = Math.floor(estimatedSecondsRemaining / 60);
		const seconds = estimatedSecondsRemaining % 60;
		
		if (seconds === 0) {
			return `~${minutes} minute${minutes !== 1 ? 's' : ''}`;
		}
		
		return `~${minutes}m ${seconds}s`;
	}
</script>

<div class="mx-auto w-full max-w-6xl space-y-6">
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

	<!-- Pipeline Progress -->
	{#if status.status !== 'completed'}
		<div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
			<div class="mb-4">
				<div class="mb-2 flex items-center justify-between text-sm">
					<span class="font-medium text-gray-700">Overall Progress</span>
					<div class="flex items-center gap-2">
						{#if status.status === 'running'}
							<span class="text-xs text-gray-500">
								Est. {getEstimatedTimeRemaining(status.overall_progress)} remaining
							</span>
						{/if}
						<span class="text-gray-500">{status.overall_progress}%</span>
					</div>
				</div>
				<div class="h-3 w-full overflow-hidden rounded-full bg-gray-100">
					<div
						class="h-full bg-[#FF6F61] transition-all duration-300"
						style="width: {status.overall_progress}%"
					></div>
				</div>
			</div>
			
			<!-- Stage Status -->
			<div class="grid grid-cols-2 gap-4 text-sm">
				<div class="rounded-lg border border-gray-200 p-3">
					<div class="flex items-center justify-between">
						<span class="text-gray-600">Query Expansion</span>
						<span class="font-medium capitalize text-gray-900">{status.stages.query_expansion?.status ?? 'pending'}</span>
					</div>
					{#if status.stages.query_expansion?.queries}
						<p class="mt-1 text-xs text-gray-500">{status.stages.query_expansion.queries.length} queries generated</p>
					{/if}
				</div>
				<div class="rounded-lg border border-gray-200 p-3">
					<div class="flex items-center justify-between">
						<span class="text-gray-600">Weaviate Search</span>
						<span class="font-medium capitalize text-gray-900">{status.stages.weaviate_search?.status ?? 'pending'}</span>
					</div>
					{#if status.stages.weaviate_search?.deduplicated_results}
						<p class="mt-1 text-xs text-gray-500">{status.stages.weaviate_search.deduplicated_results} unique profiles</p>
					{/if}
				</div>
				<div class="rounded-lg border border-gray-200 p-3">
					<div class="flex items-center justify-between">
						<span class="text-gray-600">BrightData Collection</span>
						<span class="font-medium capitalize text-gray-900">{status.stages.brightdata_collection?.status ?? 'pending'}</span>
					</div>
					{#if status.stages.brightdata_collection}
						<p class="mt-1 text-xs text-gray-500">
							{status.stages.brightdata_collection.profiles_collected ?? 0} collected
							{#if status.stages.brightdata_collection.total_batches}
								({status.stages.brightdata_collection.batches_completed ?? 0}/{status.stages.brightdata_collection.total_batches} batches)
							{/if}
						</p>
					{/if}
				</div>
				<div class="rounded-lg border border-gray-200 p-3">
					<div class="flex items-center justify-between">
						<span class="text-gray-600">LLM Analysis</span>
						<span class="font-medium capitalize text-gray-900">{status.stages.llm_analysis?.status ?? 'pending'}</span>
					</div>
					{#if status.stages.llm_analysis?.profiles_analyzed}
						<p class="mt-1 text-xs text-gray-500">{status.stages.llm_analysis.profiles_analyzed} analyzed</p>
					{/if}
				</div>
			</div>
		
			{#if status.error_message}
				<div class="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
					<strong>Error:</strong> {status.error_message}
				</div>
			{/if}
		</div>
	{/if}
</div>

