<script lang="ts">
	import { fly } from 'svelte/transition';
	import type { InfluencerProfile } from '$lib/types/campaign';
	import { getProfileId, getPlatformLogo, getPlatformColor } from '$lib/utils/campaign';

	interface Props {
		profiles: InfluencerProfile[];
		selectedIds: Set<string>;
		contactedIds: Set<string>;
		showContacted: boolean;
		status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
		previousProfileIds: Set<string>;
		onToggleSelection: (id: string) => void;
		onToggleContacted: () => void;
	}

	let {
		profiles,
		selectedIds,
		contactedIds,
		showContacted,
		status,
		previousProfileIds,
		onToggleSelection,
		onToggleContacted
	}: Props = $props();

	// Filter profiles based on contacted status and exclude profiles with N/A display_name
	const filteredProfiles = $derived(() => {
		return profiles.filter(profile => {
			// Exclude profiles with missing or empty display_name
			const displayName = profile.display_name;
			if (!displayName || typeof displayName !== 'string' || displayName.trim() === '' || displayName === 'N/A') {
				return false;
			}
			
			const profileId = profile._id || getProfileId(profile);
			const isContacted = contactedIds.has(profileId);
			return showContacted ? isContacted : !isContacted;
		});
	});

	function isInfluencerSelected(profileId: string): boolean {
		return selectedIds.has(profileId);
	}
</script>

<div class="rounded-2xl border border-gray-200 bg-white shadow-sm">
	<div class="border-b border-gray-200 px-6 py-4">
		<div class="flex items-center justify-between">
			<h3 class="text-lg font-semibold text-gray-900">
				Influencers
				{#if filteredProfiles().length > 0}
					<span class="text-base font-normal text-gray-500">({filteredProfiles().length} of {profiles.length})</span>
				{/if}
			</h3>
			
			{#if profiles.length > 0}
				<button
					type="button"
					onclick={onToggleContacted}
					class="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors {
						showContacted 
							? 'bg-green-600 text-white hover:bg-green-700' 
							: 'bg-gray-100 text-gray-700 hover:bg-gray-200'
					}"
				>
					Contacted
				</button>
			{/if}
		</div>
	</div>
	
	{#if filteredProfiles().length > 0}
		<div class="overflow-x-auto">
			<table class="w-full">
				<thead class="border-b border-gray-200 bg-gray-50">
					<tr>
						<th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
						<th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Bio</th>
						<th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Followers</th>
						<th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Fit Score</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-200 bg-white">
					{#each filteredProfiles() as profile (profile._id || getProfileId(profile))}
						{@const profileId = profile._id || getProfileId(profile)}
						{@const isNewProfile = !previousProfileIds.has(profileId)}
						{@const isSelected = isInfluencerSelected(profileId)}
						{@const isContacted = contactedIds.has(profileId)}
						{@const isSelectable = (status === 'completed' || status === 'running' || status === 'pending') && !isContacted}
						<tr 
							class="transition-colors {
								isContacted ? 'bg-green-50 hover:bg-green-100 cursor-not-allowed opacity-75' :
								isSelected ? 'bg-[#FFF1ED] hover:bg-[#FFE5DC] cursor-pointer' : 
								isSelectable ? 'hover:bg-gray-50 cursor-pointer' : 
								'hover:bg-gray-50'
							}"
							onclick={() => {
								if (isSelectable) {
									onToggleSelection(profileId);
								}
							}}
							in:fly={{ y: -20, duration: 400, opacity: 0 }}
						>
							<td class="whitespace-nowrap px-6 py-4">
								<div class="flex items-center gap-3">
									<div class="shrink-0 flex flex-col items-center gap-1">
										{#if profile.platform}
											<div class="flex items-center {getPlatformColor(profile.platform)}" title={profile.platform}>
												{@html getPlatformLogo(profile.platform)}
											</div>
										{/if}
										{#if profile.email_address || profile.business_email}
											<a 
												href={`mailto:${profile.email_address || profile.business_email}`}
												class="text-gray-400 hover:text-[#FF6F61] transition-colors"
												title={profile.email_address || profile.business_email}
												onclick={(e) => e.stopPropagation()}
											>
												<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
													<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
												</svg>
											</a>
										{/if}
									</div>
									<div>
										{#if profile.profile_url}
											<a 
												href={profile.profile_url} 
												target="_blank" 
												rel="noopener noreferrer" 
												class="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
												onclick={(e) => e.stopPropagation()}
											>
												{profile.display_name ?? 'N/A'}
											</a>
										{:else}
											<div class="text-sm font-medium text-gray-900">
												{profile.display_name ?? 'N/A'}
											</div>
										{/if}
									</div>
								</div>
							</td>
							<td class="px-6 py-4 text-sm text-gray-500 max-w-md">
								<div class="line-clamp-3">{profile.biography ?? profile.bio ?? '—'}</div>
							</td>
							<td class="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
								{profile.followers ? profile.followers.toLocaleString() : 'N/A'}
							</td>
							<td class="whitespace-nowrap px-6 py-4">
								{#if profile.fit_score !== undefined && profile.fit_score !== null}
									<div class="relative group inline-block">
										<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium cursor-help {
											profile.fit_score >= 8 ? 'bg-green-100 text-green-800' :
											profile.fit_score >= 6 ? 'bg-yellow-100 text-yellow-800' :
											'bg-red-100 text-red-800'
										}">
											{profile.fit_score}/10
										</span>
										{#if profile.fit_rationale}
											<!-- Tooltip -->
											<div class="absolute right-0 bottom-full mb-2 hidden group-hover:block z-50 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg pointer-events-none">
												<div class="whitespace-normal">{profile.fit_rationale}</div>
												<!-- Arrow -->
												<div class="absolute right-4 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
											</div>
										{/if}
									</div>
								{:else}
									<span class="text-sm text-gray-400">—</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else if profiles.length > 0}
		<div class="px-6 py-12 text-center">
			<p class="text-sm text-gray-500">
				{#if showContacted}
					No contacted influencers found.
				{:else}
					No uncontacted influencers found.
				{/if}
			</p>
		</div>
	{:else}
		<div class="px-6 py-12 text-center">
			{#if status === 'running' || status === 'pending'}
				<div class="flex flex-col items-center gap-3">
					<div class="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#FF6F61]"></div>
					<p class="text-sm font-medium text-gray-900">Processing influencers...</p>
					<p class="text-xs text-gray-500">
						Influencers will appear here as they are processed
					</p>
				</div>
			{:else if status === 'completed'}
				<p class="text-sm text-gray-500">No influencers found. Try adjusting your search criteria.</p>
			{:else}
				<p class="text-sm text-gray-500">No influencers available yet.</p>
			{/if}
		</div>
	{/if}
</div>

