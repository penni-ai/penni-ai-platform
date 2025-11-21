<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	
	interface Props {
		queries?: string[];
		stage: 'query_expansion' | 'weaviate_search' | 'both';
		isRunning: boolean;
	}
	
	let { queries = [], stage, isRunning }: Props = $props();
	
	// Current query being displayed
	let currentQueryIndex = $state(0);
	let rotationInterval: ReturnType<typeof setInterval> | null = null;
	const ROTATION_INTERVAL_MS = 3000; // Rotate every 3 seconds
	
	// Determine what to display based on stage
	const displayQueries = $derived(() => {
		if (queries.length === 0) return [];
		return queries;
	});
	
	const currentQuery = $derived(() => {
		if (displayQueries().length === 0) return null;
		return displayQueries()[currentQueryIndex % displayQueries().length];
	});
	
	// Get display text based on stage
	const displayText = $derived(() => {
		if (stage === 'query_expansion') {
			return 'Analyzing categories and generating search queries...';
		} else if (stage === 'weaviate_search') {
			return 'Searching for:';
		}
		return 'Searching for:';
	});
	
	// Rotate through queries
	function rotateQuery() {
		if (displayQueries().length > 1) {
			currentQueryIndex = (currentQueryIndex + 1) % displayQueries().length;
		}
	}
	
	// Set up rotation when running and queries are available
	$effect(() => {
		if (isRunning && displayQueries().length > 0) {
			// Initial query
			currentQueryIndex = 0;
			
			// Set up rotation interval if we have multiple queries
			if (displayQueries().length > 1) {
				if (rotationInterval) {
					clearInterval(rotationInterval);
				}
				
				rotationInterval = setInterval(() => {
					rotateQuery();
				}, ROTATION_INTERVAL_MS);
			}
			
			return () => {
				if (rotationInterval) {
					clearInterval(rotationInterval);
					rotationInterval = null;
				}
			};
		} else {
			// Reset to first query when not running
			currentQueryIndex = 0;
			if (rotationInterval) {
				clearInterval(rotationInterval);
				rotationInterval = null;
			}
		}
	});
</script>

{#if isRunning && displayQueries().length > 0}
	<div class="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
		<div class="flex items-center gap-2">
			<div class="h-2 w-2 animate-pulse rounded-full bg-blue-500"></div>
			<span class="text-sm font-medium text-blue-900">{displayText()}</span>
		</div>
		{#if currentQuery() && stage !== 'query_expansion'}
			<div class="flex-1 overflow-hidden">
				<span
					class="inline-block text-sm font-semibold text-blue-700"
					in:fly={{ y: -10, duration: 300, opacity: 0 }}
					out:fade={{ duration: 250 }}
				>
					"{currentQuery()}"
				</span>
			</div>
		{/if}
		{#if displayQueries().length > 1 && stage !== 'query_expansion'}
			<div class="flex items-center gap-1 text-xs text-blue-600">
				<span>{currentQueryIndex + 1}</span>
				<span>/</span>
				<span>{displayQueries().length}</span>
			</div>
		{/if}
		{#if stage === 'query_expansion' && displayQueries().length > 0}
			<div class="flex-1 text-sm text-blue-700">
				<span class="font-semibold">{displayQueries().length} queries generated</span>
			</div>
		{/if}
	</div>
{/if}

