<script lang="ts">
	import { slideFade } from './transitions';
	import EmailEditor from '../EmailEditor.svelte';
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
	<div class="w-56 flex flex-col shrink-0" style="border-right: 1px solid var(--color-border);">
		<div class="p-6">
			<h3 class="text-xs font-medium uppercase tracking-wide mb-4" style="color: var(--color-text-muted);">Templates</h3>
			<div class="space-y-1">
				{#if hasContactMethodSelected('email')}
					{@const emailCount = getRecipientCount('email')}
					{@const hasEmailErrors = navigationValidationErrors.email.length > 0}
					<button
						type="button"
						onclick={() => onEditingPlatformChange(editingPlatform === 'email' ? null : 'email')}
						class="w-full flex flex-col items-start gap-1 px-4 py-3 text-sm transition-colors text-left"
						style="border-bottom: 2px solid {editingPlatform === 'email' ? 'var(--color-primary)' : hasEmailErrors ? '#ef4444' : 'transparent'}; color: {editingPlatform === 'email' ? 'var(--color-text)' : 'var(--color-text-secondary)'};"
						onmouseenter={(e) => {
							if (editingPlatform !== 'email') {
								e.currentTarget.style.color = 'var(--color-text)';
							}
						}}
						onmouseleave={(e) => {
							if (editingPlatform !== 'email') {
								e.currentTarget.style.color = 'var(--color-text-secondary)';
							}
						}}
					>
						<div class="flex items-center gap-2 w-full">
							{@html getMethodIcon('email')}
							<span class="font-medium">Email</span>
							{#if hasEmailErrors}
								<svg class="ml-auto h-4 w-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
							{/if}
						</div>
						<span class="text-xs" style="color: var(--color-text-muted);">{emailCount} {emailCount === 1 ? 'recipient' : 'recipients'}</span>
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
						class="w-full flex flex-col items-start gap-1 px-4 py-3 text-sm transition-colors text-left"
						style="border-bottom: 2px solid {editingPlatform === 'instagram' ? 'var(--color-primary)' : hasInstagramErrors ? '#ef4444' : 'transparent'}; color: {editingPlatform === 'instagram' ? 'var(--color-text)' : 'var(--color-text-secondary)'};"
						onmouseenter={(e) => {
							if (editingPlatform !== 'instagram') {
								e.currentTarget.style.color = 'var(--color-text)';
							}
						}}
						onmouseleave={(e) => {
							if (editingPlatform !== 'instagram') {
								e.currentTarget.style.color = 'var(--color-text-secondary)';
							}
						}}
					>
						<div class="flex items-center gap-2 w-full">
							{@html getMethodIcon('instagram')}
							<span class="font-medium">Instagram</span>
							{#if hasInstagramErrors}
								<svg class="ml-auto h-4 w-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
							{/if}
						</div>
						<span class="text-xs" style="color: var(--color-text-muted);">{instagramCount} {instagramCount === 1 ? 'recipient' : 'recipients'}</span>
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
						class="w-full flex flex-col items-start gap-1 px-4 py-3 text-sm transition-colors text-left"
						style="border-bottom: 2px solid {editingPlatform === 'tiktok' ? 'var(--color-primary)' : hasTiktokErrors ? '#ef4444' : 'transparent'}; color: {editingPlatform === 'tiktok' ? 'var(--color-text)' : 'var(--color-text-secondary)'};"
						onmouseenter={(e) => {
							if (editingPlatform !== 'tiktok') {
								e.currentTarget.style.color = 'var(--color-text)';
							}
						}}
						onmouseleave={(e) => {
							if (editingPlatform !== 'tiktok') {
								e.currentTarget.style.color = 'var(--color-text-secondary)';
							}
						}}
					>
						<div class="flex items-center gap-2 w-full">
							{@html getMethodIcon('tiktok')}
							<span class="font-medium">TikTok</span>
							{#if hasTiktokErrors}
								<svg class="ml-auto h-4 w-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
							{/if}
						</div>
						<span class="text-xs" style="color: var(--color-text-muted);">{tiktokCount} {tiktokCount === 1 ? 'recipient' : 'recipients'}</span>
					</button>
				{/if}
			</div>
		</div>
	</div>

	<!-- Right Column: Editor -->
	<div class="flex-1 flex flex-col min-w-0">
		{#if editingPlatform}
			{@const platform = editingPlatform}
			<!-- Gmail Connection Warning for Email -->
			{#if platform === 'email' && !gmailConnected}
				<div class="px-6 py-3 shrink-0" style="border-bottom: 1px solid var(--color-border); background: #fffbeb;">
					<div class="flex items-center gap-3 text-sm">
						<svg class="h-4 w-4 shrink-0 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
						</svg>
						<div class="flex-1">
							<p class="font-medium text-amber-800">Gmail not connected</p>
							<p class="text-xs text-amber-700">Connect Gmail to send emails. You can still draft your message.</p>
						</div>
						<button
							type="button"
							onclick={onConnectGmail}
							class="px-3 py-1.5 text-xs font-medium transition-colors"
							style="background: var(--color-primary); color: white;"
						>
							Connect Gmail
						</button>
					</div>
				</div>
			{/if}
			<!-- Draft with ChatGPT and Customize Footer Buttons -->
			{#if campaignId}
				<div class="px-6 py-3 shrink-0 flex items-center justify-between gap-3" style="border-bottom: 1px solid var(--color-border);">
					<div class="flex items-center gap-2">
						<button
							type="button"
							onclick={onQuickDraft}
							disabled={isDrafting || isQuickDrafting}
							class="px-4 py-2 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center gap-2"
							style="background: var(--color-primary);"
						>
							<img
								src="/images/icon/pink_white_icon.png"
								alt="Penni"
								class="h-4 w-4"
							/>
							<span>{isQuickDrafting ? 'Drafting...' : 'Quick Draft'}</span>
						</button>
					</div>
					<div class="flex items-center gap-2">
						<button
							type="button"
							onclick={onOpenDraftModal}
							disabled={isDrafting || isQuickDrafting}
							class="px-4 py-2 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
							style="color: var(--color-text-secondary); border-bottom: 1px solid var(--color-border);"
							onmouseenter={(e) => {
								e.currentTarget.style.color = 'var(--color-text)';
								e.currentTarget.style.borderColor = 'var(--color-text)';
							}}
							onmouseleave={(e) => {
								e.currentTarget.style.color = 'var(--color-text-secondary)';
								e.currentTarget.style.borderColor = 'var(--color-border)';
							}}
						>
							{isDrafting ? 'Drafting...' : 'Draft with AI'}
						</button>
						<button
							type="button"
							disabled
							class="px-4 py-2 text-sm cursor-not-allowed opacity-40"
							style="color: var(--color-text-muted);"
							title="Not Available"
						>
							Templates
						</button>
						{#if platform === 'email'}
							<button
								type="button"
								onclick={onOpenFooterModal}
								class="px-4 py-2 text-sm transition-colors"
								style="color: var(--color-text-secondary); border-bottom: 1px solid var(--color-border);"
								onmouseenter={(e) => {
									e.currentTarget.style.color = 'var(--color-text)';
									e.currentTarget.style.borderColor = 'var(--color-text)';
								}}
								onmouseleave={(e) => {
									e.currentTarget.style.color = 'var(--color-text-secondary)';
									e.currentTarget.style.borderColor = 'var(--color-border)';
								}}
							>
								Footer
							</button>
						{/if}
					</div>
				</div>
				{#if quickDraftError}
					<div class="px-6 py-2" style="background: #fef2f2; border-bottom: 1px solid #fecaca;">
						<p class="text-sm text-red-700">{quickDraftError}</p>
					</div>
				{/if}
			{/if}
			<div class="flex-1 overflow-hidden flex flex-col">
				{#if navigationValidationErrors[platform].length > 0}
					<div class="px-6 py-3" style="background: #fef2f2; border-bottom: 1px solid #fecaca;">
						<div class="flex items-start gap-2">
							<svg class="w-4 h-4 text-red-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
							</svg>
							<div class="flex-1">
								<p class="text-sm font-medium text-red-800">Placeholders not filled</p>
								<p class="text-xs text-red-700 mt-0.5">
									Please complete:
									<span class="font-mono">
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
			<div class="flex-1 flex items-center justify-center" style="color: var(--color-text-muted);">
				<div class="text-center">
					<p class="text-sm">Select a platform to draft your message</p>
				</div>
			</div>
		{/if}
	</div>
</div>
