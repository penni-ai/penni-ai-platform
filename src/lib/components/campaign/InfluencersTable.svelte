<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import type { InfluencerProfile } from '$lib/types/campaign';
	import { getProfileId, getPlatformLogo, getPlatformColor } from '$lib/utils/campaign';

	interface Props {
		profiles: InfluencerProfile[];
		selectedIds: Set<string>;
		contactedIds: Set<string>;
		showContacted: boolean;
		status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
		isPreliminary?: boolean; // True if showing preliminary candidates (before LLM analysis)
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
		isPreliminary = false,
		previousProfileIds,
		onToggleSelection,
		onToggleContacted
	}: Props = $props();

	// Filter profiles based on contacted status and exclude profiles with N/A display_name
	const allFilteredProfiles = $derived(() => {
		return profiles.filter(profile => {
			// In preliminary mode, be more lenient - only exclude truly invalid profiles
			// In final mode, exclude profiles with missing or empty display_name
			const displayName = profile.display_name;
			if (!isPreliminary) {
				// Strict filtering for final profiles
				if (!displayName || typeof displayName !== 'string' || displayName.trim() === '' || displayName === 'N/A') {
					return false;
				}
			} else {
				// Lenient filtering for preliminary - only exclude if completely missing
				// Allow "Loading..." and other placeholder values
				if (!displayName || (typeof displayName === 'string' && displayName.trim() === '')) {
					return false;
				}
			}
			
			const profileId = profile._id || getProfileId(profile);
			const isContacted = contactedIds.has(profileId);
			return showContacted ? isContacted : !isContacted;
		});
	});

	// For preliminary mode: randomly select 5-10 profiles and rotate them
	let displayedPreviewProfiles = $state<InfluencerProfile[]>([]);
	let rotationInterval: ReturnType<typeof setInterval> | null = null;
	let blurSeed = $state(0); // Seed to regenerate blurred text on rotation
	const PREVIEW_PROFILE_COUNT = 10; // Always show 10 profiles in preview
	const ROTATION_INTERVAL_MS = 3500; // Rotate every 3.5 seconds

	// Shuffle array using Fisher-Yates algorithm
	function shuffleArray<T>(array: T[]): T[] {
		const shuffled = [...array];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}
		return shuffled;
	}

	// Select random subset of profiles for preview
	// Always returns exactly PREVIEW_PROFILE_COUNT profiles by duplicating if needed
	function selectPreviewProfiles(allProfiles: InfluencerProfile[]): InfluencerProfile[] {
		if (allProfiles.length === 0) return [];
		
		const shuffled = shuffleArray(allProfiles);
		
		// If we have fewer than PREVIEW_PROFILE_COUNT, duplicate profiles to fill all 10 rows
		if (shuffled.length < PREVIEW_PROFILE_COUNT) {
			const result = [...shuffled];
			// Fill remaining slots by cycling through available profiles
			while (result.length < PREVIEW_PROFILE_COUNT) {
				const index = (result.length - shuffled.length) % shuffled.length;
				result.push({ ...shuffled[index] });
			}
			return result;
		}
		
		// If we have enough, select exactly PREVIEW_PROFILE_COUNT
		return shuffled.slice(0, PREVIEW_PROFILE_COUNT);
	}

	// Rotate preview profiles
	function rotatePreviewProfiles() {
		const filtered = allFilteredProfiles();
		if (filtered.length === 0) {
			displayedPreviewProfiles = [];
			return;
		}
		
		// Always select exactly PREVIEW_PROFILE_COUNT profiles (or all if fewer available)
		displayedPreviewProfiles = selectPreviewProfiles(filtered);
		// Update blur seed to regenerate blurred text
		blurSeed = Date.now();
	}

	// Determine which profiles to display
	const filteredProfiles = $derived(() => {
		if (isPreliminary) {
			return displayedPreviewProfiles;
		}
		return allFilteredProfiles();
	});

	// Set up rotation for preliminary mode
	$effect(() => {
		if (isPreliminary && allFilteredProfiles().length > 0) {
			// Initial selection
			rotatePreviewProfiles();
			
			// Set up rotation interval
			if (rotationInterval) {
				clearInterval(rotationInterval);
			}
			
			rotationInterval = setInterval(() => {
				rotatePreviewProfiles();
			}, ROTATION_INTERVAL_MS);
			
			return () => {
				if (rotationInterval) {
					clearInterval(rotationInterval);
					rotationInterval = null;
				}
			};
		} else {
			// Clear rotation when not in preliminary mode
			if (rotationInterval) {
				clearInterval(rotationInterval);
				rotationInterval = null;
			}
			displayedPreviewProfiles = [];
		}
	});

	function isInfluencerSelected(profileId: string): boolean {
		return selectedIds.has(profileId);
	}

	// Realistic bio snippets that look like actual influencer bios
	const bioSnippets = [
		"Food lover | Coffee enthusiast | Sharing my favorite spots",
		"Content creator | Lifestyle blogger | Always exploring",
		"Foodie at heart | Travel enthusiast | Documenting life",
		"Local food explorer | Coffee addict | Living my best life",
		"Food blogger | Recipe creator | Sharing daily adventures",
		"Lifestyle content creator | Food enthusiast | Bay Area local",
		"Food photographer | Coffee lover | Exploring new places",
		"Content creator | Foodie | Always on the hunt for good eats",
		"Food blogger | Travel lover | Sharing my journey",
		"Local foodie | Coffee enthusiast | Bay Area explorer",
		"Food content creator | Recipe developer | Lifestyle blogger",
		"Food lover | Travel enthusiast | Documenting adventures",
		"Coffee enthusiast | Food blogger | Local explorer",
		"Food photographer | Content creator | Sharing favorites",
		"Lifestyle blogger | Foodie | Always discovering",
		"Food content creator | Coffee lover | Bay Area local",
		"Food blogger | Travel enthusiast | Living life",
		"Local food explorer | Content creator | Sharing finds",
		"Foodie | Coffee addict | Lifestyle content creator",
		"Food blogger | Recipe creator | Exploring the city"
	];

	// Realistic follower count formats
	const followerCounts = [
		"12,450", "23,800", "45,200", "67,300", "89,100",
		"15.2K", "28.5K", "42.8K", "56.3K", "71.9K",
		"18K", "35K", "52K", "78K", "94K",
		"11,200", "26,700", "48,900", "63,400", "87,600",
		"14.7K", "31.4K", "49.1K", "65.8K", "82.3K",
		"16K", "33K", "51K", "74K", "91K",
		"13,600", "29,300", "47,500", "69,800", "85,200",
		"17.5K", "34.2K", "53.6K", "72.9K", "88.4K"
	];

	// Simple seeded random function
	function seededRandom(seed: number): number {
		return ((seed * 9301 + 49297) % 233280) / 233280;
	}

	// Get blurred bio - uses profile ID + blurSeed to select from realistic bios
	function getBlurredBio(profileId: string): string {
		const profileHash = profileId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
		const seed = blurSeed + profileHash;
		const index = Math.floor(seededRandom(seed) * bioSnippets.length);
		return bioSnippets[index];
	}

	// Get blurred followers - uses profile ID + blurSeed to select from realistic counts
	function getBlurredFollowers(profileId: string): string {
		const profileHash = profileId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
		const seed = blurSeed + profileHash;
		const index = Math.floor(seededRandom(seed) * followerCounts.length);
		return followerCounts[index];
	}

	// Emoji pool for random selection
	const emojis = ['✨', '🌟', '💫', '⭐', '🔥', '💯', '🎯', '🚀', '💪', '🎨', '🌈', '🌸', '🌺', '🌻', '🌷', '🌿', '🍀', '🌊', '☀️', '🌙', '⭐', '💎', '🎭', '🎪', '🎬', '📸', '📷', '🎥', '🎤', '🎧', '🎮', '🎯', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🎗️', '🎟️'];

	// Format bio to 1-3 lines with random emoji
	function formatBio(bio: string): string {
		if (!bio || bio === '—') return '—';
		
		// Split by common delimiters and filter empty lines
		const lines = bio
			.split(/[\.\n\|]/)
			.map(line => line.trim())
			.filter(line => line.length > 0)
			.slice(0, 3); // Take first 3 meaningful lines
		
		if (lines.length === 0) return '—';
		
		// Select a random emoji based on bio content (deterministic per bio)
		const bioHash = bio.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
		const emojiIndex = bioHash % emojis.length;
		const emoji = emojis[emojiIndex];
		
		// Join lines and add emoji at the start
		return `${emoji} ${lines.join(' • ')}`;
	}
</script>

<div class="rounded-2xl border border-gray-200 bg-white shadow-sm">
	<div class="border-b border-gray-200 px-6 py-4">
		<div class="flex items-center justify-between">
			<h3 class="text-lg font-semibold text-gray-900">
				Influencers
				{#if filteredProfiles().length > 0}
					<span class="text-base font-normal text-gray-500">
						{#if isPreliminary}
							({filteredProfiles().length} preview of {allFilteredProfiles().length})
						{:else}
							({filteredProfiles().length} of {profiles.length})
						{/if}
					</span>
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
		<div class={isPreliminary ? "overflow-hidden" : "overflow-x-auto"}>
			{#if isPreliminary}
				<div class="px-6 py-2 bg-blue-50 border-b border-blue-100">
					<p class="text-xs text-blue-700">
						<span class="inline-flex items-center gap-1">
							<svg class="h-3 w-3 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
								<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
							</svg>
							Analyzing profiles
						</span>
					</p>
				</div>
			{/if}
			<div class={isPreliminary ? "max-h-[600px] overflow-hidden" : ""}>
			<table class="w-full table-fixed">
				<thead class="border-b border-gray-200 bg-gray-50">
					<tr>
						<th class="w-[200px] px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
						<th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Bio</th>
						<th class="w-[120px] px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Followers</th>
						<th class="w-[120px] px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Fit Score</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-200 bg-white">
					{#each filteredProfiles() as profile (() => {
						const id = profile?._id || getProfileId(profile);
						return id || `profile-${Math.random()}`;
					})}
						{@const profileId = profile?._id || getProfileId(profile) || `profile-${Math.random()}`}
						{@const isNewProfile = !previousProfileIds.has(profileId)}
						{@const isSelected = isInfluencerSelected(profileId)}
						{@const isContacted = contactedIds.has(profileId)}
						{@const isSelectable = (status === 'completed' || status === 'running' || status === 'pending') && !isContacted}
						{@const hasRealBio = profile.biography || profile.bio}
						{@const hasRealFollowers = profile.followers !== undefined && profile.followers !== null}
						{@const hasFitScore = profile.fit_score !== undefined && profile.fit_score !== null}
						{@const isAnalyzed = hasFitScore}
						{@const shouldBlurBio = isPreliminary && !hasRealBio && !isAnalyzed}
						{@const shouldBlurFollowers = isPreliminary && !hasRealFollowers && !isAnalyzed}
						<tr 
							class="transition-all duration-300 {
								isContacted ? 'bg-green-50 hover:bg-green-100 cursor-not-allowed opacity-75' :
								isSelected ? 'bg-[#FFF1ED] hover:bg-[#FFE5DC] cursor-pointer' : 
								isSelectable ? 'hover:bg-gray-50 cursor-pointer' : 
								'hover:bg-gray-50'
							}"
							onclick={() => {
								if (isSelectable && !isPreliminary) {
									onToggleSelection(profileId);
								}
							}}
							in:fly={{ y: isPreliminary ? -10 : -20, duration: isPreliminary ? 300 : 400, opacity: 0 }}
							out:fade={{ duration: isPreliminary ? 250 : 0 }}
						>
							<td class="w-[200px] whitespace-nowrap px-6 py-4">
								<div class="flex items-center gap-3 min-w-0">
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
									<div class="min-w-0 flex-1">
										{#if profile.profile_url}
											<a 
												href={profile.profile_url} 
												target="_blank" 
												rel="noopener noreferrer" 
												class="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline truncate block"
												onclick={(e) => e.stopPropagation()}
											>
												{profile.display_name ?? 'N/A'}
											</a>
										{:else}
											<div class="text-sm font-medium text-gray-900 truncate">
												{profile.display_name ?? 'N/A'}
											</div>
										{/if}
									</div>
								</div>
							</td>
							<td class="px-6 py-4 text-sm text-gray-500 overflow-hidden">
								{#if shouldBlurBio}
									<div class="line-clamp-3 text-gray-400 select-none blur-[3px] break-words">
										{getBlurredBio(profileId)}
									</div>
								{:else}
									<div class="line-clamp-3 break-words">{formatBio(profile.biography ?? profile.bio ?? '—')}</div>
								{/if}
							</td>
							<td class="w-[120px] whitespace-nowrap px-6 py-4 text-sm text-gray-500">
								{#if shouldBlurFollowers}
									<span class="text-gray-400 select-none blur-[3px]">
										{getBlurredFollowers(profileId)}
									</span>
								{:else}
									{profile.followers ? profile.followers.toLocaleString() : 'N/A'}
								{/if}
							</td>
							<td class="w-[120px] whitespace-nowrap px-6 py-4">
								{#if isPreliminary && !hasFitScore}
									<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">
										Analyzing...
									</span>
								{:else if hasFitScore}
									<div class="relative group inline-block">
										<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium cursor-help {
											profile.fit_score >= 80 ? 'bg-green-100 text-green-800' :
											profile.fit_score >= 60 ? 'bg-yellow-100 text-yellow-800' :
											'bg-red-100 text-red-800'
										}">
											{profile.fit_score}/100
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

