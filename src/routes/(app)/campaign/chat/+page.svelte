<script lang="ts">
import type { SerializedCampaign } from '$lib/server/campaigns';

type PageData = {
	campaigns: SerializedCampaign[];
	error?: string | null;
};

let { data }: { data: PageData } = $props();

	const campaigns = data.campaigns ?? [];
	const errorMessage = data.error ?? null;

	const formatUpdatedAt = (value: number | null) => {
		if (!value) return 'Just created';
		return new Date(value).toLocaleString();
	};

	const campaignTitle = (campaign: SerializedCampaign, index: number) => {
		if (campaign.website) return campaign.website;
		if (campaign.influencerTypes) return campaign.influencerTypes;
		return `Campaign ${index + 1}`;
	};

	const campaignSubtitle = (campaign: SerializedCampaign) => {
		if (campaign.locations) return campaign.locations;
		if (campaign.followers) return campaign.followers;
		if (campaign.businessSummary) {
			return campaign.businessSummary.length > 80
				? `${campaign.businessSummary.slice(0, 77)}…`
				: campaign.businessSummary;
		}
		return 'Awaiting more details';
	};

	const campaignHref = (campaign: SerializedCampaign) => {
		const id = campaign.sourceConversationId ?? campaign.id;
		return id ? `/campaign/chat/${id}` : '#';
	};
</script>

<div class="max-w-4xl mx-auto px-6 lg:px-12 py-12 space-y-6">
	<header class="space-y-2">
		<p class="text-xs uppercase tracking-wide text-gray-500">Campaign assistant</p>
		<h1 class="text-3xl font-semibold text-gray-900">Select a campaign to brief</h1>
		<p class="text-sm text-gray-600">These sessions contain the structured conversations you started with Penny's AI assistant.</p>
	</header>

	{#if errorMessage}
		<div class="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700 shadow-sm">
			{errorMessage}
		</div>
	{/if}

	{#if campaigns.length === 0}
		<div class="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-8 text-center text-sm text-gray-500">
			<p class="font-medium text-gray-700">No campaign briefs yet.</p>
			<p class="mt-1">Start a new conversation with the assistant to create your first campaign.</p>
		</div>
	{:else}
		<section class="space-y-3">
			{#each campaigns as campaign, index}
				{@const href = campaignHref(campaign)}
				<a
					href={href}
					class={`block rounded-2xl border border-gray-200 bg-white px-6 py-4 shadow-sm transition hover:border-[#FF6F61] hover:shadow-md ${href === '#' ? 'pointer-events-none opacity-60' : ''}`}
				>
					<div class="flex items-center justify-between gap-4">
						<div>
							<p class="text-base font-semibold text-gray-900">{campaignTitle(campaign, index)}</p>
							<p class="text-xs text-gray-500">{campaignSubtitle(campaign)}</p>
							<p class="mt-1 text-xs text-gray-400">Updated {formatUpdatedAt(campaign.updatedAt)}</p>
						</div>
						<span class="text-sm text-[#FF6F61]">Open brief →</span>
					</div>
				</a>
			{/each}
		</section>
	{/if}
</div>
