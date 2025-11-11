<script lang="ts">
	import { goto } from '$app/navigation';
	import Button from '$lib/components/Button.svelte';
	import type { CreatorProfile } from '$lib/types/search';

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
				stop_at_stage?: 'SEARCH' | 'BRIGHTDATA' | 'LLM_FIT' | null;
			};
		};
	} = $props();

	const campaigns = data.campaigns ?? [];
	const influencers = data.influencers ?? [];
	const brandLabel = data.profile?.full_name ?? 'your brand';

	let platformFilter = $state('all');
	let selectedCampaignId = $state<string | null>(campaigns[0]?.id ?? null);
	let searchQuery = $state(data.searchParams?.query ?? '');
	let businessQuery = $state(data.searchParams?.business_query ?? '');
	let minFollowers = $state<number | null>(data.searchParams?.min_followers ?? null);
	let maxFollowers = $state<number | null>(data.searchParams?.max_followers ?? null);
	let isSearching = $state(false);
	let showAdvancedFilters = $state(false);
	let stopAtStage = $state<'SEARCH' | 'BRIGHTDATA' | 'LLM_FIT' | null>(
		data.searchParams?.stop_at_stage ?? null
	);

	const platforms = $derived(
		Array.from(
			influencers.reduce((set, influencer) => {
				const platform =
					(influencer.platform as string | undefined) ??
					(influencer.platform_type as string | undefined);
				if (platform) set.add(platform);
				return set;
			}, new Set<string>())
		).sort()
	);

	const filteredInfluencers = $derived(
		influencers.filter((influencer) => {
			if (platformFilter === 'all') return true;
			const platform =
				(influencer.platform as string | undefined) ??
				(influencer.platform_type as string | undefined);
			return platform === platformFilter;
		})
	);

	async function handleSearch(event: SubmitEvent) {
		event.preventDefault();
		if (!searchQuery.trim() || !businessQuery.trim()) return;

		isSearching = true;
		const params = new URLSearchParams();
		params.set('query', searchQuery.trim());
		params.set('business_query', businessQuery.trim());
		if (minFollowers != null) params.set('min_followers', minFollowers.toString());
		if (maxFollowers != null) params.set('max_followers', maxFollowers.toString());
		if (stopAtStage) params.set('stop_at_stage', stopAtStage);

		await goto(`/influencers?${params.toString()}`);
		isSearching = false;
	}

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
			Browsing {influencers.length} creators picked for {brandLabel}. Filter by platform or keyword to narrow your list.
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

			<div>
				<label class="block text-sm font-medium text-gray-700 mb-2">Pipeline Depth</label>
				<select
					bind:value={stopAtStage}
					class="w-full rounded-2xl border border-gray-200 px-5 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
				>
					<option value={null}>Full Analysis (30-60s)</option>
				<option value="SEARCH">Quick Search (1-2s)</option>
				<option value="BRIGHTDATA">Search + BrightData (20-30s)</option>
				</select>
				<p class="text-xs text-gray-500 mt-1">
					Choose how deep to analyze. Quick search is faster but less comprehensive.
				</p>
			</div>

			<Button type="submit" variant="primary" disabled={isSearching || !searchQuery.trim() || !businessQuery.trim()}>
				{isSearching ? 'Searching...' : 'Search Creators'}
			</Button>
		</form>
	</section>

	{#if data.error}
		<div class="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 shadow-sm">
			<p class="font-semibold">Search failed</p>
			<p>{data.error}</p>
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

		{#if data.searchParams?.stop_at_stage}
			<div class="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800">
				Stopped at: {data.searchParams.stop_at_stage}
			</div>
		{/if}
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
			{#if data.influencers.length === 0 && !data.error}
				<div class="col-span-full text-center py-12">
					<p class="text-lg font-semibold text-gray-700">No creators found</p>
					<p class="text-sm text-gray-500 mt-2">Try adjusting your search query or filters</p>
				</div>
			{:else}
				<p class="text-sm text-gray-500">No influencers match your filters yet.</p>
			{/if}
		{/if}
	</section>
</div>

{#if isSearching}
	<div class="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
		<div class="bg-white rounded-2xl px-6 py-4 shadow-lg">
			<p class="text-sm text-gray-700">Searching creators...</p>
			<p class="text-xs text-gray-500 mt-1">This may take 30-60 seconds</p>
		</div>
	</div>
{/if}
