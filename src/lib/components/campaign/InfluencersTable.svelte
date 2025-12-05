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
</script>

<div class="influencers-table-wrapper">
	<!-- Header -->
	<div class="table-header">
		<h3 class="table-title">
			Campaign Influencers
			{#if filteredProfiles().length > 0}
				<span class="table-count">
					{#if isPreliminary}
						({filteredProfiles().length} preview of {allFilteredProfiles().length})
					{:else}
						({filteredProfiles().length} of {profiles.length})
					{/if}
				</span>
			{/if}
		</h3>

		<div class="table-actions">
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
					class="action-btn find-more"
				>
					<svg class="btn-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
					</svg>
					{isSearching ? 'Searching...' : 'Find More'}
				</button>
			{/if}
			{#if !isPreliminary && profiles.length > 0}
				<button
					type="button"
					onclick={exportToCSV}
					class="action-btn export"
					title="Export influencers to CSV"
				>
					<svg class="btn-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
					</svg>
					Export CSV
				</button>
			{/if}
			{#if profiles.length > 0}
				<button
					type="button"
					onclick={onToggleContacted}
					class="action-btn toggle-contacted {showContacted ? 'active' : ''}"
				>
					Contacted
				</button>
			{/if}
		</div>
	</div>

	{#if filteredProfiles().length > 0}
		<div class="table-container {isPreliminary ? 'preliminary' : ''}">
			{#if isPreliminary}
				<div class="preliminary-banner">
					<svg class="banner-icon" fill="currentColor" viewBox="0 0 20 20">
						<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
					</svg>
					Analyzing profiles
				</div>
			{/if}

			<table class="influencers-table">
				<thead>
					<tr>
						<th class="col-checkbox">
							{#if !isPreliminary && allSelectableProfiles().length > 0}
								<button type="button" onclick={handleSelectAll} class="select-all-btn-checkbox">
									<div class="checkbox {allSelected() ? 'checked' : someSelected() ? 'indeterminate' : ''}">
										{#if allSelected()}
											<svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
												<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
											</svg>
										{:else if someSelected()}
											<div class="indeterminate-icon"></div>
										{/if}
									</div>
								</button>
							{/if}
						</th>
						<th class="col-name">
							{#if !isPreliminary && allSelectableProfiles().length > 0}
								<button type="button" onclick={handleSelectAll} class="select-all-text-btn">
									<span class="select-all-text">Select All</span>
								</button>
							{:else}
								<span class="col-header">Name</span>
							{/if}
						</th>
						<th class="col-bio"><span class="col-header">Bio</span></th>
						<th class="col-followers"><span class="col-header">Followers</span></th>
						<th class="col-fit"><span class="col-header">Fit Score</span></th>
					</tr>
				</thead>
				<tbody>
					{#each filteredProfiles() as profile (() => {
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
						<tr
							class="table-row {isContacted ? 'contacted' : ''} {isSelected ? 'selected' : ''} {isSelectable && !isPreliminary ? 'selectable' : ''}"
							onclick={() => {
								if (isSelectable && !isPreliminary) {
									onToggleSelection(profileId);
								}
							}}
							in:fly={{ y: isPreliminary ? -10 : -20, duration: isPreliminary ? 300 : 400, opacity: 0 }}
							out:fade={{ duration: isPreliminary ? 250 : 0 }}
						>
							<td class="cell-checkbox">
								{#if isSelected}
									<div class="checkbox checked">
										<svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3">
											<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
										</svg>
									</div>
								{:else if isSelectable}
									<div class="checkbox empty"></div>
								{/if}
							</td>
							<td class="cell-name">
								<div class="name-content">
									<div class="platform-icons">
										{#if profile.platform}
											<div class="platform-icon {getPlatformColor(profile.platform)}" title={profile.platform}>
												{@html getPlatformLogo(profile.platform)}
											</div>
										{/if}
										{#if profile.email_address || profile.business_email}
											<a
												href={`mailto:${profile.email_address || profile.business_email}`}
												class="email-icon"
												title={profile.email_address || profile.business_email}
												onclick={(e) => e.stopPropagation()}
											>
												<svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
													<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
												</svg>
											</a>
										{/if}
									</div>
									<div class="name-text">
										{#if profile.profile_url}
											<a
												href={profile.profile_url}
												target="_blank"
												rel="noopener noreferrer"
												class="profile-link"
												onclick={(e) => e.stopPropagation()}
											>
												{profile.display_name ?? 'N/A'}
											</a>
										{:else}
											<div class="profile-name">
												{profile.display_name ?? 'N/A'}
											</div>
										{/if}
									</div>
								</div>
							</td>
							<td class="cell-bio">
								{#if shouldBlurBio}
									<div class="bio-text blurred">
										{getBlurredBio(profileId)}
									</div>
								{:else}
									<div class="bio-text">{profile.biography ?? profile.bio ?? '—'}</div>
								{/if}
							</td>
							<td class="cell-followers">
								{#if shouldBlurFollowers}
									<span class="followers-text blurred">
										{getBlurredFollowers(profileId)}
									</span>
								{:else}
									<span class="followers-text">
										{profile.followers ? profile.followers.toLocaleString() : 'N/A'}
									</span>
								{/if}
							</td>
							<td class="cell-fit">
								{#if isPreliminary && !hasFitScore}
									<span class="fit-badge analyzing">Analyzing...</span>
								{:else if hasFitScore}
									{@const fitScore = profile.fit_score ?? 0}
									<div class="fit-score-wrapper">
										<span class="fit-badge {
											fitScore >= 80 ? 'high' :
											fitScore >= 60 ? 'medium' :
											'low'
										}">
											{fitScore}/100
										</span>
										{#if profile.fit_rationale}
											<div class="fit-tooltip">
												<div class="tooltip-arrow"></div>
												<div class="tooltip-content">{profile.fit_rationale}</div>
											</div>
										{/if}
									</div>
								{:else}
									<span class="fit-badge empty">—</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else if profiles.length > 0}
		<div class="empty-state">
			<p class="empty-text">
				{#if showContacted}
					No contacted influencers found.
				{:else}
					No uncontacted influencers found.
				{/if}
			</p>
		</div>
	{:else}
		<div class="empty-state">
			{#if status === 'running' || status === 'pending'}
				<div class="loading-state">
					<div class="spinner"></div>
					<p class="loading-title">Processing influencers...</p>
					<p class="loading-subtitle">Influencers will appear here as they are processed</p>
				</div>
			{:else if status === 'completed'}
				<p class="empty-text">No influencers found. Try adjusting your search criteria.</p>
			{:else}
				<p class="empty-text">No influencers available yet.</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* Container */
	.influencers-table-wrapper {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	/* Header */
	.table-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-bottom: 16px;
		border-bottom: 1px solid rgba(0, 0, 0, 0.08);
	}

	.table-title {
		font-size: 20px;
		font-weight: 700;
		color: #1a1a1a;
		margin: 0;
	}

	.table-count {
		font-size: 14px;
		font-weight: 500;
		color: #FF6F61;
		margin-left: 8px;
	}

	.table-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.action-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 20px;
		font-size: 13px;
		font-weight: 600;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.action-btn .btn-icon {
		width: 16px;
		height: 16px;
	}

	.action-btn.find-more {
		background: #10b981;
		color: white;
	}

	.action-btn.find-more:hover:not(:disabled) {
		background: #059669;
	}

	.action-btn.find-more:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.action-btn.export {
		background: #3b82f6;
		color: white;
	}

	.action-btn.export:hover {
		background: #2563eb;
	}

	.action-btn.toggle-contacted {
		background: #f3f4f6;
		color: #374151;
	}

	.action-btn.toggle-contacted:hover {
		background: #e5e7eb;
	}

	.action-btn.toggle-contacted.active {
		background: #10b981;
		color: white;
	}

	/* Table Container */
	.table-container {
		border-radius: 12px;
		border: 1px solid rgba(0, 0, 0, 0.08);
		background: white;
	}

	.table-container.preliminary {
		max-height: 600px;
		overflow: hidden;
	}

	.preliminary-banner {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 24px;
		background: #eff6ff;
		border-bottom: 1px solid #dbeafe;
		font-size: 13px;
		color: #1e40af;
		font-weight: 500;
	}

	.banner-icon {
		width: 16px;
		height: 16px;
		animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}

	/* Table */
	.influencers-table {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}

	.influencers-table thead {
		background: #FFE5DC;
		position: sticky;
		top: 0;
		z-index: 10;
	}

	.influencers-table th {
		padding: 16px 20px;
		text-align: left;
		font-weight: 600;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #6b7280;
	}

	.col-checkbox {
		width: 50px;
		padding: 16px 10px;
	}

	.col-name {
		width: 220px;
		padding-left: 12px;
	}

	.col-bio {
		width: auto;
	}

	.col-followers {
		width: 140px;
	}

	.col-fit {
		width: 140px;
	}

	.col-header {
		display: block;
	}

	/* Select All Buttons */
	.select-all-btn-checkbox {
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		transition: all 0.2s;
	}

	.select-all-text-btn {
		display: flex;
		align-items: center;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		transition: all 0.2s;
	}

	.select-all-text-btn:hover .select-all-text {
		color: #FF6F61;
	}

	.select-all-btn-checkbox:hover .checkbox.empty {
		border-color: #FF6F61;
	}

	.select-all-text {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #1a1a1a;
		transition: color 0.2s;
	}

	/* Checkbox */
	.checkbox {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 6px;
		border: 2px solid #d1d5db;
		transition: all 0.2s;
	}

	.checkbox.empty:hover {
		border-color: #FF6F61;
		background: rgba(255, 111, 97, 0.05);
	}

	.checkbox.checked {
		background: #FF6F61;
		border-color: #FF6F61;
	}

	.checkbox.indeterminate {
		background: #FF6F61;
		border-color: #FF6F61;
	}

	.check-icon {
		width: 12px;
		height: 12px;
		color: white;
	}

	.indeterminate-icon {
		width: 10px;
		height: 2px;
		background: white;
		border-radius: 1px;
	}

	/* Table Rows */
	.table-row {
		border-bottom: 1px solid rgba(0, 0, 0, 0.05);
		transition: all 0.15s ease;
	}

	.table-row.selectable {
		cursor: pointer;
	}

	.table-row.selectable:hover {
		background: rgba(255, 111, 97, 0.04);
	}

	.table-row.selected {
		background: rgba(255, 111, 97, 0.08);
		border-left: 3px solid #FF6F61;
	}

	.table-row.selected:hover {
		background: rgba(255, 111, 97, 0.12);
	}

	.table-row.contacted {
		background: rgba(16, 185, 129, 0.05);
		opacity: 0.7;
		cursor: not-allowed;
	}

	.table-row.contacted:hover {
		background: rgba(16, 185, 129, 0.08);
	}

	/* Table Cells */
	.influencers-table td {
		padding: 16px 20px;
		vertical-align: middle;
	}

	.cell-checkbox {
		width: 50px;
		text-align: center;
		padding: 16px 10px;
	}

	/* Name Cell */
	.cell-name {
		width: 220px;
		white-space: nowrap;
		overflow: hidden;
		padding-left: 12px;
	}

	.name-content {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
	}

	.platform-icons {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.platform-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
	}

	.email-icon {
		color: #9ca3af;
		transition: color 0.2s;
	}

	.email-icon:hover {
		color: #FF6F61;
	}

	.email-icon .icon {
		width: 16px;
		height: 16px;
	}

	.name-text {
		min-width: 0;
		flex: 1;
	}

	.profile-link {
		display: block;
		font-size: 14px;
		font-weight: 500;
		color: #2563eb;
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: color 0.2s;
	}

	.profile-link:hover {
		color: #1e40af;
		text-decoration: underline;
	}

	.profile-name {
		font-size: 14px;
		font-weight: 500;
		color: #1a1a1a;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Bio Cell */
	.cell-bio {
		font-size: 13px;
		color: #6b7280;
	}

	.bio-text {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		line-height: 1.5;
		word-break: break-word;
	}

	.bio-text.blurred {
		color: #d1d5db;
		filter: blur(3px);
		user-select: none;
	}

	/* Followers Cell */
	.cell-followers {
		width: 140px;
		white-space: nowrap;
	}

	.followers-text {
		font-size: 13px;
		color: #6b7280;
	}

	.followers-text.blurred {
		color: #d1d5db;
		filter: blur(3px);
		user-select: none;
	}

	/* Fit Score Cell */
	.cell-fit {
		width: 140px;
		white-space: nowrap;
	}

	.fit-score-wrapper {
		position: relative;
		display: inline-block;
	}

	.fit-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 6px 14px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 600;
		transition: all 0.2s;
	}

	.fit-badge.high {
		background: #d1fae5;
		color: #065f46;
	}

	.fit-badge.medium {
		background: #fef3c7;
		color: #92400e;
	}

	.fit-badge.low {
		background: #fee2e2;
		color: #991b1b;
	}

	.fit-badge.analyzing {
		background: #f3f4f6;
		color: #6b7280;
	}

	.fit-badge.empty {
		background: transparent;
		color: #9ca3af;
		padding: 0;
	}

	.fit-tooltip {
		position: absolute;
		right: 0;
		top: calc(100% + 8px);
		width: 280px;
		padding: 12px;
		background: #1f2937;
		color: white;
		font-size: 12px;
		line-height: 1.5;
		border-radius: 8px;
		box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s;
		z-index: 50;
	}

	.fit-score-wrapper:hover .fit-tooltip {
		opacity: 1;
	}

	.tooltip-arrow {
		position: absolute;
		right: 20px;
		bottom: 100%;
		width: 0;
		height: 0;
		border-left: 6px solid transparent;
		border-right: 6px solid transparent;
		border-bottom: 6px solid #1f2937;
	}

	.tooltip-content {
		white-space: normal;
	}

	/* Empty States */
	.empty-state {
		padding: 48px 24px;
		text-align: center;
	}

	.empty-text {
		font-size: 14px;
		color: #6b7280;
		margin: 0;
	}

	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid #f3f4f6;
		border-top-color: #FF6F61;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.loading-title {
		font-size: 14px;
		font-weight: 600;
		color: #1a1a1a;
		margin: 0;
	}

	.loading-subtitle {
		font-size: 12px;
		color: #6b7280;
		margin: 0;
	}

	/* Animations */
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}
</style>
