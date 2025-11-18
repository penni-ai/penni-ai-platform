<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import { fade } from 'svelte/transition';
	import type { SearchParams } from '$lib/types/campaign';

	interface Props {
		mode: 'embedded' | 'standalone';
		summary: string;
		topN: number;
		minFollowers: number | null;
		maxFollowers: number | null;
		maxInfluencers: number;
		isSubmitting: boolean;
		hasPipeline: boolean;
		debugMode?: boolean;
		searchUsage?: { remaining: number; limit: number } | null;
		error?: string | null;
		onSubmit: (params: SearchParams) => void;
		onRerun?: () => void;
	}

	let {
		mode,
		summary,
		topN,
		minFollowers,
		maxFollowers,
		maxInfluencers,
		isSubmitting,
		hasPipeline,
		debugMode = false,
		searchUsage,
		error,
		onSubmit,
		onRerun
	}: Props = $props();

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (isSubmitting || !summary.trim() || topN < 30 || hasPipeline) return;
		
		onSubmit({
			business_description: summary.trim(),
			top_n: topN,
			min_followers: minFollowers,
			max_followers: maxFollowers,
			campaign_id: null // Will be set by parent
		});
	}

	function handleButtonClick() {
		if (isSubmitting || !summary.trim() || topN < 30 || hasPipeline) return;
		onSubmit({
			business_description: summary.trim(),
			top_n: topN,
			min_followers: minFollowers,
			max_followers: maxFollowers,
			campaign_id: null
		});
	}
</script>

