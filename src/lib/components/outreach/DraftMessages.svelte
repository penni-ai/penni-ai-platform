<script lang="ts">
	import { slideFade } from './transitions';
	import EmailEditor from '../EmailEditor.svelte';
	import Button from '../Button.svelte';
	import type { ContactMethod } from './types';
	
	interface Props {
		navigationDirection?: 'forward' | 'backward';
		editingPlatform: ContactMethod | null;
		messageContents: Record<ContactMethod, string>;
		navigationValidationErrors: Record<ContactMethod, string[]>;
		gmailConnected: boolean;
		campaignId?: string | null;
		isDrafting: boolean;
		isQuickDrafting: boolean;
		quickDraftError: string | null;
		hasContactMethodSelected: (method: ContactMethod) => boolean;
		getRecipientCount: (method: ContactMethod) => number;
		getMethodIcon: (method: ContactMethod) => string;
		onEditingPlatformChange: (platform: ContactMethod | null) => void;
		onUpdateMessageContent: (platform: ContactMethod, content: string) => void;
		onSaveOutreachState: (immediate: boolean) => void;
		onQuickDraft: () => void;
		onOpenDraftModal: () => void;
		onOpenFooterModal: () => void;
		onConnectGmail: () => void;
	}
	
	let {
		editingPlatform,
		messageContents,
		navigationValidationErrors,
		gmailConnected,
		campaignId,
		isDrafting,
		isQuickDrafting,
		quickDraftError,
		hasContactMethodSelected,
		getRecipientCount,
		getMethodIcon,
		onEditingPlatformChange,
		onUpdateMessageContent,
		onSaveOutreachState,
		onQuickDraft,
		onOpenDraftModal,
		onOpenFooterModal,
		onConnectGmail,
		navigationDirection = 'forward'
	}: Props = $props();
</script>

