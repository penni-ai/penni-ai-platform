<script lang="ts">
	import { slideFade } from './transitions';
	import type { ContactMethod, Influencer, GmailConnection } from './types';
	
	interface Props {
		navigationDirection?: 'forward' | 'backward';
		influencers: Influencer[];
		gmailConnections: GmailConnection[];
		selectedMethods: Map<string, Set<ContactMethod>>;
		selectedEmailAccounts: Map<string, string>;
		availableMethodCounts: { email: number; instagram: number; tiktok: number };
		getInfluencerKey: (influencer: Influencer) => string;
		getSelectedMethods: (influencerKey: string) => Set<ContactMethod>;
		isMethodSelected: (influencerKey: string, method: ContactMethod) => boolean;
		getSelectedEmailAccount: (influencerKey: string) => string | null;
		hasEmail: (influencer: Influencer) => boolean;
		areAllSelectedForMethod: (method: ContactMethod) => boolean;
		getMethodIcon: (method: ContactMethod) => string;
		getPlatformLogo: (platform: string | null | undefined) => string;
		getPlatformColor: (platform: string | null | undefined) => string;
		onToggleMethod: (influencerKey: string, method: ContactMethod) => void;
		onSetEmailAccount: (influencerKey: string, connectionId: string) => void;
		onEvenlyAssignEmailAccounts: () => void;
		onSelectAllForMethod: (method: ContactMethod) => void;
	}
	
	let {
		influencers,
		gmailConnections,
		selectedMethods,
		selectedEmailAccounts,
		availableMethodCounts,
		getInfluencerKey,
		getSelectedMethods,
		isMethodSelected,
		getSelectedEmailAccount,
		hasEmail,
		areAllSelectedForMethod,
		getMethodIcon,
		getPlatformLogo,
		getPlatformColor,
		onToggleMethod,
		onSetEmailAccount,
		onEvenlyAssignEmailAccounts,
		onSelectAllForMethod,
		navigationDirection = 'forward'
	}: Props = $props();
</script>

<div class="absolute inset-0 h-full flex flex-col" transition:slideFade={{ axis: 'x', duration: 300, direction: navigationDirection }}>
	<div class="flex-1 overflow-y-auto px-8 py-6">
		<!-- Quick Selection Buttons -->
		<div class="flex flex-wrap gap-2 mb-4">
			{#if availableMethodCounts.email > 0 && gmailConnections.length > 0}
				<button
					type="button"
					onclick={onEvenlyAssignEmailAccounts}
					class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-blue-100 text-blue-700 hover:bg-blue-200"
				>
					{@html getMethodIcon('email')}
					<span>Evenly Assign Email</span>
				</button>
			{/if}
			{#if availableMethodCounts.instagram > 0}
				{@const allInstagramSelected = areAllSelectedForMethod('instagram')}
				<button
					type="button"
					onclick={() => onSelectAllForMethod('instagram')}
					class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors {
						allInstagramSelected
							? 'bg-[#E4405F] text-white hover:bg-[#D32A4F]'
							: 'bg-gray-100 text-gray-700 hover:bg-gray-200'
					}"
				>
					{@html getMethodIcon('instagram')}
					<span>{allInstagramSelected ? 'Deselect All Instagram' : 'Select All Instagram'} ({availableMethodCounts.instagram})</span>
				</button>
			{/if}
			{#if availableMethodCounts.tiktok > 0}
				{@const allTikTokSelected = areAllSelectedForMethod('tiktok')}
				<button
					type="button"
					onclick={() => onSelectAllForMethod('tiktok')}
					class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors {
						allTikTokSelected
							? 'bg-black text-white hover:bg-gray-900'
							: 'bg-gray-100 text-gray-700 hover:bg-gray-200'
					}"
				>
					{@html getMethodIcon('tiktok')}
					<span>{allTikTokSelected ? 'Deselect All TikTok' : 'Select All TikTok'} ({availableMethodCounts.tiktok})</span>
				</button>
			{/if}
		</div>
		
		<div class="grid grid-cols-2 gap-4">
			{#each influencers as influencer (getInfluencerKey(influencer))}
				{@const key = getInfluencerKey(influencer)}
				{@const selected = getSelectedMethods(key)}
				{@const hasEmailAddr = hasEmail(influencer)}
				{@const platform = influencer.platform?.toLowerCase()}
				<div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">
					<div class="flex items-center gap-4 flex-1 min-w-0">
						<div class="shrink-0 flex flex-col items-center gap-1">
							{#if influencer.platform}
								<div class="flex items-center {getPlatformColor(influencer.platform)}">
									{@html getPlatformLogo(influencer.platform)}
								</div>
							{/if}
							{#if hasEmailAddr}
								<svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
									<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
								</svg>
							{/if}
						</div>
						<div class="flex-1 min-w-0">
							<p class="text-sm font-medium text-gray-900 truncate">{influencer.display_name ?? 'N/A'}</p>
							{#if influencer.biography || influencer.bio}
								<p class="text-xs text-gray-500 line-clamp-2 mt-1">{influencer.biography || influencer.bio}</p>
							{/if}
						</div>
					</div>
					<div class="grid grid-cols-2 gap-2 shrink-0 ml-4 w-full max-w-[200px]">
						{#if hasEmailAddr && gmailConnections.length > 0}
							{#each gmailConnections as connection}
								{@const isSelected = getSelectedEmailAccount(key) === connection.id}
								<button
									type="button"
									onclick={() => {
										if (isSelected) {
											onToggleMethod(key, 'email');
										} else {
											onSetEmailAccount(key, connection.id);
										}
									}}
									class="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors {
										isSelected
											? 'bg-[#FF6F61] text-white'
											: 'bg-gray-100 text-gray-700 hover:bg-gray-200'
									}"
									title={connection.email}
								>
									{@html getMethodIcon('email')}
									<span class="truncate">{connection.email}</span>
								</button>
							{/each}
						{:else if hasEmailAddr}
							<button
								type="button"
								onclick={() => onToggleMethod(key, 'email')}
								class="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors {
									isMethodSelected(key, 'email')
										? 'bg-[#FF6F61] text-white'
										: 'bg-gray-100 text-gray-700 hover:bg-gray-200'
								}"
							>
								{@html getMethodIcon('email')}
								<span>Email</span>
							</button>
						{/if}
						{#if platform === 'instagram'}
							<button
								type="button"
								onclick={() => onToggleMethod(key, 'instagram')}
								class="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors {
									isMethodSelected(key, 'instagram')
										? 'bg-[#E4405F] text-white'
										: 'bg-gray-100 text-gray-700 hover:bg-gray-200'
								}"
							>
								{@html getMethodIcon('instagram')}
								<span>Instagram</span>
							</button>
						{/if}
						{#if platform === 'tiktok'}
							<button
								type="button"
								onclick={() => onToggleMethod(key, 'tiktok')}
								class="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors {
									isMethodSelected(key, 'tiktok')
										? 'bg-black text-white'
										: 'bg-gray-100 text-gray-700 hover:bg-gray-200'
								}"
							>
								{@html getMethodIcon('tiktok')}
								<span>TikTok</span>
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>

