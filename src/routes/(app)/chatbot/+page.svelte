<script lang="ts">
	import Button from '$lib/components/Button.svelte';

	let { data } = $props();
	let message = $state('We are launching a campus influencer crawl next month.');
	let campaignName = $state('Campus Pop-Up Tour');
	let objective = $state('Drive 200 RSVPs from Gen Z foodies');
	let landingPage = $state('https://yourbrand.com/pop-up');
	const conversation = $derived(() => data.conversation ?? []);
	const createdCampaignId = $derived(() => 'cmp-demo');
</script>

<div class="max-w-4xl mx-auto px-6 lg:px-12 py-12 space-y-8">
	<header class="space-y-2">
		<p class="text-xs uppercase tracking-wide text-gray-500">Campaign assistant</p>
		<h1 class="text-3xl font-semibold text-gray-900">Draft a campaign brief</h1>
		<p class="text-sm text-gray-600">Send one message describing the campaign you want to run. We’ll scaffold the campaign, seed a few influencers, and link you straight to outreach.</p>
	</header>

	<section class="grid gap-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm md:grid-cols-[1fr,1.2fr]">
		<form
			class="space-y-4"
			onsubmit={(event) => {
				event.preventDefault();
				alert('This is a demo form.');
			}}
		>
			<div class="space-y-2">
				<label class="text-xs font-semibold uppercase tracking-wide text-gray-500" for="campaign-name">Campaign name</label>
				<input
					id="campaign-name"
					type="text"
					class="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
					required
					bind:value={campaignName}
				/>
			</div>
			<div class="space-y-2">
				<label class="text-xs font-semibold uppercase tracking-wide text-gray-500" for="objective">Objective</label>
				<input
					id="objective"
					type="text"
					class="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
					bind:value={objective}
				/>
			</div>
			<div class="space-y-2">
				<label class="text-xs font-semibold uppercase tracking-wide text-gray-500" for="landing-page">Landing page</label>
				<input
					id="landing-page"
					type="url"
					class="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
					bind:value={landingPage}
				/>
			</div>
			<div class="space-y-2">
				<label class="text-xs font-semibold uppercase tracking-wide text-gray-500" for="message">First message</label>
				<textarea
					id="message"
					rows="4"
					placeholder="We want 20 Gen Z food creators in Austin to promote our brunch pop-up..."
					class="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF6F61]"
					required
					bind:value={message}
				></textarea>
			</div>
			<Button type="submit" class="w-full justify-center">Generate campaign</Button>
		</form>

		<div class="space-y-4">
			<h2 class="text-sm font-semibold uppercase tracking-wide text-gray-500">Conversation</h2>
			<div class="max-h-80 overflow-y-auto space-y-3 pr-1">
				{#if conversation().length}
					{#each conversation() as turn}
						<div class={`rounded-2xl px-4 py-3 text-sm shadow-sm ${turn.role === 'assistant' ? 'bg-[#FFF1ED] text-gray-800' : 'bg-gray-900 text-white'}`}>
							<p class="text-xs uppercase tracking-wide {turn.role === 'assistant' ? 'text-gray-500' : 'text-gray-300'}">
								{turn.role === 'assistant' ? 'Assistant' : 'You'} · {new Date(turn.created_at ?? Date.now()).toLocaleString()}
							</p>
							<p class="mt-1 whitespace-pre-line">{turn.content}</p>
						</div>
					{/each}
				{:else}
					<p class="text-sm text-gray-500">No conversation yet. Send your first message to get started.</p>
				{/if}
			</div>

			<div class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
				<p class="font-semibold">Campaign ready!</p>
				<p class="mt-1">Head to outreach to review the seeded creators and continue drafting emails.</p>
				<div class="mt-3 flex flex-wrap gap-3">
					<Button href={`/campaign/${createdCampaignId()}`} class="justify-center">Open campaign</Button>
					<Button variant="outline" href={`/campaign/${createdCampaignId()}/chat`} class="justify-center">Continue chat</Button>
				</div>
			</div>
		</div>
	</section>
</div>