<div class="absolute inset-0 h-full flex" transition:slideFade={{ axis: 'x', duration: 300, direction: navigationDirection }}>
	<!-- Left Column: Platform Buttons -->
	<div class="w-[20%] border-r border-gray-200 flex flex-col">
		<div class="p-6">
			<h3 class="text-sm font-semibold text-gray-900 mb-4">Message Templates</h3>
			<div class="space-y-2">
				{#if hasContactMethodSelected('email')}
					{@const emailCount = getRecipientCount('email')}
					{@const hasEmailErrors = navigationValidationErrors.email.length > 0}
					<button
						type="button"
						onclick={() => onEditingPlatformChange(editingPlatform === 'email' ? null : 'email')}
						class="w-full flex flex-col items-start gap-1 px-4 py-3 rounded-lg border-2 text-sm font-medium transition-colors {
							editingPlatform === 'email'
								? 'border-[#FF6F61] bg-[#FFF1ED] text-gray-900' 
								: hasEmailErrors
								? 'border-red-300 bg-red-50 text-gray-900'
								: 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
						}"
					>
						<div class="flex items-center gap-2 w-full">
							{@html getMethodIcon('email')}
							<span>Email</span>
							{#if hasEmailErrors}
								<svg class="ml-auto h-5 w-5 text-red-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
							{/if}
						</div>
						<span class="text-xs text-gray-500">to {emailCount} {emailCount === 1 ? 'person' : 'people'}</span>
					</button>
				{/if}
				{#if hasContactMethodSelected('instagram')}
					{@const instagramCount = getRecipientCount('instagram')}
					{@const hasInstagramErrors = navigationValidationErrors.instagram.length > 0}
					<button
						type="button"
						onclick={() => {
							onEditingPlatformChange(editingPlatform === 'instagram' ? null : 'instagram');
							onSaveOutreachState(true);
						}}
						class="w-full flex flex-col items-start gap-1 px-4 py-3 rounded-lg border-2 text-sm font-medium transition-colors {
							editingPlatform === 'instagram'
								? 'border-[#FF6F61] bg-[#FFF1ED] text-gray-900'
								: hasInstagramErrors
								? 'border-red-300 bg-red-50 text-gray-900'
								: 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
						}"
					>
						<div class="flex items-center gap-2 w-full">
							{@html getMethodIcon('instagram')}
							<span>Instagram</span>
							{#if hasInstagramErrors}
								<svg class="ml-auto h-5 w-5 text-red-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
							{/if}
						</div>
						<span class="text-xs text-gray-500">to {instagramCount} {instagramCount === 1 ? 'person' : 'people'}</span>
					</button>
				{/if}
				{#if hasContactMethodSelected('tiktok')}
					{@const tiktokCount = getRecipientCount('tiktok')}
					{@const hasTiktokErrors = navigationValidationErrors.tiktok.length > 0}
					<button
						type="button"
						onclick={() => {
							onEditingPlatformChange(editingPlatform === 'tiktok' ? null : 'tiktok');
							onSaveOutreachState(true);
						}}
						class="w-full flex flex-col items-start gap-1 px-4 py-3 rounded-lg border-2 text-sm font-medium transition-colors {
							editingPlatform === 'tiktok'
								? 'border-[#FF6F61] bg-[#FFF1ED] text-gray-900' 
								: hasTiktokErrors
								? 'border-red-300 bg-red-50 text-gray-900'
								: 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
						}"
					>
						<div class="flex items-center gap-2 w-full">
							{@html getMethodIcon('tiktok')}
							<span>TikTok</span>
							{#if hasTiktokErrors}
								<svg class="ml-auto h-5 w-5 text-red-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
							{/if}
						</div>
						<span class="text-xs text-gray-500">to {tiktokCount} {tiktokCount === 1 ? 'person' : 'people'}</span>
					</button>
				{/if}
			</div>
		</div>
	</div>

	<!-- Right Column: Editor -->
	<div class="flex-1 flex flex-col">
		{#if editingPlatform}
			{@const platform = editingPlatform}
			<!-- Gmail Connection Warning for Email -->
			{#if platform === 'email' && !gmailConnected}
				<div class="px-6 py-3 border-b border-amber-200 bg-amber-50 shrink-0">
					<div class="flex items-center gap-2 text-sm text-amber-800">
						<svg class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
						</svg>
						<div class="flex-1">
							<p class="font-medium">Gmail not connected</p>
							<p class="text-xs text-amber-700">Connect Gmail to send emails. You can still draft your message.</p>
						</div>
						<Button
							variant="primary"
							size="sm"
							onclick={onConnectGmail}
						>
							Connect Gmail
						</Button>
					</div>
				</div>
			{/if}
			<!-- Draft with ChatGPT and Customize Footer Buttons -->
			{#if campaignId}
				<div class="px-6 py-4 border-b border-gray-200 shrink-0 flex items-center justify-between gap-2">
					<div class="flex items-center gap-2">
						<button
							type="button"
							onclick={onQuickDraft}
							disabled={isDrafting || isQuickDrafting}
							class="px-4 py-2 text-sm text-white rounded border border-transparent bg-gradient-to-r from-orange-500 via-pink-500 to-red-500 hover:from-orange-600 hover:via-pink-600 hover:to-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm quick-draft-btn flex items-center gap-2"
						>
							<img 
								src="/images/icon/pink_white_icon.png" 
								alt="Penni" 
								class="h-5 w-5"
							/>
							<span>{isQuickDrafting ? 'Drafting...' : 'Penni Quick Draft'}</span>
						</button>
					</div>
					<div class="flex items-center gap-2">
						<button
							type="button"
							onclick={onOpenDraftModal}
							disabled={isDrafting || isQuickDrafting}
							class="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
						>
							{isDrafting ? 'Drafting...' : 'Draft with ChatGPT'}
						</button>
						<button
							type="button"
							disabled
							class="px-4 py-2 text-sm text-gray-400 border border-gray-300 rounded cursor-not-allowed relative group"
							title="Not Available"
						>
							<span class="group-hover:hidden">Choose Template</span>
							<span class="hidden group-hover:inline">Not Available</span>
						</button>
						{#if platform === 'email'}
							<button
								type="button"
								onclick={onOpenFooterModal}
								class="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
							>
								Customize Footer
							</button>
						{/if}
					</div>
				</div>
				{#if quickDraftError}
					<div class="px-6 py-2 bg-red-50 border-b border-red-200">
						<p class="text-sm text-red-700">{quickDraftError}</p>
					</div>
				{/if}
			{/if}
			<div class="flex-1 overflow-hidden flex flex-col">
				{#if navigationValidationErrors[platform].length > 0}
					<div class="px-6 py-3 bg-red-50 border-b border-red-200">
						<div class="flex items-start gap-2">
							<svg class="w-5 h-5 text-red-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
							</svg>
							<div class="flex-1">
								<p class="text-sm font-medium text-red-800">Cannot proceed: Placeholders not filled</p>
								<p class="text-xs text-red-700 mt-1">
									Please fill in or remove all placeholders before continuing: 
									<span class="font-mono font-semibold">
										{navigationValidationErrors[platform].join(', ')}
									</span>
								</p>
							</div>
						</div>
					</div>
				{/if}
				<EmailEditor 
					content={messageContents[platform]}
					onUpdate={(content) => {
						onUpdateMessageContent(platform, content);
					}}
				/>
			</div>
		{:else}
			<div class="flex-1 flex items-center justify-center text-gray-400">
				<p>Select a platform to draft your message</p>
			</div>
		{/if}
	</div>
</div>

<style>
	.quick-draft-btn:disabled {
		animation: none;
	}
</style>

