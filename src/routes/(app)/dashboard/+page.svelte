<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const campaigns = data.campaigns ?? [];

	function formatDate(timestamp: number | null): string {
		if (!timestamp) return '—';
		return new Date(timestamp).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function getCampaignName(campaign: typeof campaigns[0]): string {
		if (campaign.title) return campaign.title;
		if (campaign.website) return campaign.website;
		if (campaign.influencerTypes) return campaign.influencerTypes;
		if (campaign.locations) return campaign.locations;
		return 'Untitled campaign';
	}
</script>

<svelte:head>
	<title>Dashboard – Penni AI</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-8 py-10">
	<div class="mb-8">
		<h1 class="text-3xl font-bold text-gray-900">Dashboard</h1>
		<p class="mt-2 text-gray-600">Manage your influencer campaigns</p>
	</div>

	{#if campaigns.length === 0}
		<div class="rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 px-8 py-16 text-center">
			<h2 class="text-xl font-semibold text-gray-900">No campaigns yet</h2>
			<p class="mt-2 text-gray-600">Create your first campaign to get started</p>
			<div class="mt-6">
				<Button
					onclick={async () => {
						try {
							const response = await fetch('/api/campaigns', { method: 'POST' });
							if (!response.ok) throw new Error('Failed to create campaign');
							const data = await response.json();
							if (data.campaignId) {
								window.location.href = `/campaign/${data.campaignId}`;
							}
						} catch (error) {
							console.error('Failed to create campaign', error);
							alert('Failed to create campaign. Please try again.');
						}
					}}
					class="bg-[#FF6F61] text-white hover:bg-[#ff846f]"
				>
					Create Campaign
				</Button>
			</div>
		</div>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each campaigns as campaign}
				<a
					href={`/campaign/${campaign.id}`}
					class="group rounded-xl border border-gray-200 bg-white p-6 transition hover:border-[#FF6F61] hover:shadow-md"
				>
					<h3 class="text-lg font-semibold text-gray-900 group-hover:text-[#FF6F61]">
						{getCampaignName(campaign)}
					</h3>
					<div class="mt-3 flex items-center gap-4 text-sm text-gray-500">
						<span>Updated {formatDate(campaign.updatedAt ?? campaign.createdAt)}</span>
					</div>
					
					<!-- Statistics -->
					<div class="mt-4 grid grid-cols-2 gap-3">
						<div class="rounded-lg bg-gray-50 p-3">
							<div class="text-xs font-medium text-gray-500 uppercase tracking-wide">Outreach Sent</div>
							<div class="mt-1 text-2xl font-semibold text-gray-900">{campaign.stats?.outreachSent ?? 0}</div>
						</div>
						<div class="rounded-lg bg-gray-50 p-3">
							<div class="text-xs font-medium text-gray-500 uppercase tracking-wide">Influencers Found</div>
							<div class="mt-1 text-2xl font-semibold text-gray-900">{campaign.stats?.influencersFound ?? 0}</div>
						</div>
					</div>
					
					{#if campaign.status}
						<div class="mt-3">
							<span
								class="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium {campaign.status === 'ready' ||
								campaign.status === 'complete'
									? 'bg-green-100 text-green-800'
									: campaign.status === 'searching'
										? 'bg-blue-100 text-blue-800'
										: campaign.status === 'error'
											? 'bg-red-100 text-red-800'
											: 'bg-gray-100 text-gray-800'}"
							>
								{campaign.status}
							</span>
						</div>
					{/if}
				</a>
			{/each}
		</div>
	{/if}
</div>

