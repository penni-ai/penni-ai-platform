<script lang="ts">
	import type { PageData } from './$types';
	import { campaignPanel } from '$lib/stores/campaign-panel';
	import WelcomePopup from '$lib/components/WelcomePopup.svelte';

	let { data }: { data: PageData } = $props();
	const campaigns = $derived(data.campaigns ?? []);
	const user = $derived(data.user);

	let isCreatingCampaign = $state(false);
	let showWelcome = $state(!data.onboardingCompleted);

	async function dismissWelcome() {
		showWelcome = false;
		try {
			await fetch('/api/user/onboarding', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'complete' })
			});
		} catch (error) {
			console.error('Failed to save onboarding status', error);
		}
	}

	async function handleWelcomeGetStarted() {
		await dismissWelcome();
		createCampaign();
	}

	// Aggregate stats
	const totalOutreach = $derived(campaigns.reduce((sum, c) => sum + (c.stats?.outreachSent ?? 0), 0));
	const totalInfluencers = $derived(campaigns.reduce((sum, c) => sum + (c.stats?.influencersFound ?? 0), 0));

	// Sort campaigns by most recent
	const displayCampaigns = $derived(
		[...campaigns]
			.sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
	);

	async function createCampaign() {
		if (isCreatingCampaign || $campaignPanel.isCreating) return;
		isCreatingCampaign = true;
		try {
			await campaignPanel.requestCreate();
		} catch (error) {
			console.error('Failed to create campaign', error);
			alert('Failed to create campaign. Please try again.');
		} finally {
			isCreatingCampaign = false;
		}
	}

	function getCampaignName(campaign: typeof campaigns[0]): string {
		if (campaign.title) return campaign.title;
		if (campaign.business_name) return campaign.business_name;
		if (campaign.website) {
			try {
				const url = new URL(campaign.website.startsWith('http') ? campaign.website : `https://${campaign.website}`);
				return url.hostname.replace('www.', '');
			} catch {
				return campaign.website;
			}
		}
		if (campaign.influencerTypes) return campaign.influencerTypes;
		if (campaign.locations) return `Campaign in ${campaign.locations}`;
		return 'Untitled Campaign';
	}

	function getStatusConfig(status: string | undefined) {
		switch (status) {
			case 'ready':
			case 'complete':
				return { label: 'Ready', class: 'status-ready' };
			case 'searching':
				return { label: 'Searching', class: 'status-searching' };
			case 'error':
				return { label: 'Error', class: 'status-error' };
			default:
				return { label: 'Draft', class: 'status-draft' };
		}
	}

	function getGreeting(): string {
		const hour = new Date().getHours();
		if (hour < 12) return 'Good morning';
		if (hour < 17) return 'Good afternoon';
		return 'Good evening';
	}

	function getUserFirstName(): string {
		if (!user?.email) return '';
		const name = user.email.split('@')[0];
		return name.charAt(0).toUpperCase() + name.slice(1);
	}

	function formatDate(timestamp: number | null | undefined): string {
		if (!timestamp) return '';
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Yesterday';
		if (diffDays < 7) return `${diffDays} days ago`;

		return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}
</script>

<svelte:head>
	<title>Dashboard - Penni AI</title>
</svelte:head>

