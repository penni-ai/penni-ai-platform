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
	<div class="flex-1 overflow-y-auto px-8 py-6">
		<div class="overflow-x-auto">
			<table class="w-full border-collapse">
				<thead>
					<tr style="border-bottom: 1px solid var(--color-border);">
						<th class="text-left py-3 px-4 text-sm font-semibold" style="color: var(--color-text);">Recipient</th>
						<th class="text-left py-3 px-4 text-sm font-semibold" style="color: var(--color-text);">Contact Methods</th>
						<th class="text-left py-3 px-4 text-sm font-semibold" style="color: var(--color-text);">Message</th>
					</tr>
				</thead>
				<tbody>
					{#each reviewData as recipient}
						<tr style="border-bottom: 1px solid var(--color-border);">
							<td class="py-4 px-4">
								<div>
									<p class="text-sm font-medium" style="color: var(--color-text);">{recipient.influencer.display_name ?? 'N/A'}</p>
									{#if recipient.influencer.platform}
										<p class="text-xs capitalize" style="color: var(--color-text-muted);">{recipient.influencer.platform}</p>
									{/if}
								</div>
							</td>
							<td class="py-4 px-4">
								<div class="flex flex-wrap gap-2">
									{#each recipient.methods as method}
										{#if method === 'email' && recipient.emailAccountId}
											{@const emailAccount = gmailConnections.find(c => c.id === recipient.emailAccountId)}
											<span class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium" style="background: var(--color-bg-elevated); color: var(--color-text-secondary);" title={emailAccount?.email || ''}>
												{@html getMethodIcon(method)}
												{emailAccount ? emailAccount.email : getMethodLabel(method)}
											</span>
										{:else}
											<span class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium {
												method === 'instagram' ? 'bg-[#E4405F]/10 text-[#E4405F]' :
												method === 'tiktok' ? 'bg-black/10 text-black' : ''
											}" style="{method === 'email' ? 'background: var(--color-bg-elevated); color: var(--color-text-secondary);' : ''}">
												{@html getMethodIcon(method)}
												{getMethodLabel(method)}
											</span>
										{/if}
									{/each}
								</div>
							</td>
							<td class="py-4 px-4">
								<div class="space-y-2 max-w-md">
									{#each recipient.methods as method}
										<div class="text-xs">
											<div class="flex items-center justify-between mb-1">
												<p class="font-medium" style="color: var(--color-text-secondary);">{getMethodLabel(method)}:</p>
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
															class="text-xs font-medium flex items-center gap-1"
															style="color: var(--color-primary);"
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
															class="text-xs font-medium flex items-center gap-1"
															style="color: var(--color-primary);"
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
											<div class="line-clamp-3 whitespace-pre-wrap" style="color: var(--color-text-secondary);">{recipient.messages[method] || '(No message)'}</div>
										</div>
									{/each}
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<!-- Right: Send Messages Buttons -->
	<div class="w-[20%] p-6 flex flex-col gap-4" style="border-left: 1px solid var(--color-border);">
		<h3 class="text-sm font-semibold" style="color: var(--color-text);">Send Messages</h3>
		{#if createDraftSuccess}
			<div class="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
				{createDraftSuccess}
			</div>
		{/if}
		{#if createDraftError}
			<div class="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
				{createDraftError}
			</div>
		{/if}
		{#if reviewCounts.email > 0}
			<button
				type="button"
				disabled={isCreatingDrafts}
				onclick={() => onCreateDrafts('email')}
				class="w-full px-4 py-3 text-white font-medium rounded-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
				style="background: var(--color-primary);"
			>
				{isCreatingDrafts ? 'Creating Drafts...' : `Create Gmail Drafts (${reviewCounts.email})`}
			</button>
		{/if}
		{#if reviewCounts.instagram > 0}
			<button
				type="button"
				disabled={isCreatingDrafts}
				onclick={handleSendInstagram}
				class="w-full px-4 py-3 font-medium rounded-none hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
				style="background: var(--color-bg-elevated); border: 2px solid var(--color-border); color: var(--color-text-secondary);"
			>
				Send Instagram Messages ({reviewCounts.instagram})
			</button>
		{/if}
		{#if reviewCounts.tiktok > 0}
			<button
				type="button"
				disabled={isCreatingDrafts}
				onclick={handleSendTikTok}
				class="w-full px-4 py-3 font-medium rounded-none hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
				style="background: var(--color-bg-elevated); border: 2px solid var(--color-border); color: var(--color-text-secondary);"
			>
				Send TikTok Messages ({reviewCounts.tiktok})
			</button>
		{/if}
	</div>
</div>

