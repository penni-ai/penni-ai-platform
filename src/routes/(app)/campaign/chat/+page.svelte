<script lang="ts">
	let { data } = $props();
</script>

<div class="max-w-4xl mx-auto px-6 lg:px-12 py-12 space-y-6">
	<header class="space-y-2">
		<p class="text-xs uppercase tracking-wide text-gray-500">Campaign assistant</p>
		<h1 class="text-3xl font-semibold text-gray-900">Select a campaign to brief</h1>
		<p class="text-sm text-gray-600">These sessions contain the structured conversations you started with Penny's AI assistant.</p>
	</header>

	<section class="space-y-3">
		{#each data.sessions as session}
			<a
				href={`/campaign/chat/${session.id}`}
				class="block rounded-2xl border border-gray-200 bg-white px-6 py-4 shadow-sm transition hover:border-[#FF6F61] hover:shadow-md"
			>
				<div class="flex items-center justify-between">
					<div>
						<p class="text-base font-semibold text-gray-900">{session.name}</p>
						<p class="text-xs text-gray-500">Updated {new Date(session.updated_at).toLocaleString()}</p>
					</div>
					<span class="text-sm text-[#FF6F61]">Open brief →</span>
				</div>
			</a>
		{/each}
	</section>
</div>
