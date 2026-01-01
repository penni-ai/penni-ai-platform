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
		isPreliminary?: boolean;
		previousProfileIds: Set<string>;
		isSearching?: boolean;
		onToggleSelection: (id: string) => void;
		onToggleContacted: () => void;
		onFindMore?: (excludeProfileUrls: string[]) => void;
	}

	let {
		profiles,
		selectedIds,
		contactedIds,
		showContacted,
		status,
		isPreliminary = false,
		previousProfileIds,
		isSearching = false,
		onToggleSelection,
		onToggleContacted,
		onFindMore
	}: Props = $props();

	// Filter profiles based on contacted status
	const allFilteredProfiles = $derived(() => {
		return profiles.filter(profile => {
			const displayName = profile.display_name;
			if (!isPreliminary) {
				if (!displayName || typeof displayName !== 'string' || displayName.trim() === '' || displayName === 'N/A') {
					return false;
				}
			} else {
				if (!displayName || (typeof displayName === 'string' && displayName.trim() === '')) {
					return false;
				}
			}

			const profileId = profile._id || getProfileId(profile);
			const isContacted = contactedIds.has(profileId);
			return showContacted ? isContacted : !isContacted;
		});
	});

	// For preliminary mode: randomly select profiles and rotate them
	let displayedPreviewProfiles = $state<InfluencerProfile[]>([]);
	let rotationInterval: ReturnType<typeof setInterval> | null = null;
	let blurSeed = $state(0);
	const PREVIEW_PROFILE_COUNT = 10;
	const ROTATION_INTERVAL_MS = 3500;

	function shuffleArray<T>(array: T[]): T[] {
		const shuffled = [...array];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}
		return shuffled;
	}

	function selectPreviewProfiles(allProfiles: InfluencerProfile[]): InfluencerProfile[] {
		if (allProfiles.length === 0) return [];

		const shuffled = shuffleArray(allProfiles);

		if (shuffled.length < PREVIEW_PROFILE_COUNT) {
			const result = [...shuffled];
			while (result.length < PREVIEW_PROFILE_COUNT) {
				const index = (result.length - shuffled.length) % shuffled.length;
				result.push({ ...shuffled[index] });
			}
			return result;
		}

		return shuffled.slice(0, PREVIEW_PROFILE_COUNT);
	}

	function rotatePreviewProfiles() {
		const filtered = allFilteredProfiles();
		if (filtered.length === 0) {
			displayedPreviewProfiles = [];
			return;
		}

		displayedPreviewProfiles = selectPreviewProfiles(filtered);
		blurSeed = Date.now();
	}

	const filteredProfiles = $derived(() => {
		if (isPreliminary) {
			return displayedPreviewProfiles;
		}
		return allFilteredProfiles();
	});

	// Set up rotation for preliminary mode
	$effect(() => {
		if (isPreliminary && allFilteredProfiles().length > 0) {
			rotatePreviewProfiles();

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
		"Local foodie | Coffee enthusiast | Bay Area explorer"
	];

	const followerCounts = [
		"12,450", "23,800", "45,200", "67,300", "89,100",
		"15.2K", "28.5K", "42.8K", "56.3K", "71.9K",
		"18K", "35K", "52K", "78K", "94K"
	];

	function seededRandom(seed: number): number {
		return ((seed * 9301 + 49297) % 233280) / 233280;
	}

	function getBlurredBio(profileId: string): string {
		const profileHash = profileId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
		const seed = blurSeed + profileHash;
		const index = Math.floor(seededRandom(seed) * bioSnippets.length);
		return bioSnippets[index];
	}

	function getBlurredFollowers(profileId: string): string {
		const profileHash = profileId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
		const seed = blurSeed + profileHash;
		const index = Math.floor(seededRandom(seed) * followerCounts.length);
		return followerCounts[index];
	}

	// CSV Export
	function escapeCSV(value: string | number | null | undefined): string {
		if (value === null || value === undefined) return '';
		const str = String(value);
		if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
			return `"${str.replace(/"/g, '""')}"`;
		}
		return str;
	}

	function exportToCSV() {
		const profilesToExport = profiles.filter(profile => {
			const displayName = profile.display_name;
			if (!displayName || typeof displayName !== 'string' || displayName.trim() === '' || displayName === 'N/A') {
				return false;
			}
			return true;
		});

		if (profilesToExport.length === 0) {
			alert('No profiles to export');
			return;
		}

		const headers = ['Name', 'Bio', 'Followers', 'Profile URL', 'Fit Score', 'Fit Score Rationale'];

		const rows = profilesToExport.map(profile => {
			const name = profile.display_name ?? '';
			const bio = (profile.biography ?? profile.bio ?? '').replace(/\n/g, ' ').replace(/\r/g, '');
			const followers = profile.followers ?? '';
			const profileUrl = profile.profile_url ?? '';
			const fitScore = profile.fit_score ?? '';
			const fitRationale = (profile.fit_rationale ?? '').replace(/\n/g, ' ').replace(/\r/g, '');

			return [name, bio, followers, profileUrl, fitScore, fitRationale]
				.map(escapeCSV)
				.join(',');
		});

		const csvContent = [headers.join(','), ...rows].join('\n');

		const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.setAttribute('href', url);
		link.setAttribute('download', `influencers-export-${new Date().toISOString().split('T')[0]}.csv`);
		link.style.visibility = 'hidden';
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	}

	// Select All functionality
	const allSelectableProfiles = $derived(() => {
		return filteredProfiles().filter(profile => {
			const profileId = profile._id || getProfileId(profile);
			const isContacted = contactedIds.has(profileId);
			const isSelectable = (status === 'completed' || status === 'running' || status === 'pending') && !isContacted;
			return isSelectable && !isPreliminary;
		});
	});

	const allSelected = $derived(() => {
		const selectable = allSelectableProfiles();
		if (selectable.length === 0) return false;
		return selectable.every(profile => {
			const profileId = profile._id || getProfileId(profile);
			return selectedIds.has(profileId);
		});
	});

	const someSelected = $derived(() => {
		const selectable = allSelectableProfiles();
		if (selectable.length === 0) return false;
		return selectable.some(profile => {
			const profileId = profile._id || getProfileId(profile);
			return selectedIds.has(profileId);
		}) && !allSelected();
	});

	function handleSelectAll() {
		const selectable = allSelectableProfiles();
		if (allSelected()) {
			selectable.forEach(profile => {
				const profileId = profile._id || getProfileId(profile);
				if (selectedIds.has(profileId)) {
					onToggleSelection(profileId);
				}
			});
		} else {
			selectable.forEach(profile => {
				const profileId = profile._id || getProfileId(profile);
				if (!selectedIds.has(profileId)) {
					onToggleSelection(profileId);
				}
			});
		}
	}

	// Format follower count with proper formatting
	function formatFollowers(count: number | undefined | null): string {
		if (!count) return '--';
		if (count >= 1000000) {
			return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
		}
		if (count >= 1000) {
			return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
		}
		return count.toLocaleString();
	}
</script>

<div class="influencers-gallery">
	<!-- Editorial Header -->
	<header class="gallery-header">
		<div class="header-left">
			<span class="header-label">Curated Selection</span>
			<h2 class="header-title">
				Your Creators
				{#if filteredProfiles().length > 0}
					<span class="header-count">
						{#if isPreliminary}
							{filteredProfiles().length} of {allFilteredProfiles().length}
						{:else}
							{filteredProfiles().length}
						{/if}
					</span>
				{/if}
			</h2>
		</div>

		<div class="header-actions">
			{#if onFindMore && !isPreliminary && profiles.length > 0}
				<button
					type="button"
					onclick={() => {
						const existingUrls = profiles
							.map(p => p.profile_url)
							.filter((url): url is string => !!url);
						onFindMore(existingUrls);
					}}
					disabled={isSearching}
					class="action-btn action-btn-discover"
				>
					<svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="11" cy="11" r="8"/>
						<path d="M21 21l-4.35-4.35"/>
						<path d="M11 8v6M8 11h6"/>
					</svg>
					<span>{isSearching ? 'Discovering...' : 'Discover More'}</span>
				</button>
			{/if}
			{#if !isPreliminary && profiles.length > 0}
				<button
					type="button"
					onclick={exportToCSV}
					class="action-btn action-btn-export"
					title="Export to CSV"
				>
					<svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
						<polyline points="7 10 12 15 17 10"/>
						<line x1="12" y1="15" x2="12" y2="3"/>
					</svg>
					<span>Export</span>
				</button>
			{/if}
			{#if profiles.length > 0}
				<button
					type="button"
					onclick={onToggleContacted}
					class="action-btn action-btn-filter {showContacted ? 'active' : ''}"
				>
					<svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
						<polyline points="22 4 12 14.01 9 11.01"/>
					</svg>
					<span>Contacted</span>
				</button>
			{/if}
		</div>
	</header>

	{#if filteredProfiles().length > 0}
		<!-- Preliminary Banner -->
		{#if isPreliminary}
			<div class="analysis-banner">
				<div class="analysis-pulse"></div>
				<span class="analysis-text">Analyzing creator profiles...</span>
			</div>
		{/if}

		<!-- Profile Cards -->
		<div class="profiles-list {isPreliminary ? 'preliminary-mode' : ''}">
			{#each filteredProfiles() as profile, index (() => {
				const id = profile?._id || getProfileId(profile);
				return id || `profile-${Math.random()}`;
			})}
				{@const profileId = profile?._id || getProfileId(profile) || `profile-${Math.random()}`}
				{@const isSelected = isInfluencerSelected(profileId)}
				{@const isContacted = contactedIds.has(profileId)}
				{@const isSelectable = (status === 'completed' || status === 'running' || status === 'pending') && !isContacted}
				{@const hasRealBio = profile.biography || profile.bio}
				{@const hasRealFollowers = profile.followers !== undefined && profile.followers !== null}
				{@const hasFitScore = profile.fit_score !== undefined && profile.fit_score !== null}
				{@const isAnalyzed = hasFitScore}
				{@const shouldBlurBio = isPreliminary && !hasRealBio && !isAnalyzed}
				{@const shouldBlurFollowers = isPreliminary && !hasRealFollowers && !isAnalyzed}

				<div
					class="profile-card {isContacted ? 'contacted' : ''} {isSelected ? 'selected' : ''} {isSelectable && !isPreliminary ? 'selectable' : ''}"
					role={isSelectable && !isPreliminary ? 'button' : undefined}
					aria-pressed={isSelectable && !isPreliminary ? isSelected : undefined}
					onclick={() => {
						if (isSelectable && !isPreliminary) {
							onToggleSelection(profileId);
						}
					}}
					onkeydown={(event) => {
						if (!isSelectable || isPreliminary) return;
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault();
							onToggleSelection(profileId);
						}
					}}
					in:fly={{ y: isPreliminary ? -8 : -16, duration: isPreliminary ? 280 : 350, delay: index * 30, opacity: 0 }}
					out:fade={{ duration: isPreliminary ? 200 : 0 }}
				>
					<!-- Selection Column -->
					<div class="card-select">
						{#if isSelected}
							<div class="checkbox-editorial checked">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
									<polyline points="20 6 9 17 4 12"/>
								</svg>
							</div>
						{:else if isSelectable && !isPreliminary}
							<div class="checkbox-editorial"></div>
						{/if}
					</div>

					<!-- Creator Info Column -->
					<div class="card-creator">
						<div class="creator-details">
							<div class="creator-name-row">
								{#if profile.profile_url}
									<a
										href={profile.profile_url}
										target="_blank"
										rel="noopener noreferrer"
										class="creator-name"
										onclick={(e) => e.stopPropagation()}
									>
										{profile.display_name ?? 'Unknown'}
									</a>
								{:else}
									<span class="creator-name">{profile.display_name ?? 'Unknown'}</span>
								{/if}
								{#if profile.platform}
									<span class="platform-badge-inline {getPlatformColor(profile.platform)}">
										{@html getPlatformLogo(profile.platform)}
									</span>
								{/if}
							</div>
							{#if profile.username}
								<span class="creator-handle">@{profile.username}</span>
							{/if}
						</div>
					</div>

					<!-- Bio Column -->
					<div class="card-bio">
						{#if shouldBlurBio}
							<p class="bio-text blurred">{getBlurredBio(profileId)}</p>
						{:else}
							<p class="bio-text">{profile.biography ?? profile.bio ?? '--'}</p>
						{/if}
					</div>

					<!-- Followers Column -->
					<div class="card-followers">
						{#if shouldBlurFollowers}
							<span class="followers-number blurred">{getBlurredFollowers(profileId)}</span>
						{:else}
							<span class="followers-number">{formatFollowers(profile.followers)}</span>
						{/if}
						<span class="followers-label">followers</span>
					</div>

					<!-- Fit Score Column -->
					<div class="card-fit">
						{#if isPreliminary && !hasFitScore}
							<div class="fit-analyzing">
								<div class="fit-analyzing-dots">
									<span></span><span></span><span></span>
								</div>
								<span class="fit-analyzing-text">Analyzing</span>
							</div>
						{:else if hasFitScore}
							{@const fitScore = profile.fit_score ?? 0}
							<div class="fit-score-display {fitScore >= 80 ? 'excellent' : fitScore >= 60 ? 'good' : 'fair'}">
								<span class="fit-score-value">{fitScore}</span>
								<span class="fit-score-max">/100</span>
								{#if profile.fit_rationale}
									<div class="fit-tooltip">
										<div class="fit-tooltip-arrow"></div>
										<p class="fit-tooltip-content">{profile.fit_rationale}</p>
									</div>
								{/if}
							</div>
						{:else}
							<span class="fit-empty">--</span>
						{/if}
					</div>

					<!-- Selected Indicator -->
					{#if isSelected}
						<div class="selected-glow"></div>
					{/if}
				</div>
			{/each}
		</div>
	{:else if profiles.length > 0}
		<!-- Empty Filtered State -->
		<div class="empty-state">
			<div class="empty-icon">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
					<circle cx="12" cy="12" r="10"/>
					<path d="M8 15s1.5 2 4 2 4-2 4-2"/>
					<line x1="9" y1="9" x2="9.01" y2="9"/>
					<line x1="15" y1="9" x2="15.01" y2="9"/>
				</svg>
			</div>
			<p class="empty-title">
				{#if showContacted}
					No contacted creators yet
				{:else}
					All creators have been contacted
				{/if}
			</p>
			<p class="empty-subtitle">
				{#if showContacted}
					Creators you reach out to will appear here
				{:else}
					Toggle the filter to view contacted creators
				{/if}
			</p>
		</div>
	{:else}
		<!-- Initial Empty State -->
		<div class="empty-state">
			{#if status === 'running' || status === 'pending'}
				<div class="loading-state">
					<div class="loading-orbit">
						<div class="loading-planet"></div>
						<div class="loading-ring"></div>
					</div>
					<h3 class="loading-title">Finding your creators</h3>
					<p class="loading-subtitle">Curating the perfect matches for your brand</p>
				</div>
			{:else if status === 'completed'}
				<div class="empty-icon">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<circle cx="11" cy="11" r="8"/>
						<path d="M21 21l-4.35-4.35"/>
					</svg>
				</div>
				<p class="empty-title">No creators found</p>
				<p class="empty-subtitle">Try adjusting your search criteria for better results</p>
			{:else}
				<div class="empty-icon">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
						<circle cx="9" cy="7" r="4"/>
						<path d="M23 21v-2a4 4 0 00-3-3.87"/>
						<path d="M16 3.13a4 4 0 010 7.75"/>
					</svg>
				</div>
				<p class="empty-title">Your creators await</p>
				<p class="empty-subtitle">Start a search to discover perfect matches</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* Design System Variables */
	.influencers-gallery {
		--coral: #FF6F61;
		--coral-dark: #e85d50;
		--coral-light: #fff0ee;
		--ink: #1a1a1a;
		--ink-light: #4a4a4a;
		--ink-muted: #8a8a8a;
		--paper: #fafaf9;
		--paper-warm: #f5f4f2;
		--border: #e8e6e3;
		--success: #10b981;
		--success-light: #d1fae5;
		--warning: #f59e0b;
		--warning-light: #fef3c7;

		font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
	}

	/* Gallery Container */
	.influencers-gallery {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	/* Editorial Header */
	.gallery-header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 0;
	}

	.header-left {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.header-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--coral);
		font-weight: 600;
	}

	.header-title {
		font-family: 'Instrument Serif', Georgia, 'Times New Roman', serif;
		font-size: 1.75rem;
		font-weight: 400;
		color: var(--ink);
		line-height: 1.2;
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}

	.header-count {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1rem;
		color: var(--coral);
		font-style: italic;
	}

	/* Header Actions */
	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1.125rem;
		font-size: 0.8rem;
		font-weight: 500;
		letter-spacing: 0.01em;
		border: 1px solid var(--border);
		border-radius: 2rem;
		background: white;
		color: var(--ink-light);
		cursor: pointer;
		transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.action-btn:hover {
		border-color: var(--ink);
		color: var(--ink);
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
	}

	.action-btn:active {
		transform: translateY(0);
	}

	.action-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	.action-icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
	}

	.action-btn-discover {
		background: var(--coral);
		border-color: var(--coral);
		color: white;
	}

	.action-btn-discover:hover:not(:disabled) {
		background: var(--coral-dark);
		border-color: var(--coral-dark);
		color: white;
		box-shadow: 0 4px 16px rgba(255, 111, 97, 0.35);
	}

	.action-btn-filter.active {
		background: var(--success);
		border-color: var(--success);
		color: white;
	}

	.action-btn-filter.active:hover {
		background: #059669;
		border-color: #059669;
		color: white;
	}

	/* Analysis Banner */
	.analysis-banner {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1.25rem;
		background: linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%);
		border-bottom: 1px solid #c7d2fe;
	}

	.analysis-pulse {
		width: 10px;
		height: 10px;
		background: #6366f1;
		border-radius: 50%;
		animation: pulse-ring 1.5s ease-out infinite;
	}

	@keyframes pulse-ring {
		0% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.5); }
		70% { box-shadow: 0 0 0 8px rgba(99, 102, 241, 0); }
		100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
	}

	.analysis-text {
		font-size: 0.8rem;
		font-weight: 500;
		color: #4338ca;
	}

	/* Checkbox Editorial Style */
	.checkbox-editorial {
		width: 22px;
		height: 22px;
		border: 2px solid var(--border);
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
		background: white;
	}

	.checkbox-editorial:hover {
		border-color: var(--coral);
		transform: scale(1.08);
	}

	.checkbox-editorial.checked {
		background: var(--coral);
		border-color: var(--coral);
		animation: checkbox-pop 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
	}

	.checkbox-editorial.checked svg {
		width: 14px;
		height: 14px;
		color: white;
	}

	.checkbox-editorial.partial {
		background: var(--coral);
		border-color: var(--coral);
	}

	.checkbox-dash {
		width: 10px;
		height: 2px;
		background: white;
		border-radius: 1px;
	}

	@keyframes checkbox-pop {
		0% { transform: scale(1); }
		50% { transform: scale(1.2); }
		100% { transform: scale(1); }
	}

	/* Profiles List */
	.profiles-list {
		display: flex;
		flex-direction: column;
	}

	.profiles-list.preliminary-mode {
		max-height: 600px;
		overflow: hidden;
	}

	/* Profile Row - Editorial Style */
	.profile-card {
		display: grid;
		grid-template-columns: 48px 240px 1fr 120px 120px;
		align-items: center;
		padding: 1.5rem 0;
		background: transparent;
		border: none;
		border-radius: 0;
		border-bottom: 1px solid var(--border);
		position: relative;
		transition: background 0.2s ease;
	}

	.profile-card.selectable {
		cursor: pointer;
	}

	.profile-card.selectable:hover {
		background: rgba(255, 111, 97, 0.03);
	}

	.profile-card.selected {
		background: rgba(255, 111, 97, 0.05);
		border-left: 3px solid var(--coral);
		padding-left: calc(1.25rem - 3px);
		margin-left: -1.25rem;
	}

	.profile-card.contacted {
		opacity: 0.6;
	}

	.selected-glow {
		display: none;
	}

	/* Card Select */
	.card-select {
		display: flex;
		justify-content: center;
	}

	/* Creator Column */
	.card-creator {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.platform-badge-inline {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 4px;
		flex-shrink: 0;
	}

	.platform-badge-inline :global(svg) {
		width: 12px;
		height: 12px;
	}

	.creator-details {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.creator-name-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.creator-name {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--ink);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color 0.2s ease;
	}

	a.creator-name:hover {
		color: var(--coral);
	}

	.creator-handle {
		font-size: 0.8rem;
		color: var(--ink-muted);
	}

	/* Bio Column */
	.card-bio {
		padding-right: 2rem;
		min-width: 0;
	}

	.bio-text {
		font-size: 0.85rem;
		color: var(--ink-light);
		line-height: 1.5;
		display: -webkit-box;
		line-clamp: 2;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		margin: 0;
	}

	.bio-text.blurred {
		filter: blur(4px);
		user-select: none;
		color: var(--ink-muted);
	}

	/* Followers Column */
	.card-followers {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.125rem;
	}

	.followers-number {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.5rem;
		font-weight: 400;
		color: var(--ink);
		line-height: 1;
	}

	.followers-number.blurred {
		filter: blur(4px);
		user-select: none;
	}

	.followers-label {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--ink-muted);
	}

	/* Fit Score Column */
	.card-fit {
		display: flex;
		justify-content: center;
	}

	.fit-score-display {
		position: relative;
		display: flex;
		align-items: baseline;
		gap: 2px;
		padding: 0.25rem 0;
		cursor: default;
	}

	.fit-score-value {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.25rem;
		font-weight: 400;
		line-height: 1;
	}

	.fit-score-display.excellent .fit-score-value {
		color: #065f46;
	}

	.fit-score-display.good .fit-score-value {
		color: #92400e;
	}

	.fit-score-display.fair .fit-score-value {
		color: #991b1b;
	}

	.fit-score-max {
		font-size: 0.75rem;
		color: var(--ink-muted);
	}

	.fit-tooltip {
		position: absolute;
		right: 0;
		top: calc(100% + 8px);
		width: 260px;
		padding: 1rem;
		background: var(--ink);
		color: white;
		border-radius: 0.75rem;
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
		opacity: 0;
		visibility: hidden;
		transform: translateY(-4px);
		transition: all 0.2s ease;
		z-index: 50;
	}

	.fit-score-display:hover .fit-tooltip {
		opacity: 1;
		visibility: visible;
		transform: translateY(0);
	}

	.fit-tooltip-arrow {
		position: absolute;
		right: 24px;
		bottom: 100%;
		border: 6px solid transparent;
		border-bottom-color: var(--ink);
	}

	.fit-tooltip-content {
		font-size: 0.8rem;
		line-height: 1.5;
		margin: 0;
	}

	.fit-analyzing {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
	}

	.fit-analyzing-dots {
		display: flex;
		gap: 4px;
	}

	.fit-analyzing-dots span {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--ink-muted);
		animation: dot-bounce 1.4s infinite ease-in-out;
	}

	.fit-analyzing-dots span:nth-child(1) { animation-delay: 0s; }
	.fit-analyzing-dots span:nth-child(2) { animation-delay: 0.16s; }
	.fit-analyzing-dots span:nth-child(3) { animation-delay: 0.32s; }

	@keyframes dot-bounce {
		0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
		40% { transform: scale(1.2); opacity: 1; }
	}

	.fit-analyzing-text {
		font-size: 0.7rem;
		color: var(--ink-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.fit-empty {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.25rem;
		color: var(--ink-muted);
	}

	/* Empty States */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		text-align: center;
	}

	.empty-icon {
		width: 64px;
		height: 64px;
		margin-bottom: 1.5rem;
		color: var(--ink-muted);
		opacity: 0.5;
	}

	.empty-icon svg {
		width: 100%;
		height: 100%;
	}

	.empty-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.25rem;
		color: var(--ink);
		margin: 0 0 0.5rem;
	}

	.empty-subtitle {
		font-size: 0.9rem;
		color: var(--ink-muted);
		margin: 0;
	}

	/* Loading State */
	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
	}

	.loading-orbit {
		position: relative;
		width: 64px;
		height: 64px;
	}

	.loading-planet {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 20px;
		height: 20px;
		margin: -10px 0 0 -10px;
		background: var(--coral);
		border-radius: 50%;
		animation: planet-pulse 1.5s ease-in-out infinite;
	}

	.loading-ring {
		position: absolute;
		inset: 0;
		border: 2px solid var(--border);
		border-top-color: var(--coral);
		border-radius: 50%;
		animation: ring-spin 1s linear infinite;
	}

	@keyframes planet-pulse {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(1.1); }
	}

	@keyframes ring-spin {
		to { transform: rotate(360deg); }
	}

	.loading-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.25rem;
		color: var(--ink);
		margin: 0;
	}

	.loading-subtitle {
		font-size: 0.9rem;
		color: var(--ink-muted);
		margin: 0;
	}

	/* Responsive */
	@media (max-width: 1024px) {
		.profile-card {
			grid-template-columns: 40px 180px 1fr 100px 100px;
		}

		.profile-card {
			padding: 1.25rem 0;
		}

		.creator-avatar {
			width: 44px;
			height: 44px;
		}

		.platform-badge {
			width: 20px;
			height: 20px;
		}

		.followers-number {
			font-size: 1.25rem;
		}
	}

	@media (max-width: 768px) {
		.gallery-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 1rem;
		}

		.header-actions {
			width: 100%;
			flex-wrap: wrap;
		}

		.action-btn {
			flex: 1;
			min-width: 120px;
			justify-content: center;
		}

		.profile-card {
			display: flex;
			flex-direction: column;
			gap: 1rem;
			padding: 1.5rem 0;
			border-bottom: 1px solid var(--border);
		}

		.profile-card.selected {
			border-left: none;
			border-top: 2px solid var(--coral);
			padding-left: 0;
			margin-left: 0;
			padding-top: calc(1.5rem - 2px);
		}

		.card-select {
			position: absolute;
			top: 1.5rem;
			right: 0;
		}

		.card-creator {
			width: 100%;
		}

		.card-bio {
			padding-right: 0;
		}

		.card-followers,
		.card-fit {
			align-self: flex-start;
		}

		.card-followers {
			flex-direction: row;
			gap: 0.5rem;
		}

		.followers-label {
			margin-top: 0.25rem;
		}
	}
</style>
