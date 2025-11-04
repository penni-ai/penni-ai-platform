<script lang="ts">
	import Button from '$lib/components/Button.svelte';

	let newCampaignName = $state('Summer Food Crawl');
	let newCampaignObjective = $state('Secure 20 creator RSVPs and 5 collaborations');
	let newCampaignUrl = $state('https://yourbrand.com/summer-pop-up');
	let showAdvancedFields = $state(false);
</script>

<div class="w-full max-w-4xl mx-auto px-6 lg:px-12 py-16 space-y-8">
	<section id="new-campaign" class="bg-white border border-gray-200 rounded-3xl shadow-sm">
		<header class="border-b border-gray-100 px-6 py-5 space-y-1">
			<h1 class="text-lg font-semibold text-gray-900">Create a new campaign</h1>
			<p class="text-sm text-gray-500">Keep it simple—add optional details only when you need them.</p>
		</header>

		<form
			class="space-y-4 p-6"
			onsubmit={(event) => {
				event.preventDefault();
				alert('This is a demo UI.');
			}}
		>
			<div class="flex flex-col gap-3 md:flex-row md:items-center">
				<label class="sr-only" for="campaign-name">Campaign name</label>
				<input
					id="campaign-name"
					name="name"
					type="text"
					placeholder="Name your next creator campaign"
					class="flex-1 rounded-xl border border-gray-200 px-5 py-4 text-lg text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
					required
					bind:value={newCampaignName}
				/>
				<button
					type="submit"
					class="inline-flex items-center justify-center gap-2 rounded-xl bg-[#FF6F61] px-5 py-4 font-medium text-gray-900 transition hover:bg-[#ff846f] hover:shadow-md"
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
					</svg>
					<span>Create campaign</span>
				</button>
			</div>

			<div>
				<button
					type="button"
					class="text-sm font-medium text-[#FF6F61] hover:text-[#ff846f]"
					onclick={() => (showAdvancedFields = !showAdvancedFields)}
				>
					{showAdvancedFields ? 'Hide optional details' : 'Add optional details'}
				</button>
			</div>

			{#if showAdvancedFields}
				<div class="grid gap-4 md:grid-cols-2">
					<div>
						<label for="landing-page" class="block text-xs font-medium uppercase tracking-wide text-gray-500">Landing page (optional)</label>
						<input
							id="landing-page"
							name="landing_page_url"
							type="url"
							placeholder="https://yourstore.com"
							class="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
							bind:value={newCampaignUrl}
						/>
					</div>
					<div>
						<label for="objective" class="block text-xs font-medium uppercase tracking-wide text-gray-500">Objective (optional)</label>
						<input
							id="objective"
							name="objective"
							type="text"
							placeholder="Drive 50 creator signups"
							class="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
							bind:value={newCampaignObjective}
						/>
					</div>
				</div>
			{/if}
		</form>
	</section>

	<section class="bg-white border border-gray-200 rounded-3xl shadow-sm p-6">
		<h2 class="text-lg font-semibold text-gray-900">Recent campaigns</h2>
		<p class="text-sm text-gray-500">These examples show how Penny organises your outreach workspaces.</p>
		<div class="mt-6 space-y-4">
			<div class="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
				<p class="text-xs uppercase tracking-wide text-gray-500">Student AI Campaign</p>
				<p class="text-sm text-gray-600">Focus on campus creators; goal: 15 collaborations.</p>
			</div>
			<div class="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
				<p class="text-xs uppercase tracking-wide text-gray-500">Downtown Brunch Tour</p>
				<p class="text-sm text-gray-600">City-wide influencer crawl with 6 venues.</p>
			</div>
		</div>
		<div class="mt-6 flex flex-wrap gap-3">
			<Button href="/dashboard">Back to dashboard</Button>
			<Button variant="outline" href="/campaign/cmp-001">View campaign detail</Button>
		</div>
	</section>
</div>
