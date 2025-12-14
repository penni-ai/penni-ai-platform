<script lang="ts">
	import { slideFade } from './transitions';

	interface Props {
		navigationDirection?: 'forward' | 'backward';
	}

	let { navigationDirection = 'forward' }: Props = $props();
</script>

<div class="absolute inset-0 h-full flex" transition:slideFade={{ axis: 'x', duration: 300, direction: navigationDirection }}>
	<div class="w-full h-full p-8 overflow-y-auto">
		<div class="max-w-4xl mx-auto">
			<h2 class="text-lg font-medium mb-6" style="color: var(--color-text);">Before you send</h2>

			<div class="grid grid-cols-2 gap-6">
				<!-- Message Preview -->
				<div class="p-6" style="border-bottom: 2px solid var(--color-primary);">
					<div class="flex items-start gap-4">
						<div class="shrink-0 w-8 h-8 flex items-center justify-center" style="color: var(--color-primary);">
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7Z" />
							</svg>
						</div>
						<div class="flex-1">
							<h4 class="text-sm font-medium mb-2" style="color: var(--color-text);">Message Preview</h4>
							<p class="text-sm" style="color: var(--color-text-secondary);">Preview all messages before sending. Click the preview button next to any message to see how it will appear with personalized details.</p>
						</div>
					</div>
				</div>

				<!-- Gmail Drafts -->
				<div class="p-6" style="border-bottom: 2px solid var(--color-border);">
					<div class="flex items-start gap-4">
						<div class="shrink-0 w-8 h-8 flex items-center justify-center" style="color: var(--color-text-secondary);">
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
							</svg>
						</div>
						<div class="flex-1">
							<h4 class="text-sm font-medium mb-2" style="color: var(--color-text);">Gmail Drafts</h4>
							<p class="text-sm mb-3" style="color: var(--color-text-secondary);">Email messages will be created as drafts in your Gmail account. Review and edit before sending.</p>
							<a
								href="/my-account"
								class="text-xs font-medium transition-opacity inline-flex items-center gap-1"
								style="color: var(--color-primary);"
								onmouseenter={(e) => e.currentTarget.style.opacity = '0.7'}
								onmouseleave={(e) => e.currentTarget.style.opacity = '1'}
							>
								Account Settings
								<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
								</svg>
							</a>
						</div>
					</div>
				</div>

				<!-- Outreach Count -->
				<div class="p-6" style="border-bottom: 2px solid var(--color-border);">
					<div class="flex items-start gap-4">
						<div class="shrink-0 w-8 h-8 flex items-center justify-center" style="color: var(--color-text-secondary);">
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
							</svg>
						</div>
						<div class="flex-1">
							<h4 class="text-sm font-medium mb-2" style="color: var(--color-text);">Usage</h4>
							<p class="text-sm" style="color: var(--color-text-secondary);">Outreach credits will be used when you send messages. Make sure you have enough credits before proceeding.</p>
						</div>
					</div>
				</div>

				<!-- Instagram/TikTok -->
				<div class="p-6" style="border-bottom: 2px solid var(--color-border);">
					<div class="flex items-start gap-4">
						<div class="shrink-0 w-8 h-8 flex items-center justify-center" style="color: var(--color-text-secondary);">
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
							</svg>
						</div>
						<div class="flex-1">
							<h4 class="text-sm font-medium mb-2" style="color: var(--color-text);">Social Platforms</h4>
							<p class="text-sm" style="color: var(--color-text-secondary);">For Instagram and TikTok, clicking send will open influencer profiles in new tabs. Send messages manually through each platform.</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
