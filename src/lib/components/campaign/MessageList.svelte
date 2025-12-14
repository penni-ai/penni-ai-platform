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
		<div class="mx-auto mt-12 flex flex-col items-center text-center gap-3">
			<span class="flex h-10 w-10 items-center justify-center border border-[#FF6F61]/20 bg-[#FF6F61]/5 text-xl">Hi</span>
			<p class="max-w-xl text-base leading-relaxed text-gray-700">{message.content}</p>
		</div>
	{:else if message.role === 'assistant'}
		<div class="flex flex-col gap-1">
			<p class="text-[11px] font-medium uppercase tracking-wider text-gray-400 ml-12">Penni AI</p>
			<div class="flex items-start gap-3">
				<div class="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden">
					<img
						src="/images/branding/white%20icon%20with%20pink%20SVG.svg"
						alt="Penny assistant"
						class="h-full w-full object-contain"
					/>
				</div>
				<div class="max-w-xl border-l-2 border-gray-100 pl-4 py-1 text-sm text-gray-700">
					<p class="whitespace-pre-line leading-relaxed">{message.content}</p>
					{#if message.sources && message.sources.length}
						<div class="mt-3 flex items-center relative group">
							<button
								type="button"
								class="flex items-center justify-center w-5 h-5 text-gray-400 hover:text-[#FF6F61] transition-colors"
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
								<div class="border border-gray-100 bg-white p-3 text-xs text-gray-600">
									<p class="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Sources</p>
									<ul class="space-y-1.5">
										{#each message.sources as source}
											<li>
												<a
													href={source.url}
													target="_blank"
													rel="noreferrer"
													class="block text-gray-700 hover:text-[#FF6F61] transition-colors break-all"
												>
													{source.url}
												</a>
											</li>
										{/each}
									</ul>
								</div>
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>
	{:else}
		<div class="flex flex-col items-end gap-1">
			<p class="text-[11px] font-medium uppercase tracking-wider text-gray-400 mr-4">You</p>
			<div class="flex justify-end">
				<div class="max-w-xl bg-gray-900 px-4 py-3 text-sm text-white">
					<p class="leading-relaxed">{message.content}</p>
				</div>
			</div>
		</div>
	{/if}
{/each}

{#if isSending}
	<div class="flex flex-col gap-1">
		<p class="text-[11px] font-medium uppercase tracking-wider text-gray-400 ml-12">Penni AI</p>
		<div class="flex items-start gap-3">
			<div class="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden">
				<img
					src="/images/branding/white%20icon%20with%20pink%20SVG.svg"
					alt="Penny assistant"
					class="h-full w-full object-contain"
				/>
			</div>
			<div class="border-l-2 border-gray-100 pl-4 py-2">
				<span class="flex items-center gap-1.5">
					<span class="h-1.5 w-1.5 animate-pulse bg-[#FF6F61]"></span>
					<span class="h-1.5 w-1.5 animate-pulse bg-[#FF6F61]/60" style="animation-delay: 120ms;"></span>
					<span class="h-1.5 w-1.5 animate-pulse bg-[#FF6F61]/30" style="animation-delay: 240ms;"></span>
				</span>
			</div>
		</div>
	</div>
{/if}

