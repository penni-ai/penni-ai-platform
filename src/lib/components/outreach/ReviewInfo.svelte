<script lang="ts">
	import { slideFade } from './transitions';
	
	interface Props {
		navigationDirection?: 'forward' | 'backward';
	}
	
	let { navigationDirection = 'forward' }: Props = $props();
</script>

<div class="absolute inset-0 h-full flex" transition:slideFade={{ axis: 'x', duration: 300, direction: navigationDirection }}>
	<div class="w-full h-full p-6">
		<div class="grid grid-cols-2 grid-rows-2 gap-6 h-full">
			<!-- Message Preview -->
			<div class="bg-white border border-gray-200 rounded-lg p-6 flex flex-col">
				<div class="flex items-start gap-4 flex-1">
					<div class="shrink-0 w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
						<svg class="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7Z" />
						</svg>
					</div>
					<div class="flex-1">
						<h4 class="text-lg font-semibold text-gray-900 mb-2">Message Preview</h4>
						<p class="text-gray-600">You can preview all messages before sending. Click the preview button next to any email message to see how it will look with the influencer's information filled in.</p>
					</div>
				</div>
			</div>
			
			<!-- Gmail Drafts -->
			<div class="bg-white border border-gray-200 rounded-lg p-6 flex flex-col">
				<div class="flex items-start gap-4 flex-1">
					<div class="shrink-0 w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
						<svg class="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
						</svg>
					</div>
					<div class="flex-1">
						<h4 class="text-lg font-semibold text-gray-900 mb-2">Gmail Drafts</h4>
						<p class="text-gray-600 mb-3">Email messages will be created as drafts in your Gmail account. You can review and edit them before sending. Direct Gmail Send can be enabled in your settings for automatic sending.</p>
						<a
							href="/my-account"
							class="text-sm text-[#FF6F61] hover:text-[#FF5A4A] font-medium inline-flex items-center gap-1"
						>
							Go to Settings →
						</a>
					</div>
				</div>
			</div>
			
			<!-- Outreach Count -->
			<div class="bg-white border border-gray-200 rounded-lg p-6 flex flex-col">
				<div class="flex items-start gap-4 flex-1">
					<div class="shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
						<svg class="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					</div>
					<div class="flex-1">
						<h4 class="text-lg font-semibold text-gray-900 mb-2">Outreach Usage</h4>
						<p class="text-gray-600">When you click the "Send Messages" buttons, your outreach count will be depleted based on the number of messages sent. Make sure you have enough outreach credits before proceeding.</p>
					</div>
				</div>
			</div>
			
			<!-- Instagram/TikTok -->
			<div class="bg-white border border-gray-200 rounded-lg p-6 flex flex-col">
				<div class="flex items-start gap-4 flex-1">
					<div class="shrink-0 w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
						<svg class="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
						</svg>
					</div>
					<div class="flex-1">
						<h4 class="text-lg font-semibold text-gray-900 mb-2">Instagram & TikTok</h4>
						<p class="text-gray-600">For Instagram and TikTok messages, clicking "Send Messages" will open the influencer profiles in new tabs. You can then manually send the messages through their respective platforms.</p>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>

