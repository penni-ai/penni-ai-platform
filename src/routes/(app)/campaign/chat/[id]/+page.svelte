<script lang="ts">
	import { goto } from '$app/navigation';
	import Button from '$lib/components/Button.svelte';

	type ConversationMessage = {
		role: 'assistant' | 'user';
		content: string;
		created_at: string;
		kind?: 'bubble' | 'typing' | 'card';
	};

	let { data } = $props();
	let messageDraft = $state('Here is a quick update on the brief...');
	let conversation = $state<ConversationMessage[]>(
		(data.messages as ConversationMessage[] | undefined) ?? []
	);

	function handleDashboardClick() {
		goto('/campaign');
	}
</script>

<div class="flex flex-col h-full overflow-hidden bg-gray-50">
	<div class="px-8 py-6 bg-white border-b border-gray-200">
		<div class="mx-auto flex w-full max-w-5xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
			<div>
				<h1 class="text-2xl font-bold text-gray-900">{data.campaign.name} · Campaign Brief</h1>
				<p class="mt-1 text-sm text-gray-500">Use this space to shape the outreach brief and let the assistant stitch together next steps.</p>
			</div>
			<div class="flex flex-col gap-3 sm:flex-row">
				<Button variant="outline" href={`/campaign/${data.campaign.id}`} class="justify-center">View campaign</Button>
				<Button class="justify-center" onclick={handleDashboardClick}>Back to campaigns</Button>
			</div>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto px-8 py-6">
		<div class="max-w-4xl mx-auto space-y-6">
			{#if conversation.length}
				{#each conversation as message}
					{#if message.role === 'assistant'}
						<div class="flex items-start gap-4">
							<div class="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-blue-500 flex items-center justify-center flex-shrink-0 text-white">
								🤖
							</div>
							<div class="flex-1">
								<div class="bg-gray-100 rounded-2xl rounded-tl-sm px-5 py-4 inline-block max-w-2xl">
									<p class="text-sm text-gray-800 whitespace-pre-line">{message.content}</p>
									<p class="mt-2 text-xs uppercase tracking-wide text-gray-500">Assistant · {new Date(message.created_at).toLocaleString()}</p>
								</div>
							</div>
						</div>
					{:else}
						<div class="flex items-start gap-4 justify-end">
							<div class="flex-1 flex justify-end">
								<div class="bg-gray-900 text-white rounded-2xl rounded-tr-sm px-5 py-4 inline-block max-w-2xl">
									<p class="text-sm whitespace-pre-line">{message.content}</p>
									<p class="mt-2 text-xs uppercase tracking-wide text-gray-400 text-right">You · {new Date(message.created_at).toLocaleString()}</p>
								</div>
							</div>
						</div>
					{/if}
				{/each}
			{:else}
				<div class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center text-gray-500">
					<p class="text-lg font-semibold text-gray-700">No messages yet</p>
					<p class="mt-2 text-sm">Start the conversation with a goal, audience, or offer and we’ll guide the rest.</p>
				</div>
			{/if}
		</div>
	</div>

	<div class="border-t border-gray-200 bg-white px-8 py-6">
		<div class="max-w-4xl mx-auto">
			<form
				class="bg-white border border-gray-200 rounded-2xl shadow-sm"
				onsubmit={(event) => {
					event.preventDefault();
					alert('This is a static preview.');
				}}
			>
				<div class="flex items-center gap-3 p-3">
					<input
						type="text"
						name="message"
						placeholder="Write something..."
						class="flex-1 px-5 py-3 outline-none text-gray-800"
						required
						bind:value={messageDraft}
					/>
					<button
						type="submit"
						class="p-3 text-gray-600 hover:text-gray-900 transition"
						aria-label="Send message"
					>
						<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
						</svg>
					</button>
				</div>
				<div class="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
					<button type="button" class="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
						</svg>
						<span>Attach</span>
					</button>
					<Button type="button" variant="outline" onclick={handleDashboardClick}>Go to Dashboard</Button>
				</div>
			</form>
		</div>
	</div>
</div>
