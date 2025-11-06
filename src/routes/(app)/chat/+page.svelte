<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';

	type ApiMessage = {
		id: string;
		role: 'assistant' | 'user';
		content: string;
		type?: 'intro' | 'text' | 'summary';
		createdAt: string;
	};

	type ConversationResponse = {
		conversation: {
			id: string;
			status: 'collecting' | 'ready' | 'searching' | 'complete' | 'needs_config' | 'error';
			collected: Record<string, string | undefined>;
			missing: string[];
			search?: {
				status: 'idle' | 'pending' | 'complete' | 'error' | 'needs_config';
				results?: unknown;
				lastError?: string | null;
			};
			messages: ApiMessage[];
		};
	};

	const campaignId = 'student-ai-campaign';
	let conversationId = $state<string | null>(null);
	const campaignPreviewHref = $derived(() => (conversationId ? `/campaign/chat/${conversationId}` : `/campaign/${campaignId}`));
	let messages = $state<ApiMessage[]>([]);
	let draft = $state('');
	let collected = $state<Record<string, string | undefined>>({});
	let search = $state<{ status: 'idle' | 'pending' | 'complete' | 'error' | 'needs_config'; lastError?: string | null; results?: unknown }>({ status: 'idle' });
	let isInitializing = $state(true);
	let isSending = $state(false);
	let isFetchingSite = $state(false);
	let initError = $state<string | null>(null);
	let siteNotice = $state<{ type: 'success' | 'error'; message: string } | null>(null);

	const urlPattern = /^https?:\/\//i;

	onMount(() => {
		void bootstrapConversation();
	});

	async function bootstrapConversation() {
		isInitializing = true;
		initError = null;
		try {
			const response = await fetch('/api/chat', { method: 'POST' });
			if (!response.ok) {
				throw new Error(`Failed to start conversation (${response.status})`);
			}
			const data = (await response.json()) as ConversationResponse;
			applyConversationSnapshot(data);
		} catch (error) {
			console.error('[chat] bootstrap failed', error);
			initError = error instanceof Error ? error.message : 'Failed to start conversation';
		} finally {
			isInitializing = false;
		}
	}

	function applyConversationSnapshot(data: ConversationResponse) {
		conversationId = data.conversation.id;
		messages = data.conversation.messages;
		collected = data.conversation.collected ?? {};
		search = data.conversation.search ?? { status: 'idle' };
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
	if (!conversationId || isSending || isFetchingSite) return;
	const value = draft.trim();
	if (!value) return;

	const isUrl = urlPattern.test(value);
	if (isUrl) {
		isFetchingSite = true;
		siteNotice = null;
		try {
			const response = await fetch('/api/chat/site', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: value })
			});
			const data = await response.json();
			if (!response.ok) {
				throw new Error(typeof data?.error === 'string' ? data.error : `Site fetch failed (${response.status})`);
			}
			siteNotice = { type: 'success', message: 'Website captured for the assistant.' };
		} catch (error) {
			console.error('[chat] site capture failed', error);
			siteNotice = {
				type: 'error',
				message: error instanceof Error ? error.message : 'Unable to capture that website right now.'
			};
			isFetchingSite = false;
			return;
		} finally {
			isFetchingSite = false;
		}
	}

	isSending = true;
	const optimisticId = crypto.randomUUID();
		messages = [
			...messages,
			{
				id: optimisticId,
				role: 'user',
				content: value,
				type: 'text',
				createdAt: new Date().toISOString()
			}
		];
		draft = '';

		try {
			const response = await fetch(`/api/chat/${conversationId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message: value })
			});

			if (!response.ok) {
				throw new Error(`Assistant error (${response.status})`);
			}

			const data = (await response.json()) as ConversationResponse;
			applyConversationSnapshot(data);
		} catch (error) {
			console.error('[chat] message submit failed', error);
			messages = messages.filter((message) => message.id !== optimisticId);
			messages = [
				...messages,
				{
					id: crypto.randomUUID(),
					role: 'assistant',
					content: 'I hit a snag sending that. Please try again.',
					type: 'text',
					createdAt: new Date().toISOString()
				}
			];
		} finally {
			isSending = false;
		}
	}

	const summaryFields = [
		{ key: 'website', label: 'Website' },
		{ key: 'audience', label: 'Influencer focus' },
		{ key: 'locations', label: 'Priority regions' },
		{ key: 'followers', label: 'Follower range' }
	];

	function hasSummaryReady() {
		return (
			search.status === 'complete' ||
			search.status === 'pending' ||
			search.status === 'needs_config' ||
			search.status === 'error'
		);
	}
</script>

<svelte:head>
	<title>Penny – Campaign Assistant</title>
</svelte:head>

<div class="flex flex-col h-full">
	<div class="flex-1 overflow-y-auto px-8 py-10">
		<div class="mx-auto flex w-full max-w-3xl flex-col gap-6">
			{#if isInitializing}
				<div class="flex justify-center py-12 text-gray-500">Booting up your assistant…</div>
			{:else if initError}
				<div class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
					<p class="font-semibold">We couldn’t start the assistant.</p>
					<p class="text-sm">{initError}</p>
					<button class="mt-4 text-sm font-medium text-red-700 underline" onclick={() => void bootstrapConversation()}>Try again</button>
				</div>
			{:else}
				{#each messages as message}
					{#if message.type === 'intro'}
						<div class="mx-auto mt-12 flex flex-col items-center text-center gap-4">
							<span class="flex h-12 w-12 items-center justify-center rounded-full bg-[#FFF1ED] text-2xl">👋</span>
							<p class="max-w-xl text-lg leading-relaxed text-gray-800">{message.content}</p>
						</div>
					{:else if message.role === 'assistant'}
						<div class="flex items-start gap-3">
							<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#FFF1ED] text-[#FF6F61]">
								✨
							</div>
							<div class="max-w-xl rounded-3xl bg-white px-5 py-4 text-sm text-gray-800 shadow-sm">
								<p class="whitespace-pre-line leading-relaxed">{message.content}</p>
							</div>
						</div>
					{:else}
						<div class="flex justify-end">
							<div class="max-w-xl rounded-3xl bg-gray-900 px-5 py-4 text-sm text-white">
								<p class="leading-relaxed">{message.content}</p>
							</div>
						</div>
					{/if}
				{/each}

				{#if isSending}
					<div class="flex items-start gap-3">
						<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#FFF1ED] text-[#FF6F61]">
							✨
						</div>
						<div class="rounded-3xl bg-white px-4 py-2 shadow-sm">
							<span class="flex items-center gap-1">
								<span class="h-2 w-2 animate-pulse rounded-full bg-gray-400"></span>
								<span class="h-2 w-2 animate-pulse rounded-full bg-gray-300" style="animation-delay: 120ms;"></span>
								<span class="h-2 w-2 animate-pulse rounded-full bg-gray-200" style="animation-delay: 240ms;"></span>
							</span>
						</div>
					</div>
				{/if}

				{#if hasSummaryReady()}
					<div class="flex justify-center">
						<div class="w-full rounded-3xl border border-emerald-200 bg-emerald-50 px-6 py-5 text-left text-sm text-emerald-800 shadow-sm md:w-3/4">
						<h3 class="text-base font-semibold text-emerald-900">Your campaign brief</h3>
						<p class="mt-1 text-emerald-700">
							{#if search.status === 'complete'}
								You'll see matching influencers on your dashboard shortly.
							{:else if search.status === 'pending'}
								I've queued your search request and will send it once the search service is connected.
							{:else if search.status === 'needs_config'}
								Search configuration is incomplete—update the app hosting environment and retry.
							{:else if search.status === 'error'}
								I hit a snag pulling matches. Our team has been notified.
							{:else}
								Great! I'm preparing your matches.
							{/if}
						</p>
							<ul class="mt-4 space-y-1 text-emerald-700">
								{#each summaryFields as field}
									<li><span class="font-medium">{field.label}:</span> {collected[field.key] ?? '—'}</li>
								{/each}
							</ul>
					{#if search.status === 'complete'}
						<div class="mt-4">
							<Button href={$campaignPreviewHref} class="bg-[#FF6F61] text-gray-900 hover:bg-[#ff846f]">
								View campaign
							</Button>
						</div>
					{/if}
							{#if (search.status === 'needs_config' || search.status === 'error' || search.status === 'pending') && search.lastError}
								<p class="mt-3 text-xs text-emerald-600">{search.lastError}</p>
							{/if}
						</div>
					</div>
				{/if}
			{/if}
		</div>
	</div>

	<div class="border-t border-gray-200 bg-white px-6 py-5">
		{#if siteNotice}
			<div class={`mx-auto mb-3 flex w-full max-w-3xl items-center gap-2 rounded-xl px-4 py-3 text-sm ${siteNotice.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
				{siteNotice.message}
			</div>
		{/if}
		<form class="mx-auto flex w-full max-w-3xl items-center gap-3" onsubmit={handleSubmit}>
			<input
				type="text"
				class="flex-1 rounded-full border border-gray-300 px-5 py-3 text-sm shadow-sm focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10"
				placeholder="Type your reply..."
				bind:value={draft}
				autocomplete="off"
				disabled={isInitializing || !conversationId || isFetchingSite}
			/>
			<Button type="submit" variant="primary" size="md" disabled={draft.trim().length === 0 || isInitializing || !conversationId || isFetchingSite}>
				Send
			</Button>
		</form>
	</div>
</div>
