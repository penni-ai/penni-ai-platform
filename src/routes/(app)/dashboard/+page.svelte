<script lang="ts">
	import TutorialPopup from '$lib/components/campaign/TutorialPopup.svelte';
	import type { PageData } from './$types';
	import { planMap, type PlanKey } from '$lib/billing/plans';
	import { upgradeModal } from '$lib/stores/upgrade';

	let { data }: { data: PageData } = $props();
	const campaigns = $derived(data.campaigns ?? []);
	const user = $derived(data.user);
	const currentPlan = $derived(data.currentPlan);

	// Get plan details
	const planDetails = $derived(currentPlan?.planKey ? planMap[currentPlan.planKey as PlanKey] : planMap['free']);
	const isFreePlan = $derived(!currentPlan?.planKey || currentPlan.planKey === 'free');

	// Tutorial state
	let showTutorial = $state(false);
	let isCreatingCampaign = $state(false);

	// Show tutorial if: no campaigns AND not completed onboarding
	$effect(() => {
		if (campaigns.length === 0 && !data.onboardingCompleted) {
			showTutorial = true;
		}
	});

	// Aggregate stats
	const totalOutreach = $derived(campaigns.reduce((sum, c) => sum + (c.stats?.outreachSent ?? 0), 0));
	const totalInfluencers = $derived(campaigns.reduce((sum, c) => sum + (c.stats?.influencersFound ?? 0), 0));

	// Only show max 3 campaigns, sorted by most recent
	const displayCampaigns = $derived(
		[...campaigns]
			.sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
			.slice(0, 3)
	);

	async function handleTutorialComplete() {
		try {
			await fetch('/api/user/onboarding', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'complete' })
			});
		} catch (error) {
			console.error('Failed to save onboarding status', error);
		}
		showTutorial = false;
	}

	async function handleTutorialSkip() {
		try {
			await fetch('/api/user/onboarding', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'skip' })
			});
		} catch (error) {
			console.error('Failed to save onboarding status', error);
		}
		showTutorial = false;
	}

	async function createCampaign() {
		if (isCreatingCampaign) return;
		isCreatingCampaign = true;
		try {
			const response = await fetch('/api/campaigns', { method: 'POST' });
			if (!response.ok) throw new Error('Failed to create campaign');
			const data = await response.json();
			if (data.campaignId) {
				window.location.href = `/campaign/${data.campaignId}`;
			}
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
				return { label: 'Ready', dot: 'bg-emerald-500' };
			case 'searching':
				return { label: 'Searching', dot: 'bg-amber-500 animate-pulse' };
			case 'error':
				return { label: 'Error', dot: 'bg-red-500' };
			default:
				return { label: 'Draft', dot: 'bg-gray-300' };
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
</script>

<svelte:head>
	<title>Dashboard – Penni AI</title>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
	<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet">
</svelte:head>

<div class="dashboard">
	<div class="dashboard-container">
		<!-- Editorial Header -->
		<header class="header">
			<div class="header-top">
				<span class="header-date">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
			</div>
			<h1 class="header-greeting">
				{getGreeting()}{getUserFirstName() ? `, ${getUserFirstName()}` : ''}
			</h1>
		</header>

		<!-- Main Grid -->
		<div class="main-grid">
			<!-- Subscription Hero Card -->
			<div class="subscription-card">
				<div class="subscription-inner">
					<div class="subscription-header">
						<span class="subscription-label">Current Plan</span>
						{#if isFreePlan}
							<button type="button" class="upgrade-link" onclick={() => upgradeModal.open('Upgrade your plan', 'Unlock more influencer searches, outreach emails, and connected inboxes.')}>
								Upgrade
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M7 17L17 7M17 7H7M17 7V17"/>
								</svg>
							</button>
						{/if}
					</div>

					<div class="plan-display">
						<h2 class="plan-name">{planDetails?.name ?? 'Free Plan'}</h2>
						<div class="plan-price">
							<span class="price-amount">{planDetails?.price ?? '$0'}</span>
							<span class="price-cadence">/{planDetails?.cadence ?? 'month'}</span>
						</div>
					</div>

					<div class="plan-features">
						{#each (planDetails?.features ?? []).slice(0, 3) as feature}
							<div class="feature-item">
								<span class="feature-dot"></span>
								<span>{feature}</span>
							</div>
						{/each}
					</div>

					{#if !isFreePlan && currentPlan?.currentPeriodEnd}
						<div class="billing-info">
							Next billing: {new Date(currentPlan.currentPeriodEnd * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
						</div>
					{/if}
				</div>

				<!-- Decorative element -->
				<div class="subscription-accent"></div>
			</div>

			<!-- Stats Column -->
			<div class="stats-column">
				<div class="stat-card">
					<span class="stat-label">Campaigns</span>
					<span class="stat-number">{campaigns.length}</span>
				</div>
				<div class="stat-card">
					<span class="stat-label">Influencers</span>
					<span class="stat-number">{totalInfluencers.toLocaleString()}</span>
				</div>
				<div class="stat-card">
					<span class="stat-label">Emails Sent</span>
					<span class="stat-number">{totalOutreach.toLocaleString()}</span>
				</div>
			</div>
		</div>

		<!-- Campaigns Section -->
		<section class="campaigns-section">
			<div class="section-header">
				<h2 class="section-title">Recent Campaigns</h2>
				<button
					onclick={createCampaign}
					disabled={isCreatingCampaign}
					class="new-campaign-btn"
				>
					{#if isCreatingCampaign}
						<span class="spinner"></span>
					{:else}
						<span class="btn-plus">+</span>
						New Campaign
					{/if}
				</button>
			</div>

			{#if campaigns.length === 0}
				<!-- Empty State -->
				<div class="empty-state">
					<div class="empty-content">
						<div class="empty-icon">
							<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
								<path d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>
							</svg>
						</div>
						<h3 class="empty-title">Launch your first campaign</h3>
						<p class="empty-description">Find influencers that match your brand and reach out with personalized emails.</p>
						<button
							onclick={createCampaign}
							disabled={isCreatingCampaign}
							class="empty-cta"
						>
							{#if isCreatingCampaign}
								<span class="spinner"></span>
								Creating...
							{:else}
								Get Started
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M5 12h14M12 5l7 7-7 7"/>
								</svg>
							{/if}
						</button>
					</div>
				</div>
			{:else}
				<!-- Campaign Cards -->
				<div class="campaign-grid">
					{#each displayCampaigns as campaign, i}
						{@const status = getStatusConfig(campaign.status)}
						<a
							href={`/campaign/${campaign.id}`}
							class="campaign-card"
							style="--delay: {i * 0.1}s"
						>
							<div class="campaign-top">
								<div class="campaign-status">
									<span class="status-dot {status.dot}"></span>
									<span class="status-label">{status.label}</span>
								</div>
								<svg class="campaign-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M7 17L17 7M17 7H7M17 7V17"/>
								</svg>
							</div>

							<h3 class="campaign-name">{getCampaignName(campaign)}</h3>

							<div class="campaign-stats">
								<div class="campaign-stat">
									<span class="campaign-stat-number">{campaign.stats?.influencersFound ?? 0}</span>
									<span class="campaign-stat-label">influencers</span>
								</div>
								<div class="campaign-stat-divider"></div>
								<div class="campaign-stat">
									<span class="campaign-stat-number">{campaign.stats?.outreachSent ?? 0}</span>
									<span class="campaign-stat-label">emails</span>
								</div>
							</div>
						</a>
					{/each}
				</div>

				{#if campaigns.length > 3}
					<div class="view-all">
						<a href="/campaigns" class="view-all-link">
							View all {campaigns.length} campaigns
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M5 12h14M12 5l7 7-7 7"/>
							</svg>
						</a>
					</div>
				{/if}
			{/if}
		</section>
	</div>
</div>

<!-- Tutorial Popup -->
<TutorialPopup
	open={showTutorial}
	onComplete={handleTutorialComplete}
	onSkip={handleTutorialSkip}
/>

<style>
	.dashboard {
		font-family: 'DM Sans', system-ui, sans-serif;
		min-height: 100vh;
		background: var(--color-bg);
		color: var(--color-text);
	}

	.dashboard-container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 3rem 2rem 4rem;
	}

	/* Header */
	.header {
		margin-bottom: 3rem;
		animation: fadeIn 0.6s ease-out;
	}

	.header-top {
		margin-bottom: 0.5rem;
	}

	.header-date {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-text-muted);
	}

	.header-greeting {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: clamp(2.5rem, 5vw, 3.5rem);
		font-weight: 400;
		line-height: 1.1;
		color: var(--color-text);
	}

	/* Main Grid */
	.main-grid {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: 1.5rem;
		margin-bottom: 4rem;
		animation: fadeIn 0.6s ease-out 0.1s both;
	}

	/* Subscription Card */
	.subscription-card {
		position: relative;
		background: var(--color-bg-elevated);
		border-radius: 1.5rem;
		overflow: hidden;
		border: 1px solid var(--color-border);
	}

	.subscription-inner {
		padding: 2rem 2.5rem;
		position: relative;
		z-index: 1;
	}

	.subscription-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	.subscription-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--color-text-muted);
	}

	.upgrade-link {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--color-primary);
		text-decoration: none;
		transition: gap 0.2s ease;
	}

	.upgrade-link:hover {
		gap: 0.5rem;
	}

	.plan-display {
		margin-bottom: 2rem;
	}

	.plan-name {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 2.25rem;
		font-weight: 400;
		color: var(--color-text);
		margin-bottom: 0.5rem;
	}

	.plan-price {
		display: flex;
		align-items: baseline;
		gap: 0.25rem;
	}

	.price-amount {
		font-size: 1.5rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.price-cadence {
		font-size: 0.9rem;
		color: var(--color-text-muted);
	}

	.plan-features {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.feature-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.9rem;
		color: var(--color-text-secondary);
	}

	.feature-dot {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--color-primary);
		flex-shrink: 0;
	}

	.billing-info {
		margin-top: 1.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--color-border);
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.subscription-accent {
		position: absolute;
		top: 0;
		right: 0;
		width: 200px;
		height: 200px;
		background: linear-gradient(135deg, var(--color-primary) 0%, transparent 60%);
		opacity: 0.06;
		border-radius: 0 1.5rem 0 100%;
	}

	/* Stats Column */
	.stats-column {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.stat-card {
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: 1rem;
		padding: 1.25rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		transition: transform 0.2s ease, box-shadow 0.2s ease;
	}

	.stat-card:hover {
		transform: translateY(-2px);
		box-shadow: var(--shadow-md);
	}

	.stat-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-text-muted);
	}

	.stat-number {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 2rem;
		font-weight: 400;
		color: var(--color-text);
		line-height: 1;
	}

	/* Campaigns Section */
	.campaigns-section {
		animation: fadeIn 0.6s ease-out 0.2s both;
	}

	.section-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--color-border);
	}

	.section-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.5rem;
		font-weight: 400;
		color: var(--color-text);
	}

	.new-campaign-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.25rem;
		background: var(--color-text);
		color: var(--color-bg-elevated);
		font-size: 0.875rem;
		font-weight: 500;
		border: none;
		border-radius: 2rem;
		cursor: pointer;
		transition: background 0.2s ease, transform 0.2s ease;
	}

	.new-campaign-btn:hover:not(:disabled) {
		background: var(--color-primary);
		transform: translateY(-1px);
	}

	.new-campaign-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-plus {
		font-size: 1.1rem;
		font-weight: 300;
	}

	/* Empty State */
	.empty-state {
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: 1.5rem;
		padding: 4rem 2rem;
	}

	.empty-content {
		max-width: 360px;
		margin: 0 auto;
		text-align: center;
	}

	.empty-icon {
		width: 64px;
		height: 64px;
		margin: 0 auto 1.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-bg-subtle);
		border-radius: 1rem;
		color: var(--color-primary);
	}

	.empty-title {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.5rem;
		font-weight: 400;
		color: var(--color-text);
		margin-bottom: 0.75rem;
	}

	.empty-description {
		font-size: 0.95rem;
		color: var(--color-text-muted);
		line-height: 1.5;
		margin-bottom: 2rem;
	}

	.empty-cta {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 1rem 2rem;
		background: var(--color-primary);
		color: var(--color-bg-elevated);
		font-size: 0.95rem;
		font-weight: 500;
		border: none;
		border-radius: 2rem;
		cursor: pointer;
		transition: background 0.2s ease, transform 0.2s ease, gap 0.2s ease;
	}

	.empty-cta:hover:not(:disabled) {
		background: var(--color-primary-dark);
		transform: translateY(-2px);
		gap: 0.75rem;
	}

	.empty-cta:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	/* Campaign Grid */
	.campaign-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1.25rem;
	}

	.campaign-card {
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		border-radius: 1.25rem;
		padding: 1.5rem;
		text-decoration: none;
		color: inherit;
		transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
		animation: slideUp 0.5s ease-out calc(var(--delay)) both;
	}

	.campaign-card:hover {
		transform: translateY(-4px);
		box-shadow: var(--shadow-lg);
		border-color: var(--color-primary);
	}

	.campaign-card:hover .campaign-arrow {
		opacity: 1;
		transform: translate(2px, -2px);
	}

	.campaign-top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1rem;
	}

	.campaign-status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
	}

	.status-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.campaign-arrow {
		opacity: 0;
		color: var(--color-primary);
		transition: opacity 0.2s ease, transform 0.2s ease;
	}

	.campaign-name {
		font-family: 'Instrument Serif', Georgia, serif;
		font-size: 1.25rem;
		font-weight: 400;
		color: var(--color-text);
		margin-bottom: 1.25rem;
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.campaign-stats {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--color-border);
	}

	.campaign-stat {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
	}

	.campaign-stat-number {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.campaign-stat-label {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.campaign-stat-divider {
		width: 1px;
		height: 20px;
		background: var(--color-border);
	}

	/* View All Link */
	.view-all {
		margin-top: 1.5rem;
		text-align: center;
	}

	.view-all-link {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: var(--color-text-muted);
		text-decoration: none;
		transition: color 0.2s ease, gap 0.2s ease;
	}

	.view-all-link:hover {
		color: var(--color-primary);
		gap: 0.75rem;
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

	/* Animations */
	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(16px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Responsive */
	@media (max-width: 1024px) {
		.main-grid {
			grid-template-columns: 1fr;
		}

		.stats-column {
			flex-direction: row;
		}

		.stat-card {
			flex: 1;
		}

		.campaign-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	@media (max-width: 640px) {
		.dashboard-container {
			padding: 2rem 1.25rem 3rem;
		}

		.stats-column {
			flex-direction: column;
		}

		.campaign-grid {
			grid-template-columns: 1fr;
		}

		.section-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 1rem;
		}
	}
</style>
