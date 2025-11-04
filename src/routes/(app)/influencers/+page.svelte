<script lang="ts">
	import Button from '$lib/components/Button.svelte';

	let { data } = $props();

	const campaigns = data.campaigns ?? [];
	const influencers = data.influencers ?? [];
	const brandLabel = data.profile?.full_name ?? 'your brand';

	let searchQuery = $state('');
	let platformFilter = $state('all');
	let selectedCampaignId = $state<string | null>(campaigns[0]?.id ?? null);

	const platforms = $derived(
		Array.from(
			influencers.reduce((set, influencer) => {
				if (influencer.platform) set.add(influencer.platform);
				return set;
			}, new Set<string>())
		).sort()
	);

	const filteredInfluencers = $derived(
		influencers.filter((influencer) => {
			const haystack = [
				influencer.display_name ?? '',
				influencer.handle ?? '',
				influencer.location ?? ''
			]
				.join(' ')
				.toLowerCase();
			const matchesSearch = searchQuery.trim()
				? haystack.includes(searchQuery.trim().toLowerCase())
				: true;
			const matchesPlatform = platformFilter === 'all' || influencer.platform === platformFilter;
			return matchesSearch && matchesPlatform;
		})
	);
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
		<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			<div class="relative lg:col-span-2">
				<input
					type="search"
					bind:value={searchQuery}
					placeholder="Search name, handle, or location"
					class="w-full rounded-2xl border border-gray-200 px-5 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
				/>
			</div>
			<div class="lg:col-span-1">
				<select
					bind:value={platformFilter}
					class="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
				>
					<option value="all">All platforms</option>
					{#each platforms as platform}
						<option value={platform}>{platform}</option>
					{/each}
				</select>
			</div>
			<div class="lg:col-span-1">
				<select
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
							<h2 class="text-lg font-semibold text-gray-900">{influencer.display_name ?? 'Unknown'}</h2>
							<p class="text-sm text-gray-500">{influencer.handle ?? '—'}</p>
						</div>
						<span class="rounded-full bg-gray-100 px-3 py-1 text-xs capitalize text-gray-600">{influencer.platform ?? 'platform tbd'}</span>
					</div>
					<div class="grid grid-cols-2 gap-3 text-sm text-gray-600">
						<div>
							<p class="text-xs uppercase tracking-wide text-gray-500">Followers</p>
							<p class="mt-1 font-semibold text-gray-900">{influencer.follower_count?.toLocaleString() ?? '—'}</p>
						</div>
						<div>
							<p class="text-xs uppercase tracking-wide text-gray-500">Engagement</p>
							<p class="mt-1 font-semibold text-gray-900">{influencer.engagement_rate ?? '—'}%</p>
						</div>
						<div>
							<p class="text-xs uppercase tracking-wide text-gray-500">Location</p>
							<p class="mt-1">{influencer.location ?? '—'}</p>
						</div>
						<div>
							<p class="text-xs uppercase tracking-wide text-gray-500">Verticals</p>
							<p class="mt-1">{(influencer.verticals ?? []).slice(0, 3).join(', ') || 'General'}</p>
						</div>
					</div>
					<Button
						class="w-full justify-center"
						onclick={() => alert('Add to campaign: demo interaction only')}
					>
						{selectedCampaignId ? `Add to ${campaigns.find((c) => c.id === selectedCampaignId)?.name ?? 'campaign'}` : 'Select a campaign first'}
					</Button>
				</article>
			{/each}
		{:else}
			<p class="text-sm text-gray-500">No influencers match your filters yet.</p>
		{/if}
	</section>
</div>
