<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';

	type ChatMessage = {
		id: string;
		author: 'assistant' | 'user';
		content?: string;
		type?: 'intro' | 'text' | 'typing' | 'card';
		summary?: Array<{ label: string; value: string | undefined }>;
		heading?: string;
		body?: string;
		ctaLabel?: string;
		ctaHref?: string;
	};

	type StepKey = 'website' | 'audience' | 'locations';

	type Step = {
		key: StepKey;
		question: string;
	};

	let messageCounter = 0;

	const steps: Step[] = [
		{
			key: 'website',
			question: "What's your website or landing page for this campaign?"
		},
		{
			key: 'audience',
			question: "Thanks! 🔥\nNext, what kind of influencer profiles do you want to target? You can mention keywords, interests, or niches (e.g., foodies, skincare, fitness, tech)."
		},
		{
			key: 'locations',
			question: 'Perfect 🍑\nDo you want to target influencers in a specific location or region?'
		}
	];

	const completionMessage = "All set! I'm now generating a list of influencers that match your campaign...";
	const campaignId = 'student-ai-campaign';

	let conversation = $state<ChatMessage[]>([]);
	let draft = $state('');
let stepIndex = $state(0);
	let answers: Record<StepKey, string | undefined> = {
		website: undefined,
		audience: undefined,
		locations: undefined
	};
	let campaignCreated = $state(false);

	onMount(() => {
		conversation = [
			createAssistant(
				"👋 Hi! I'm Dime — your personal influencer manager. Let's get started with your campaign.",
				'intro'
			),
			createAssistant(steps[0].question)
		];
	});

	function nextId(prefix: string) {
		messageCounter += 1;
		return `${prefix}-${messageCounter}`;
	}

	function createAssistant(content: string, type: ChatMessage['type'] = 'text'): ChatMessage {
		return { id: nextId('assistant'), author: 'assistant', content, type };
	}

	function createUser(content: string): ChatMessage {
		return { id: nextId('user'), author: 'user', content, type: 'text' };
	}

	function queueAssistantMessage(text: string, options: { delay?: number } = {}) {
		const delay = options.delay ?? 350;
		const typingId = nextId('typing');
		conversation = [...conversation, { id: typingId, author: 'assistant', type: 'typing' }];

		setTimeout(() => {
			conversation = conversation.filter((message) => message.id !== typingId);
			conversation = [...conversation, createAssistant(text)];
		}, delay);
	}

	function showSummaryCard() {
		if (campaignCreated) return;
		campaignCreated = true;
		const details = [
			{ label: 'Website', value: answers.website },
			{ label: 'Influencer focus', value: answers.audience },
			{ label: 'Priority regions', value: answers.locations }
		];

		conversation = [
			...conversation,
			{
				id: nextId('card'),
				author: 'assistant',
				type: 'card',
				heading: 'Your campaign brief has been saved!',
				body: "You'll see matching influencers on your dashboard shortly.",
				summary: details,
				ctaLabel: 'View campaign',
				ctaHref: `/campaign/${campaignId}`
			}
		];
	}

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		const value = draft.trim();
		if (!value) return;

		const currentStep = steps[stepIndex];
		answers = { ...answers, [currentStep.key]: value };
		conversation = [...conversation, createUser(value)];
		draft = '';

		stepIndex += 1;

		if (stepIndex < steps.length) {
			queueAssistantMessage(steps[stepIndex].question);
		} else {
			queueAssistantMessage(completionMessage, { delay: 450 });
			setTimeout(showSummaryCard, 900);
		}
	}

</script>

<svelte:head>
	<title>Penny – Campaign Assistant</title>
</svelte:head>

<div class="flex flex-col h-full">
	<div class="flex-1 overflow-y-auto px-8 py-10">
		<div class="mx-auto flex w-full max-w-3xl flex-col gap-6">
			{#each conversation as message}
				{#if message.type === 'intro'}
					<div class="mx-auto mt-12 flex flex-col items-center text-center gap-4">
						<span class="flex h-12 w-12 items-center justify-center rounded-full bg-[#FFF1ED] text-2xl">👋</span>
						<div class="space-y-1">
							<p class="text-2xl font-semibold text-gray-900">Hi! I'm Dime — your personal influencer manager.</p>
							<p class="text-base text-gray-500">Let's get started with your campaign.</p>
						</div>
					</div>
				{:else if message.type === 'card'}
					<div class="flex justify-center">
						<div class="w-full rounded-3xl border border-emerald-200 bg-emerald-50 px-6 py-5 text-left text-sm text-emerald-800 shadow-sm md:w-3/4">
							<h3 class="text-base font-semibold text-emerald-900">{message.heading}</h3>
							<p class="mt-1 text-emerald-700">{message.body}</p>
							{#if message.summary}
								<ul class="mt-4 space-y-1 text-emerald-700">
									{#each message.summary as detail}
										<li><span class="font-medium">{detail.label}:</span> {detail.value ?? '—'}</li>
									{/each}
								</ul>
							{/if}
							{#if message.ctaHref}
								<div class="mt-4">
									<Button href={message.ctaHref} class="bg-[#FF6F61] text-gray-900 hover:bg-[#ff846f]">
										{message.ctaLabel ?? 'Open campaign'}
									</Button>
								</div>
							{/if}
						</div>
					</div>
				{:else if message.type === 'typing'}
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
				{:else if message.author === 'assistant'}
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
		</div>
	</div>

	<footer class="border-t border-gray-100 px-8 py-6">
		<div class="mx-auto w-full max-w-3xl">
			<form class="flex flex-col gap-3 rounded-3xl border border-gray-200 bg-white px-4 py-3 shadow-sm" onsubmit={handleSubmit}>
				<label class="sr-only" for="message">Write something</label>
				<input
					id="message"
					type="text"
					placeholder={stepIndex === 0 ? 'Start your campaign' : 'Write something...'}
					class="w-full border-none text-sm text-gray-900 focus:outline-none disabled:text-gray-400 disabled:bg-transparent"
					bind:value={draft}
					disabled={campaignCreated}
				/>
				<div class="flex items-center justify-between text-xs text-gray-500">
					<span class="inline-flex items-center gap-2 opacity-70">
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
						</svg>
						Attach
					</span>
					<button
						type="submit"
						class="flex h-8 w-8 items-center justify-center rounded-full bg-[#FF6F61] text-white hover:bg-[#ff846f] disabled:opacity-60 disabled:cursor-not-allowed"
						disabled={campaignCreated}
						aria-label="Send message"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M12 5l7 7-7 7" />
						</svg>
					</button>
				</div>
			</form>
		</div>
	</footer>
</div>
