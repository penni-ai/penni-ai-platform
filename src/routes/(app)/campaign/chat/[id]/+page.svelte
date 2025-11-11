<script lang="ts">
	export let data: {
		campaign: {
			id: string;
			createdAt: number | null;
			website?: string | null;
			influencerTypes?: string | null;
			locations?: string | null;
			followers?: string | null;
			followersMin?: number | null;
			followersMax?: number | null;
			keywords?: string[];
			businessSummary?: string | null;
		} | null;
		error?: string;
	};

	const campaign = data.campaign;
	const createdAt = campaign && typeof campaign.createdAt === 'number' ? new Date(campaign.createdAt).toLocaleString() : '';
	const numberFormatter = new Intl.NumberFormat('en-US');
	const formatFollowerBounds = () => {
		if (!campaign) return '—';
		const min = typeof campaign.followersMin === 'number' ? Math.round(campaign.followersMin) : null;
		const max = typeof campaign.followersMax === 'number' ? Math.round(campaign.followersMax) : null;
		if (min !== null && max !== null) return `${numberFormatter.format(min)} – ${numberFormatter.format(max)}`;
		if (min !== null) return `${numberFormatter.format(min)}+`;
		if (max !== null) return `Up to ${numberFormatter.format(max)}`;
		return '—';
	};
</script>

<svelte:head>
	<title>Campaign Preview – {campaign?.website ?? 'Custom Campaign'}</title>
</svelte:head>

<div class="flex h-full flex-col gap-6 px-8 py-10">
	{#if !campaign}
		<div class="mx-auto max-w-2xl rounded-3xl border border-red-200 bg-red-50 px-6 py-8 text-center text-red-700 shadow-sm">
			<h1 class="text-2xl font-semibold">Campaign unavailable</h1>
			<p class="mt-3 text-sm">{data.error ?? 'We couldn’t load this campaign preview. Please go back to the dashboard and try again.'}</p>
			<a href="/dashboard" class="mt-6 inline-flex items-center gap-2 text-sm font-medium text-red-700 underline">
				<span aria-hidden="true">←</span>
				Back to dashboard
			</a>
		</div>
	{:else}
	<div class="max-w-4xl space-y-2">
		<a href="/dashboard" class="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
			<span aria-hidden="true">←</span>
			Back to dashboard
		</a>
		<h1 class="text-3xl font-semibold text-gray-900">Campaign preview</h1>
		<p class="text-sm text-gray-500">Created {createdAt}</p>
	</div>
	<div class="max-w-4xl space-y-6">
		<section class="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
			<h2 class="text-xl font-semibold text-gray-900">Business summary</h2>
			<p class="mt-2 text-sm leading-relaxed text-gray-700">{campaign.businessSummary ?? 'No summary available yet.'}</p>
		</section>

		<section class="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
			<h2 class="text-xl font-semibold text-gray-900">Influencer brief</h2>
			<dl class="mt-4 grid grid-cols-1 gap-4 text-sm text-gray-700 sm:grid-cols-2">
				<div>
					<dt class="font-medium text-gray-500">Website</dt>
					<dd class="mt-1 break-words">{campaign.website ?? '—'}</dd>
				</div>
				<div>
					<dt class="font-medium text-gray-500">Influencer types</dt>
					<dd class="mt-1">{campaign.influencerTypes ?? '—'}</dd>
				</div>
				<div>
					<dt class="font-medium text-gray-500">Location / Remote</dt>
					<dd class="mt-1">{campaign.locations ?? '—'}</dd>
				</div>
				<div>
					<dt class="font-medium text-gray-500">Follower range</dt>
					<dd class="mt-1">{campaign.followers ?? '—'}</dd>
				</div>
				<div>
					<dt class="font-medium text-gray-500">Follower bounds</dt>
					<dd class="mt-1">{formatFollowerBounds()}</dd>
				</div>
			</dl>
			{#if campaign.keywords && campaign.keywords.length}
				<div class="mt-4">
					<h3 class="text-sm font-semibold uppercase tracking-wide text-gray-500">Influencer keywords</h3>
					<div class="mt-2 flex flex-wrap gap-2">
						{#each campaign.keywords as keyword}
							<span class="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-700">{keyword}</span>
						{/each}
					</div>
				</div>
			{/if}
		</section>

		<section class="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-gray-800 shadow-sm">
			<h2 class="text-lg font-semibold text-emerald-900">Next steps</h2>
			<p class="mt-2 text-sm leading-relaxed">
				We’re gathering influencer matches tailored to this brief. Keep this campaign open; new creators will appear here as they’re found.
			</p>
		</section>
	</div>
	{/if}
</div>
