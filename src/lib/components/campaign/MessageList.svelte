<script lang="ts">
	import type { ApiMessage } from '$lib/types/campaign';

	interface Props {
		messages: ApiMessage[];
		isSending?: boolean;
	}

	let { messages, isSending = false }: Props = $props();
</script>

{#each messages as message}
	{#if message.type === 'intro'}
		<div class="mx-auto mt-12 flex flex-col items-center text-center gap-4">
			<span class="flex h-12 w-12 items-center justify-center rounded-full bg-[#FFF1ED] text-2xl">👋</span>
			<p class="max-w-xl text-lg leading-relaxed text-gray-800">{message.content}</p>
		</div>
	{:else if message.role === 'assistant'}
		<div class="flex flex-col gap-1">
			<p class="text-xs font-medium text-gray-500 ml-14">Penni AI</p>
			<div class="flex items-start gap-3">
				<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full overflow-hidden">
					<img
						src="/images/branding/white%20icon%20with%20pink%20SVG.svg"
						alt="Penny assistant"
						class="h-full w-full object-contain"
					/>
				</div>
				<div class="max-w-xl rounded-3xl bg-white px-5 py-4 text-sm text-gray-800 shadow-sm">
					<p class="whitespace-pre-line leading-relaxed">{message.content}</p>
					{#if message.sources && message.sources.length}
						<div class="mt-2 flex items-center relative group">
							<button
								type="button"
								class="flex items-center justify-center w-5 h-5 text-gray-400 hover:text-gray-600 transition-colors"
								aria-label="View sources"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									class="w-4 h-4"
								>
									<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
									<path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
								</svg>
							</button>
							<!-- Tooltip on hover - appears below the icon -->
							<div class="absolute top-full left-0 mt-1 hidden group-hover:block z-50 w-64">
								<div class="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600 shadow-lg">
									<p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Sources</p>
									<ul class="space-y-1.5">
										{#each message.sources as source}
											<li>
												<a
													href={source.url}
													target="_blank"
													rel="noreferrer"
													class="block text-gray-900 hover:text-[#FF6F61] transition-colors break-all"
												>
													{source.url}
												</a>
											</li>
										{/each}
									</ul>
								</div>
								<!-- Tooltip arrow pointing up -->
								<div class="absolute bottom-full left-4 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-200"></div>
								<div class="absolute bottom-full left-4 -mb-px w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-white"></div>
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>
	{:else}
		<div class="flex flex-col items-end gap-1">
			<p class="text-xs font-medium text-gray-500 mr-4">You</p>
			<div class="flex justify-end">
				<div class="max-w-xl rounded-3xl bg-gray-900 px-5 py-4 text-sm text-white">
					<p class="leading-relaxed">{message.content}</p>
				</div>
			</div>
		</div>
	{/if}
{/each}

{#if isSending}
	<div class="flex flex-col gap-1">
		<p class="text-xs font-medium text-gray-500 ml-14">Penni AI</p>
		<div class="flex items-start gap-3">
			<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full overflow-hidden">
				<img
					src="/images/branding/white%20icon%20with%20pink%20SVG.svg"
					alt="Penny assistant"
					class="h-full w-full object-contain"
				/>
			</div>
			<div class="rounded-3xl bg-white px-4 py-2 shadow-sm">
				<span class="flex items-center gap-1">
					<span class="h-2 w-2 animate-pulse rounded-full bg-gray-400"></span>
					<span class="h-2 w-2 animate-pulse rounded-full bg-gray-300" style="animation-delay: 120ms;"></span>
					<span class="h-2 w-2 animate-pulse rounded-full bg-gray-200" style="animation-delay: 240ms;"></span>
				</span>
			</div>
		</div>
	</div>
{/if}