{#if mode === 'embedded'}
	<!-- Embedded Mode (in chat tab) -->
	<div class="mx-auto w-full max-w-4xl" transition:fade={{ duration: 300 }}>
		{#if debugMode}
			<!-- Debug Mode: Full Form -->
			<div class="rounded-2xl border border-[#FF6F61]/20 bg-[#FF6F61] px-6 py-4 shadow-lg">
				<div class="mb-3">
					<h3 class="text-base font-semibold text-white">Start Influencer Search</h3>
				</div>
				<form onsubmit={handleSubmit} class="space-y-3">
					<!-- Summary Text Area (Editable) -->
					<div>
						<label for="influencer-summary" class="block text-xs font-medium text-white/90 mb-1.5">
							Influencer Summary
						</label>
						<textarea
							id="influencer-summary"
							bind:value={summary}
							rows="2"
							class="w-full rounded-lg border border-white/30 bg-white px-3 py-2 text-sm shadow-sm focus:border-white focus:outline-none focus:ring-2 focus:ring-white/20 resize-none"
							placeholder="Describe what kind of influencers you're looking for..."
							required
							disabled={isSubmitting}
						></textarea>
					</div>
					
					<!-- Min/Max Followers and Number of Influencers (same row) -->
					<div class="grid grid-cols-3 gap-3">
						<div>
							<label for="search-form-min-followers" class="block text-xs font-medium text-white/90 mb-1.5">
								Min Followers
							</label>
							<input
								type="number"
								id="search-form-min-followers"
								bind:value={minFollowers}
								min="0"
								step="1000"
								class="w-full rounded-lg border border-white/30 bg-white px-3 py-2 text-sm shadow-sm focus:border-white focus:outline-none focus:ring-2 focus:ring-white/20"
								placeholder="e.g., 10000"
								disabled={isSubmitting}
							/>
						</div>
						<div>
							<label for="search-form-max-followers" class="block text-xs font-medium text-white/90 mb-1.5">
								Max Followers
							</label>
							<input
								type="number"
								id="search-form-max-followers"
								bind:value={maxFollowers}
								min="0"
								step="1000"
								class="w-full rounded-lg border border-white/30 bg-white px-3 py-2 text-sm shadow-sm focus:border-white focus:outline-none focus:ring-2 focus:ring-white/20"
								placeholder="e.g., 1000000"
								disabled={isSubmitting}
							/>
						</div>
						<div>
							<label for="search-form-top-n" class="block text-xs font-medium text-white/90 mb-1.5">
								Number of Influencers
							</label>
							<input
								type="number"
								id="search-form-top-n"
								bind:value={topN}
								min="30"
								max={maxInfluencers}
								class="w-full rounded-lg border border-white/30 bg-white px-3 py-2 text-sm shadow-sm focus:border-white focus:outline-none focus:ring-2 focus:ring-white/20"
								required
								disabled={isSubmitting}
							/>
						</div>
					</div>
					
					<!-- Submit Button -->
					<div class="flex justify-end pt-1">
						<Button
							type="submit"
							variant="secondary"
							size="sm"
							disabled={isSubmitting || !summary.trim() || topN < 30 || hasPipeline}
							class="bg-white text-gray-900 hover:bg-gray-50"
						>
							{#if isSubmitting}
								Searching...
							{:else if hasPipeline}
								Search Already Started
							{:else}
								Start Influencer Search
							{/if}
						</Button>
					</div>
				</form>
			</div>
		{:else}
			<!-- Normal Mode: Compact Panel -->
			<div class="rounded-2xl border border-[#FF6F61]/20 bg-[#FF6F61] px-6 py-4 shadow-lg">
				<div class="flex items-center justify-between mb-3">
					<div>
						<p class="text-sm font-medium text-white">We've collected all the information we need to search!</p>
						<p class="text-xs text-white/80 mt-1">Configure and initiate the search below.</p>
					</div>
				</div>
				<div class="flex items-center gap-3">
					<div class="flex-1">
						<label for="compact-search-top-n" class="block text-xs font-medium text-white/90 mb-1.5">
							Number of Influencers
						</label>
						<input
							type="number"
							id="compact-search-top-n"
							bind:value={topN}
							min="30"
							max={maxInfluencers}
							class="w-full rounded-lg border border-white/30 bg-white px-3 py-2 text-sm shadow-sm focus:border-white focus:outline-none focus:ring-2 focus:ring-white/20"
							required
							disabled={isSubmitting}
							onclick={(e) => e.stopPropagation()}
							onkeydown={(e) => e.stopPropagation()}
						/>
					</div>
					<div class="flex items-end pb-0.5 gap-2">
						{#if hasPipeline && onRerun}
							<button
								type="button"
								onclick={onRerun}
								disabled={isSubmitting}
								class="rounded-lg border border-white/30 bg-transparent px-4 py-2 text-sm font-medium text-white hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
								title="Rerun the pipeline with current settings"
							>
								{#if isSubmitting}
									<div class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
									<span>Rerunning...</span>
								{:else}
									<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
									</svg>
									<span>Rerun</span>
								{/if}
							</button>
						{/if}
						<button
							type="button"
							onclick={handleButtonClick}
							disabled={isSubmitting || !summary.trim() || topN < 30 || hasPipeline}
							class="rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
							title={hasPipeline ? 'Search has already been started for this campaign' : ''}
						>
							{#if isSubmitting}
								<div class="h-4 w-4 animate-spin rounded-full border-2 border-gray-900 border-t-transparent"></div>
								<span>Searching...</span>
							{:else if hasPipeline}
								<span>Search Already Started</span>
							{:else}
								<span>Start Search</span>
								<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
								</svg>
							{/if}
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
{:else}
	<!-- Standalone Mode (in outreach tab) -->
	<div class="mx-auto w-full max-w-3xl space-y-6">
		<div>
			<h2 class="text-2xl font-semibold text-gray-900">Find Influencers</h2>
			<p class="mt-1 text-sm text-gray-500">
				Search for influencers matching your campaign criteria.
				{#if searchUsage}
					You have <span class="font-medium text-gray-900">{searchUsage.remaining}</span> searches remaining this month (out of {searchUsage.limit}).
				{/if}
			</p>
		</div>
		
		<form onsubmit={handleSubmit} class="space-y-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
			<!-- Search Query -->
			<div>
				<label for="search-query" class="block text-sm font-medium text-gray-700 mb-2">
					Business & Influencer Description
				</label>
				<textarea
					id="search-query"
					bind:value={summary}
					rows="4"
					class="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm shadow-sm focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10"
					placeholder="Describe your business and what types of influencers you're looking for..."
					required
					disabled={isSubmitting}
				></textarea>
				<p class="mt-1 text-xs text-gray-500">This will be used to search for matching influencers.</p>
			</div>
			
			<!-- Number of Influencers -->
			<div>
				<label for="search-top-n" class="block text-sm font-medium text-gray-700 mb-2">
					Number of Influencers
				</label>
				<input
					type="number"
					id="search-top-n"
					bind:value={topN}
					min="30"
					max={maxInfluencers}
					class="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm shadow-sm focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10"
					required
					disabled={isSubmitting}
				/>
				<p class="mt-1 text-xs text-gray-500">
					Minimum: 30, Maximum: {maxInfluencers} (based on your remaining searches)
				</p>
			</div>
			
			<!-- Follower Range -->
			<div class="grid grid-cols-2 gap-4">
				<div>
					<label for="search-min-followers" class="block text-sm font-medium text-gray-700 mb-2">
						Min Followers
					</label>
					<input
						type="number"
						id="search-min-followers"
						bind:value={minFollowers}
						min="0"
						step="1000"
						class="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm shadow-sm focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10"
						placeholder="e.g., 10000"
						disabled={isSubmitting}
					/>
				</div>
				<div>
					<label for="search-max-followers" class="block text-sm font-medium text-gray-700 mb-2">
						Max Followers
					</label>
					<input
						type="number"
						id="search-max-followers"
						bind:value={maxFollowers}
						min="0"
						step="1000"
						class="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm shadow-sm focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10"
						placeholder="e.g., 1000000"
						disabled={isSubmitting}
					/>
				</div>
			</div>
			
			<!-- Error Message -->
			{#if error}
				<div class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
					{error}
				</div>
			{/if}
			
			<!-- Submit Button -->
			<div class="flex justify-end">
				<Button
					type="submit"
					variant="primary"
					size="md"
					disabled={isSubmitting || !summary.trim() || topN < 30 || topN > maxInfluencers}
				>
					{#if isSubmitting}
						Searching...
					{:else}
						Start Search
					{/if}
				</Button>
			</div>
		</form>
	</div>
{/if}

