<script lang="ts">
	import { slideFade } from './transitions';
	import type { ContactMethod, GmailConnection, ReviewRecipient } from './types';

	interface Props {
		navigationDirection?: 'forward' | 'backward';
		reviewData: ReviewRecipient[];
		reviewCounts: { email: number; instagram: number; tiktok: number };
		gmailConnections: GmailConnection[];
		isCreatingDrafts: boolean;
		createDraftSuccess: string | null;
		createDraftError: string | null;
		campaignId?: string | null;
		getInfluencerKey: (influencer: any) => string;
		getMethodIcon: (method: ContactMethod) => string;
		getMethodLabel: (method: ContactMethod) => string;
		onCreateDrafts: (method: ContactMethod) => void;
		onLoadContactedInfluencers: () => Promise<void>;
		onPreviewEmail: (content: string, recipient: { name?: string; email?: string }) => void;
		onPreviewMessage: (content: string, platform: 'instagram' | 'tiktok', recipient: { name?: string }) => void;
	}

	let {
		reviewData,
		reviewCounts,
		gmailConnections,
		isCreatingDrafts,
		createDraftSuccess,
		createDraftError,
		campaignId,
		getInfluencerKey,
		getMethodIcon,
		getMethodLabel,
		onCreateDrafts,
		onLoadContactedInfluencers,
		onPreviewEmail,
		onPreviewMessage,
		navigationDirection = 'forward'
	}: Props = $props();

	async function handleSendInstagram() {
		const instagramRecipients = reviewData.filter(r => r.methods.includes('instagram'));
		try {
			await fetch('/api/outreach/track', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					platform: 'instagram',
					count: instagramRecipients.length,
					campaignId: campaignId || undefined,
					influencers: instagramRecipients.map(r => ({
						influencerId: r.influencer._id || getInfluencerKey(r.influencer),
						name: r.influencer.display_name,
						profileUrl: r.influencer.profile_url
					}))
				})
			});
		} catch (error) {
			console.error('Failed to track Instagram outreach:', error);
		}
		await onLoadContactedInfluencers();
		const immediateOpens = Math.min(5, instagramRecipients.length);
		for (let i = 0; i < immediateOpens; i++) {
			const url = instagramRecipients[i]?.influencer.profile_url;
			if (url) {
				window.open(url, '_blank');
			}
		}
		for (let i = immediateOpens; i < instagramRecipients.length; i++) {
			const url = instagramRecipients[i]?.influencer.profile_url;
			if (url) {
				const link = document.createElement('a');
				link.href = url;
				link.target = '_blank';
				link.rel = 'noopener noreferrer';
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				if (i < instagramRecipients.length - 1) {
					await new Promise(resolve => setTimeout(resolve, 50));
				}
			}
		}
	}

	async function handleSendTikTok() {
		const tiktokRecipients = reviewData.filter(r => r.methods.includes('tiktok'));
		try {
			await fetch('/api/outreach/track', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					platform: 'tiktok',
					count: tiktokRecipients.length,
					campaignId: campaignId || undefined,
					influencers: tiktokRecipients.map(r => ({
						influencerId: r.influencer._id || getInfluencerKey(r.influencer),
						name: r.influencer.display_name,
						profileUrl: r.influencer.profile_url
					}))
				})
			});
		} catch (error) {
			console.error('Failed to track TikTok outreach:', error);
		}
		await onLoadContactedInfluencers();
		const immediateOpens = Math.min(5, tiktokRecipients.length);
		for (let i = 0; i < immediateOpens; i++) {
			const url = tiktokRecipients[i]?.influencer.profile_url;
			if (url) {
				window.open(url, '_blank');
			}
		}
		for (let i = immediateOpens; i < tiktokRecipients.length; i++) {
			const url = tiktokRecipients[i]?.influencer.profile_url;
			if (url) {
				const link = document.createElement('a');
				link.href = url;
				link.target = '_blank';
				link.rel = 'noopener noreferrer';
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				if (i < tiktokRecipients.length - 1) {
					await new Promise(resolve => setTimeout(resolve, 50));
				}
			}
		}
	}
</script>