<div class="dashboard">
	<!-- Header -->
	<header class="page-header">
		<div class="greeting">
			<h1>{getGreeting()}{getUserFirstName() ? `, ${getUserFirstName()}` : ''}</h1>
			<p>Here's what's happening with your campaigns</p>
		</div>
	</header>

	<!-- Stats Row -->
	<div class="stats-row">
		<div class="stat-card">
			<span class="stat-value">{campaigns.length}</span>
			<span class="stat-label">Campaigns</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{totalInfluencers.toLocaleString()}</span>
			<span class="stat-label">Influencers Found</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{totalOutreach.toLocaleString()}</span>
			<span class="stat-label">Emails Sent</span>
		</div>
	</div>

	<!-- Campaigns Section -->
	<section class="campaigns-section">
		<div class="section-header">
			<h2>Recent Campaigns</h2>
		</div>

		{#if campaigns.length === 0}
			<div class="empty-state">
				<div class="empty-icon">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
						<path d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>
					</svg>
				</div>
				<h3>No campaigns yet</h3>
				<p>Create your first campaign to start finding influencers.</p>
				<button onclick={createCampaign} disabled={isCreatingCampaign} class="empty-cta">
					{#if isCreatingCampaign}
						<span class="spinner"></span>
						Creating...
					{:else}
						Create Campaign
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M12 4.5v15m7.5-7.5h-15"/>
						</svg>
					{/if}
				</button>
			</div>
		{:else}
			<div class="campaigns-grid">
				{#each displayCampaigns as campaign}
					{@const status = getStatusConfig(campaign.status)}
					<a href={`/campaign/${campaign.id}`} class="campaign-card">
						<div class="card-header">
							<h3 class="campaign-name">{getCampaignName(campaign)}</h3>
							<span class="status-badge {status.class}">{status.label}</span>
						</div>
						<div class="card-stats">
							<div class="card-stat">
								<span class="card-stat-value">{campaign.stats?.influencersFound ?? 0}</span>
								<span class="card-stat-label">influencers</span>
							</div>
							<div class="card-stat">
								<span class="card-stat-value">{campaign.stats?.outreachSent ?? 0}</span>
								<span class="card-stat-label">sent</span>
							</div>
						</div>
						<div class="card-footer">
							<span class="card-date">{formatDate(campaign.updatedAt ?? campaign.createdAt)}</span>
							<svg class="card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M7 17L17 7M17 7H7M17 7V17"/>
							</svg>
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</section>
</div>

<WelcomePopup
	open={showWelcome}
	userName={getUserFirstName()}
	onGetStarted={handleWelcomeGetStarted}
	onClose={dismissWelcome}
/>

<style>
	.dashboard {
		padding: 2rem;
		max-width: 1200px;
		margin: 0 auto;
	}

	/* Header */
	.page-header {
		margin-bottom: 2rem;
	}

	.greeting h1 {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.75rem;
		font-weight: 400;
		color: var(--color-text);
		margin: 0 0 0.25rem 0;
	}

	.greeting p {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	/* Stats Row */
	.stats-row {
		display: flex;
		gap: 1rem;
		margin-bottom: 2.5rem;
	}

	.stat-card {
		flex: 1;
		padding: 1.25rem 1.5rem;
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: 10px;
	}

	.stat-value {
		display: block;
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 2rem;
		font-weight: 400;
		color: var(--color-text);
		line-height: 1;
		margin-bottom: 0.25rem;
	}

	.stat-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	/* Campaigns Section */
	.campaigns-section {
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		padding: 1.5rem;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	.section-header h2 {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.25rem;
		font-weight: 400;
		color: var(--color-text);
		margin: 0;
	}

	/* Empty State */
	.empty-state {
		text-align: center;
		padding: 3rem 2rem;
	}

	.empty-icon {
		width: 56px;
		height: 56px;
		margin: 0 auto 1.25rem;
		color: var(--color-coral);
		opacity: 0.6;
	}

	.empty-icon svg {
		width: 100%;
		height: 100%;
	}

	.empty-state h3 {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.5rem;
		font-weight: 400;
		color: var(--color-text);
		margin: 0 0 0.5rem 0;
	}

	.empty-state p {
		font-size: 0.9375rem;
		color: var(--color-text-muted);
		margin: 0 0 1.5rem 0;
	}

	.empty-cta {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		background: var(--color-coral);
		color: white;
		font-size: 0.875rem;
		font-weight: 600;
		font-family: inherit;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.2s ease;
	}

	.empty-cta:hover:not(:disabled) {
		background: var(--color-coral-dark);
	}

	.empty-cta:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.empty-cta svg {
		width: 16px;
		height: 16px;
	}

	/* Campaigns Grid */
	.campaigns-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1rem;
	}

	.campaign-card {
		display: flex;
		flex-direction: column;
		padding: 1.25rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 10px;
		text-decoration: none;
		color: inherit;
		transition: all 0.2s ease;
	}

	.campaign-card:hover {
		border-color: var(--color-coral);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
	}

	.campaign-card:hover .card-arrow {
		opacity: 1;
		color: var(--color-coral);
	}

	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.campaign-name {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.125rem;
		font-weight: 400;
		color: var(--color-text);
		margin: 0;
		line-height: 1.3;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.status-badge {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		flex-shrink: 0;
	}

	.status-ready {
		background: #dcfce7;
		color: #166534;
	}

	.status-searching {
		background: #fef3c7;
		color: #92400e;
	}

	.status-error {
		background: #fee2e2;
		color: #991b1b;
	}

	.status-draft {
		background: var(--color-border);
		color: var(--color-text-muted);
	}

	:global([data-theme="dark"]) .status-ready {
		background: rgba(34, 197, 94, 0.2);
		color: #4ade80;
	}

	:global([data-theme="dark"]) .status-searching {
		background: rgba(251, 191, 36, 0.2);
		color: #fbbf24;
	}

	:global([data-theme="dark"]) .status-error {
		background: rgba(239, 68, 68, 0.2);
		color: #f87171;
	}

	:global([data-theme="dark"]) .status-draft {
		background: rgba(255, 255, 255, 0.1);
		color: var(--color-text-muted);
	}

	.card-stats {
		display: flex;
		gap: 1.5rem;
		margin-bottom: 1rem;
	}

	.card-stat {
		display: flex;
		align-items: baseline;
		gap: 0.25rem;
	}

	.card-stat-value {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.25rem;
		color: var(--color-text);
	}

	.card-stat-label {
		font-size: 0.6875rem;
		color: var(--color-text-muted);
	}

	.card-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-border);
		margin-top: auto;
	}

	.card-date {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.card-arrow {
		width: 16px;
		height: 16px;
		color: var(--color-text-muted);
		opacity: 0;
		transition: all 0.2s ease;
	}

	/* Spinner */
	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid transparent;
		border-top-color: currentColor;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* Responsive */
	@media (max-width: 768px) {
		.dashboard {
			padding: 1.5rem;
		}

		.stats-row {
			flex-direction: column;
		}

		.campaigns-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
