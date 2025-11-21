<script lang="ts">
	import { fade } from 'svelte/transition';
	import type { ApiMessage, CollectedData, FollowerRange, SearchParams } from '$lib/types/campaign';
	import type { SerializedCampaign } from '$lib/server/campaigns';
	import MessageList from './MessageList.svelte';
	import ChatInput from './ChatInput.svelte';
	import InfluencerSearchForm from './InfluencerSearchForm.svelte';

	interface Props {
		campaignId: string | null;
		messages: ApiMessage[];
		isInitializing: boolean;
		initError: string | null;
		chatError: string | null;
		conversationStatus: 'collecting' | 'ready' | 'searching' | 'complete' | 'needs_config' | 'error';
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
		onMessagesContainerReady?: (el: HTMLDivElement) => void;
		onRetry: () => void;
		onSubmit: (message: string) => void;
		onSearchSubmit: (params: SearchParams) => void;
		onScrollToBottom: () => void;
		onDraftChange?: (value: string) => void;
		onRerunPipeline?: () => void;
	}

	let {
		campaignId,
		messages,
		isInitializing,
		initError,
		chatError,
		conversationStatus,
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
		onMessagesContainerReady,
		onRetry,
		onSubmit,
		onSearchSubmit,
		onScrollToBottom,
		onDraftChange,
		onRerunPipeline
	}: Props = $props();

	// Local messages container reference
	let messagesContainer: HTMLDivElement | null = null;

	// Two-way bindings need to be handled via callbacks
	// The parent component should handle the state updates

	function handleSearchSubmit(params: SearchParams) {
		onSearchSubmit({
			...params,
			campaign_id: effectiveCampaign?.id ?? null
		});
	}

	// Expose messagesContainer to parent when it becomes available
	$effect(() => {
		if (messagesContainer && onMessagesContainerReady) {
			onMessagesContainerReady(messagesContainer);
		}
	});

	// Single effect for auto-scroll: when messages change and initialization is complete
	$effect(() => {
		if (messages.length > 0 && !isInitializing) {
			// Use a short timeout to ensure DOM is updated
			setTimeout(() => onScrollToBottom(), 50);
		}
	});
</script>

<div class="w-1/2 shrink-0 h-full overflow-hidden">
	<div class="flex h-full flex-col">
		<div 
			class="flex-1 overflow-y-auto px-8 py-10" 
			bind:this={messagesContainer}
			style="scroll-behavior: smooth;"
		>
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
					{#if chatError}
						<div class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
							<p class="font-semibold">Failed to send message</p>
							<p class="text-sm">{chatError}</p>
						</div>
					{/if}
					<MessageList {messages} {isSending} />
					
					<!-- Elevated Influencer Search Panel (when chatbot is done - status is ready or complete) -->
					{#if (conversationStatus === 'ready' || conversationStatus === 'complete') && !isInitializing && campaignId}
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
								onSubmit={handleSearchSubmit}
								onRerun={onRerunPipeline}
							/>
						</div>
					{/if}
				{/if}
			</div>
		</div>

		<!-- Chat Input Box (hidden when conversation is ready or complete) -->
		<ChatInput
			draft={draft}
			disabled={isInitializing || !campaignId}
			show={conversationStatus !== 'ready' && conversationStatus !== 'complete'}
			onSubmit={onSubmit}
			onDraftChange={onDraftChange}
		/>
	</div>
</div>

