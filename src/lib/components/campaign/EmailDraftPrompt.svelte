<script lang="ts">
	import { fade, fly, scale } from 'svelte/transition';
	import { elasticOut } from 'svelte/easing';
	import Button from '$lib/components/Button.svelte';

	interface Props {
		open: boolean;
		onConfirm: () => void;
		onDismiss: () => void;
	}

	let { open, onConfirm, onDismiss }: Props = $props();
</script>

{#if open}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
		onclick={onDismiss}
		onkeydown={(e) => e.key === 'Escape' && onDismiss()}
		role="button"
		tabindex="-1"
		aria-label="Close prompt"
		transition:fade={{ duration: 200 }}
	>
		<!-- Card -->
		<div
			class="relative w-full max-w-sm overflow-hidden rounded-3xl bg-gradient-to-br from-rose-50 via-white to-amber-50 shadow-2xl ring-1 ring-rose-100"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && onDismiss()}
			role="dialog"
			aria-modal="true"
			aria-labelledby="email-prompt-title"
			tabindex="-1"
			transition:fly={{ y: 30, duration: 400, easing: elasticOut }}
		>
			<!-- Decorative top accent -->
			<div class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-400 via-pink-400 to-amber-400"></div>
			
			<!-- Content -->
			<div class="px-6 py-8 text-center space-y-5">
				<!-- Animated icon -->
				<div 
					class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-100 to-amber-100 shadow-inner"
					transition:scale={{ duration: 300, delay: 100, easing: elasticOut }}
				>
					<svg class="h-8 w-8 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
					</svg>
				</div>

				<!-- Title -->
				<div class="space-y-2">
					<h3 id="email-prompt-title" class="text-xl font-bold text-gray-900">
						Draft your outreach?
					</h3>
					<p class="text-sm text-gray-600 leading-relaxed">
						While we find the perfect influencers, why not draft your email? Get a head start on your outreach!
					</p>
				</div>

				<!-- Subtle animation hint -->
				<div class="flex items-center justify-center gap-1.5 text-xs text-gray-400">
					<span class="inline-block h-1.5 w-1.5 rounded-full bg-rose-300 animate-pulse"></span>
					<span>Search in progress</span>
				</div>
			</div>

			<!-- Actions -->
			<div class="border-t border-rose-100/60 bg-white/60 px-6 py-4 flex flex-col gap-2.5">
				<Button 
					variant="primary" 
					size="md" 
					fullWidth={true} 
					onclick={onConfirm}
				>
					<span class="flex items-center justify-center gap-2">
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
						</svg>
						Yes, let's draft it
					</span>
				</Button>
				<button
					type="button"
					class="w-full py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors rounded-xl hover:bg-gray-50"
					onclick={onDismiss}
				>
					I'll do it later
				</button>
			</div>
		</div>
	</div>
{/if}