<div class="absolute inset-0 h-full flex" transition:slideFade={{ axis: 'x', duration: 300, direction: navigationDirection }}>
	<!-- Left: Recipients Table -->
	<div class="flex-1 overflow-y-auto">
		<table class="w-full">
			<thead class="sticky top-0" style="background: var(--color-bg-elevated);">
				<tr style="border-bottom: 1px solid var(--color-border);">
					<th class="text-left py-3 px-6 text-xs font-medium uppercase tracking-wide" style="color: var(--color-text-muted);">Recipient</th>
					<th class="text-left py-3 px-6 text-xs font-medium uppercase tracking-wide" style="color: var(--color-text-muted);">Method</th>
					<th class="text-left py-3 px-6 text-xs font-medium uppercase tracking-wide" style="color: var(--color-text-muted);">Message</th>
				</tr>
			</thead>
			<tbody>
				{#each reviewData as recipient}
					<tr style="border-bottom: 1px solid var(--color-border);">
						<td class="py-4 px-6">
							<p class="text-sm font-medium" style="color: var(--color-text);">{recipient.influencer.display_name ?? 'N/A'}</p>
							{#if recipient.influencer.platform}
								<p class="text-xs capitalize mt-0.5" style="color: var(--color-text-muted);">{recipient.influencer.platform}</p>
							{/if}
						</td>
						<td class="py-4 px-6">
							<div class="flex flex-wrap gap-1.5">
								{#each recipient.methods as method}
									{#if method === 'email' && recipient.emailAccountId}
										{@const emailAccount = gmailConnections.find(c => c.id === recipient.emailAccountId)}
										<span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs" style="color: var(--color-text-secondary); border-bottom: 1px solid var(--color-border);" title={emailAccount?.email || ''}>
											{@html getMethodIcon(method)}
											{emailAccount ? emailAccount.email : getMethodLabel(method)}
										</span>
									{:else}
										<span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs {
											method === 'instagram' ? 'text-[#E4405F]' :
											method === 'tiktok' ? 'text-black' : ''
										}" style="{method === 'email' ? 'color: var(--color-text-secondary);' : ''} border-bottom: 1px solid {method === 'instagram' ? '#E4405F' : method === 'tiktok' ? '#000' : 'var(--color-border)'};">
											{@html getMethodIcon(method)}
											{getMethodLabel(method)}
										</span>
									{/if}
								{/each}
							</div>
						</td>
						<td class="py-4 px-6">
							<div class="space-y-2 max-w-md">
								{#each recipient.methods as method}
									<div class="text-xs">
										<div class="flex items-center justify-between mb-1">
											<p class="font-medium" style="color: var(--color-text-secondary);">{getMethodLabel(method)}</p>
											{#if recipient.messages[method]}
												{#if method === 'email'}
													<button
														type="button"
														onclick={() => {
															onPreviewEmail(recipient.messages[method], {
																name: recipient.influencer.display_name,
																email: recipient.influencer.email_address || recipient.influencer.business_email
															});
														}}
														class="text-xs font-medium flex items-center gap-1 transition-opacity"
														style="color: var(--color-primary);"
														onmouseenter={(e) => e.currentTarget.style.opacity = '0.7'}
														onmouseleave={(e) => e.currentTarget.style.opacity = '1'}
													>
														<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7Z" />
														</svg>
														Preview
													</button>
												{:else if method === 'instagram' || method === 'tiktok'}
													<button
														type="button"
														onclick={() => {
															onPreviewMessage(recipient.messages[method], method, {
																name: recipient.influencer.display_name
															});
														}}
														class="text-xs font-medium flex items-center gap-1 transition-opacity"
														style="color: var(--color-primary);"
														onmouseenter={(e) => e.currentTarget.style.opacity = '0.7'}
														onmouseleave={(e) => e.currentTarget.style.opacity = '1'}
													>
														<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7Z" />
														</svg>
														Preview
													</button>
												{/if}
											{/if}
										</div>
										<div class="line-clamp-2 whitespace-pre-wrap" style="color: var(--color-text-muted);">{recipient.messages[method] || '(No message)'}</div>
									</div>
								{/each}
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- Right: Send Messages Buttons -->
	<div class="w-64 p-6 flex flex-col gap-4 shrink-0" style="border-left: 1px solid var(--color-border);">
		<h3 class="text-xs font-medium uppercase tracking-wide" style="color: var(--color-text-muted);">Send Messages</h3>

		{#if createDraftSuccess}
			<div class="p-3 text-sm" style="background: #f0fdf4; border-bottom: 2px solid #22c55e; color: #166534;">
				{createDraftSuccess}
			</div>
		{/if}
		{#if createDraftError}
			<div class="p-3 text-sm" style="background: #fef2f2; border-bottom: 2px solid #ef4444; color: #991b1b;">
				{createDraftError}
			</div>
		{/if}

		{#if reviewCounts.email > 0}
			<button
				type="button"
				disabled={isCreatingDrafts}
				onclick={() => onCreateDrafts('email')}
				class="w-full px-4 py-3 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
				style="background: var(--color-primary);"
				onmouseenter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.opacity = '0.9'; }}
				onmouseleave={(e) => e.currentTarget.style.opacity = '1'}
			>
				{isCreatingDrafts ? 'Creating...' : `Create Gmail Drafts (${reviewCounts.email})`}
			</button>
		{/if}

		{#if reviewCounts.instagram > 0}
			<button
				type="button"
				disabled={isCreatingDrafts}
				onclick={handleSendInstagram}
				class="w-full px-4 py-3 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
				style="color: var(--color-text); border: 1px solid var(--color-border);"
				onmouseenter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.borderColor = 'var(--color-text)'; }}
				onmouseleave={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}
			>
				Open Instagram ({reviewCounts.instagram})
			</button>
		{/if}

		{#if reviewCounts.tiktok > 0}
			<button
				type="button"
				disabled={isCreatingDrafts}
				onclick={handleSendTikTok}
				class="w-full px-4 py-3 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
				style="color: var(--color-text); border: 1px solid var(--color-border);"
				onmouseenter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.borderColor = 'var(--color-text)'; }}
				onmouseleave={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}
			>
				Open TikTok ({reviewCounts.tiktok})
			</button>
		{/if}

		<div class="mt-auto pt-4" style="border-top: 1px solid var(--color-border);">
			<p class="text-xs" style="color: var(--color-text-muted);">
				Gmail drafts will be created in your inbox. Instagram and TikTok will open profiles in new tabs.
			</p>
		</div>
	</div>
</div>
