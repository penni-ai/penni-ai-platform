<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { ApiMessage, CollectedData, FollowerRange, SearchParams } from '$lib/types/campaign';
	import type { SerializedCampaign } from '$lib/server/campaigns';
	import MessageList from './MessageList.svelte';
	import ChatInput from './ChatInput.svelte';
	import ProgressBar from './ProgressBar.svelte';
	import InfluencerSearchForm from './InfluencerSearchForm.svelte';
	import { calculateProgress } from '$lib/utils/campaign';

	interface Props {
		campaignId: string | null;
		messages: ApiMessage[];
		isInitializing: boolean;
		initError: string | null;
		draft: string;
		isSending: boolean;
		collected: CollectedData;
		followerRange: FollowerRange;
		influencerSummary: string;
		searchFormTopN: number;
		searchFormMinFollowers: number | null;
		searchFormMaxFollowers: number | null;
		isSearchFormSubmitting: boolean;
		effectiveCampaign: SerializedCampaign | null;
		maxInfluencers: number;
		debugMode: boolean;
		messagesContainer: HTMLDivElement | null;
		onRetry: () => void;
		onSubmit: (message: string) => void;
		onSearchSubmit: (params: SearchParams) => void;
		onToggleDebug: () => void;
		onScrollToBottom: () => void;
		onDraftChange?: (value: string) => void;
		onRerunPipeline?: () => void;
	}

	let {
		campaignId,
		messages,
		isInitializing,
		initError,
		draft,
		isSending,
		collected,
		followerRange,
		influencerSummary,
		searchFormTopN,
		searchFormMinFollowers,
		searchFormMaxFollowers,
		isSearchFormSubmitting,
		effectiveCampaign,
		maxInfluencers,
		debugMode,
		messagesContainer,
		onRetry,
		onSubmit,
		onSearchSubmit,
		onToggleDebug,
		onScrollToBottom,
		onDraftChange,
		onRerunPipeline
	}: Props = $props();

	// Two-way bindings need to be handled via callbacks
	// The parent component should handle the state updates

	const progress = $derived(() => calculateProgress(collected, followerRange));
	const isProgressComplete = $derived(() => progress() === 100);

	function handleSearchSubmit(params: SearchParams) {
		onSearchSubmit({
			...params,
			campaign_id: effectiveCampaign?.id ?? null
		});
	}

	// Auto-scroll when messages change
	$effect(() => {
		if (messages.length > 0) {
			setTimeout(() => onScrollToBottom(), 0);
		}
	});
</script>

<div class="w-1/2 shrink-0 h-full overflow-hidden">
	<div class="flex h-full flex-col">
		<div class="flex-1 overflow-y-auto px-8 py-10" bind:this={messagesContainer}>
			<div class="mx-auto flex w-full max-w-3xl flex-col gap-6">
				{#if isInitializing}
					<div class="flex justify-center py-12 text-gray-500">Loading conversation…</div>
				{:else if initError}
					<div class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
						<p class="font-semibold">We couldn't load the conversation.</p>
						<p class="text-sm">{initError}</p>
						<button
							class="mt-4 text-sm font-medium text-red-700 underline"
							onclick={onRetry}
						>
							Try again
						</button>
					</div>
				{:else}
					<MessageList {messages} {isSending} />
					
					<!-- Elevated Influencer Search Panel (when progress is 100%) -->
					{#if isProgressComplete() && influencerSummary && !isInitializing && campaignId}
						<div class="mx-auto w-full max-w-4xl" transition:fade={{ duration: 300 }}>
							<InfluencerSearchForm
								mode="embedded"
								summary={influencerSummary}
								topN={searchFormTopN}
								minFollowers={searchFormMinFollowers}
								maxFollowers={searchFormMaxFollowers}
								maxInfluencers={maxInfluencers}
								isSubmitting={isSearchFormSubmitting}
								hasPipeline={!!effectiveCampaign?.pipeline_id}
								{debugMode}
								onSubmit={handleSearchSubmit}
								onRerun={onRerunPipeline}
							/>
						</div>
					{/if}
				{/if}
			</div>
		</div>

		<!-- Progress Bar (always stays at bottom) -->
		{#if !isInitializing && campaignId}
			<ProgressBar progress={progress()} showDebug={debugMode} toggleDebug={onToggleDebug} />
		{/if}

		<!-- Chat Input Box (hidden when progress is 100%) -->
		<ChatInput
			draft={draft}
			disabled={isInitializing || !campaignId}
			show={!isProgressComplete()}
			onSubmit={onSubmit}
			onDraftChange={onDraftChange}
		/>
	</div>
</div>

