<script lang="ts">
import { goto } from '$app/navigation';
import { onMount } from 'svelte';
import { sidebarState } from '$lib/stores/sidebar';
import { upgradeModal } from '$lib/stores/upgrade';
import { theme, type Theme } from '$lib/stores/theme';

	type NavItem = {
		label: string;
		href: string;
		icon: 'dashboard' | 'inbox' | 'settings';
		badge?: number;
	};

	type CampaignLink = {
		id: string;
		name: string;
		href?: string;
		isIncomplete?: boolean;
	};

	interface Props {
		campaigns?: CampaignLink[];
		selectedCampaignId?: string | null;
		onUpgrade?: () => void;
		onCreateCampaign?: (campaignId: string) => void;
		onSelectIncompleteCampaign?: (campaignId: string) => void;
		showCampaignHint?: boolean;
		onDismissCampaignHint?: () => void;
	}

	const navItems: NavItem[] = [
		{ label: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
		{ label: 'Inbox', href: '/inbox', icon: 'inbox', badge: 2 },
		{ label: 'Settings', href: '/my-account', icon: 'settings' }
	];

	let {
		campaigns = [],
		selectedCampaignId = null,
		onUpgrade,
		onCreateCampaign,
		onSelectIncompleteCampaign,
		showCampaignHint = false,
		onDismissCampaignHint
	}: Props = $props();

	function dismissHint() {
		onDismissCampaignHint?.();
	}

	// Campaign selector dropdown state
	let isCampaignDropdownOpen = $state(false);

	// Theme state
	let currentTheme: Theme = $state('dark');

	// Get current campaign name
	const currentCampaign = $derived(
		campaigns.find(c => c.id === selectedCampaignId)
	);

	function toggleCampaignDropdown() {
		isCampaignDropdownOpen = !isCampaignDropdownOpen;
	}

	function closeCampaignDropdown() {
		isCampaignDropdownOpen = false;
	}

	async function selectCampaign(campaignId: string) {
		closeCampaignDropdown();
		const campaign = campaigns.find(c => c.id === campaignId);
		if (campaign) {
			// If campaign is incomplete and we have a callback, open the panel instead of navigating
			if (campaign.isIncomplete && onSelectIncompleteCampaign) {
				onSelectIncompleteCampaign(campaignId);
			} else {
				await goto(campaign.href ?? `/campaign/${campaign.id}`);
			}
		}
	}

	async function createNewCampaign() {
		closeCampaignDropdown();
		try {
			const response = await fetch('/api/campaigns', { method: 'POST' });
			if (!response.ok) {
				throw new Error('Failed to create campaign');
			}
			const data = await response.json();
			if (data.campaignId) {
				// If we have a callback, open the panel instead of navigating
				if (onCreateCampaign) {
					onCreateCampaign(data.campaignId);
				} else {
					await goto(`/campaign/${data.campaignId}`);
					sidebarState.close();
				}
			}
		} catch (error) {
			console.error('Failed to create campaign', error);
			alert('Failed to create campaign. Please try again.');
		}
	}

	let usage = $state<{
		influencersFound: { count: number; limit: number; remaining: number; resetDate: number };
		outreachSent: { count: number; limit: number; remaining: number; resetDate: number };
	} | null>(null);
	let currentPlanKey = $state<string | null>(null);

	onMount(() => {
		function handleClickOutside(event: MouseEvent) {
			if (isCampaignDropdownOpen) {
				const target = event.target as HTMLElement | null;
				if (!target?.closest('[data-campaign-selector]')) {
					closeCampaignDropdown();
				}
			}
		}

		function handleEscape(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				if (isCampaignDropdownOpen) {
					closeCampaignDropdown();
				}
			}
		}

		document.addEventListener('click', handleClickOutside);
		document.addEventListener('keydown', handleEscape);

		// Subscribe to theme changes
		const unsubscribeTheme = theme.subscribe((value) => {
			currentTheme = value;
		});

		// Load usage and plan
		void loadUsage();
		void loadPlan();

		return () => {
			document.removeEventListener('click', handleClickOutside);
			document.removeEventListener('keydown', handleEscape);
			unsubscribeTheme();
		};
	});

	async function loadUsage() {
		try {
			const response = await fetch('/api/usage');
			if (response.ok) {
				const result = await response.json();
				usage = result.data ?? result;
			}
		} catch (error) {
			console.error('Failed to load usage:', error);
		}
	}

	async function loadPlan() {
		try {
			const response = await fetch('/api/billing/current-plan');
			if (response.ok) {
				const result = await response.json();
				currentPlanKey = result.data?.planKey ?? result.planKey ?? null;
			}
		} catch (error) {
			console.error('Failed to load plan:', error);
		}
	}

	function getPlanName(planKey: string | null): string {
		if (!planKey) return 'Free';
		const planNames: Record<string, string> = {
			free: 'Free',
			starter: 'Starter',
			growth: 'Growth',
			event: 'Event'
		};
		return planNames[planKey] ?? 'Free';
	}
</script>

<div class="sidebar-container" class:theme-light={currentTheme === 'light'} class:theme-dark={currentTheme === 'dark'} class:theme-mixed={currentTheme === 'mixed'}>
	<!-- Campaign Selector -->
	<div class="campaign-selector-section" data-campaign-selector>
		{#if campaigns.length === 0}
			<!-- No campaigns: Show New Campaign button -->
			<div class="new-campaign-wrapper">
				<button onclick={createNewCampaign} class="new-campaign-btn-solo">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M12 5v14M5 12h14"/>
					</svg>
					<span>New Campaign</span>
				</button>
				{#if showCampaignHint}
					<div class="campaign-hint-bubble">
						<button class="hint-close" onclick={dismissHint} aria-label="Dismiss">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M18 6L6 18M6 6l12 12"/>
							</svg>
						</button>
						<p>Click here to create your first campaign and start finding influencers!</p>
						<div class="hint-arrow"></div>
					</div>
				{/if}
			</div>
		{:else}
			<!-- Has campaigns: Show dropdown selector -->
			<button
				onclick={toggleCampaignDropdown}
				class="campaign-selector-trigger"
				class:is-open={isCampaignDropdownOpen}
			>
				<div class="selector-content">
					<span class="selector-label">Campaign</span>
					<span class="selector-value">{currentCampaign?.name ?? 'Select campaign'}</span>
				</div>
				<svg
					class="selector-arrow"
					class:rotated={isCampaignDropdownOpen}
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<path d="M6 9l6 6 6-6"/>
				</svg>
			</button>

			{#if isCampaignDropdownOpen}
				<div class="campaign-dropdown">
					<div class="dropdown-campaigns">
						{#each campaigns as campaign}
							<button
								onclick={() => selectCampaign(campaign.id)}
								class="dropdown-campaign-item"
								class:is-selected={campaign.id === selectedCampaignId}
								class:is-incomplete={campaign.isIncomplete}
							>
								<span class="campaign-item-indicator" class:incomplete={campaign.isIncomplete}></span>
								<span class="campaign-item-name">{campaign.name}</span>
								{#if campaign.isIncomplete}
									<span class="incomplete-badge">Draft</span>
								{/if}
							</button>
						{/each}
					</div>
					<div class="dropdown-divider"></div>
					<button onclick={createNewCampaign} class="dropdown-new-campaign">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M12 5v14M5 12h14"/>
						</svg>
						<span>New Campaign</span>
					</button>
				</div>
			{/if}
		{/if}
	</div>

	<!-- Spacer -->
	<div class="sidebar-spacer"></div>

	<!-- Bottom Section -->
	<div class="bottom-section">
		<!-- Minimal Usage Panel -->
		{#if usage}
			<button
				class="usage-panel-minimal"
				onclick={() => {
					if (onUpgrade) {
						onUpgrade();
					} else {
						upgradeModal.open('Upgrade your plan', 'Unlock more influencer searches, outreach emails, and connected inboxes.');
					}
				}}
			>
				<div class="usage-content">
					<span class="usage-plan-name">{getPlanName(currentPlanKey)}</span>
					<div class="usage-stats">
						<span class="usage-stat">{usage.influencersFound.remaining}/{usage.influencersFound.limit} searches</span>
						<span class="usage-stat">{usage.outreachSent.remaining}/{usage.outreachSent.limit} outreach</span>
					</div>
					<div class="usage-bars">
						<div class="usage-bar">
							<div
								class="usage-bar-fill"
								style="--fill: {usage.influencersFound.limit > 0 ? (usage.influencersFound.remaining / usage.influencersFound.limit) * 100 : 0}%"
							></div>
						</div>
						<div class="usage-bar">
							<div
								class="usage-bar-fill"
								style="--fill: {usage.outreachSent.limit > 0 ? (usage.outreachSent.remaining / usage.outreachSent.limit) * 100 : 0}%"
							></div>
						</div>
					</div>
				</div>
				<span class="upgrade-btn-hover">Upgrade</span>
			</button>
		{/if}

		<!-- Thin Separator -->
		<div class="nav-separator"></div>

		<!-- Navigation Items -->
		<nav class="nav-section">
			{#each navItems as item}
				<a href={item.href} class="nav-item">
					<div class="nav-icon">
						{#if item.icon === 'dashboard'}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
								<rect x="3" y="3" width="7" height="7" rx="1" />
								<rect x="14" y="3" width="7" height="7" rx="1" />
								<rect x="3" y="14" width="7" height="7" rx="1" />
								<rect x="14" y="14" width="7" height="7" rx="1" />
							</svg>
						{:else if item.icon === 'inbox'}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.667 2.667 0 00-.1.661z" />
							</svg>
						{:else}
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
								<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
							</svg>
						{/if}
					</div>
					<span class="nav-label">{item.label}</span>
					{#if item.badge}
						<span class="nav-badge">{item.badge}</span>
					{/if}
				</a>
			{/each}
		</nav>
	</div>
</div>

<style>
	/* CSS Variables - Theme-aware Sidebar */
	.sidebar-container {
		--coral: #FF6F61;
		--coral-dark: #e85d50;

		/* Use theme CSS variables for sidebar */
		--bg-primary: var(--color-sidebar-bg);
		--bg-elevated: var(--color-sidebar-bg-elevated);
		--bg-hover: var(--color-sidebar-bg-hover);
		--text-primary: var(--color-sidebar-text);
		--text-secondary: var(--color-sidebar-text-secondary);
		--text-muted: var(--color-sidebar-text-muted);
		--border-primary: var(--color-sidebar-border);
		--border-subtle: var(--color-sidebar-border);

		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		font-family: 'DM Sans', system-ui, sans-serif;
		background: var(--bg-primary);
		color: var(--text-primary);
		transition: background-color 0.3s ease, color 0.3s ease;
	}

	/* Campaign Selector Section */
	.campaign-selector-section {
		position: relative;
		padding: 0.75rem 0.75rem 1rem 0.75rem;
		flex-shrink: 0;
	}

	/* Solo New Campaign Button (when no campaigns) */
	.new-campaign-btn-solo {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.625rem 0.75rem;
		background: linear-gradient(135deg, var(--coral) 0%, var(--coral-dark) 100%);
		color: white;
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		transition: all 0.25s ease;
		box-shadow: 0 2px 12px -3px rgba(255, 111, 97, 0.4);
	}

	.new-campaign-btn-solo:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 16px -3px rgba(255, 111, 97, 0.5);
	}

	/* Campaign Selector Trigger */
	.campaign-selector-trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.625rem 0.5rem;
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--border-primary);
		cursor: pointer;
		transition: all 0.2s ease;
		text-align: left;
	}

	.campaign-selector-trigger:hover {
		background: var(--bg-elevated);
	}

	.campaign-selector-trigger.is-open {
		background: var(--bg-elevated);
	}

	.selector-content {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
		flex: 1;
	}

	.selector-label {
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted);
	}

	.selector-value {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.selector-arrow {
		flex-shrink: 0;
		color: var(--text-muted);
		transition: transform 0.2s ease;
	}

	.selector-arrow.rotated {
		transform: rotate(180deg);
	}

	/* Campaign Dropdown */
	.campaign-dropdown {
		position: absolute;
		top: 100%;
		left: 0.5rem;
		right: 0.5rem;
		z-index: 50;
		margin-top: 0.25rem;
		background: var(--bg-elevated);
		border: 1px solid var(--border-subtle);
		border-radius: 0.375rem;
		box-shadow: 0 8px 30px -8px rgba(0, 0, 0, 0.4);
		overflow: hidden;
		transition: background 0.3s ease, border-color 0.3s ease;
	}

	/* Light theme dropdown shadow */
	.sidebar-container.theme-light .campaign-dropdown {
		box-shadow: 0 8px 30px -8px rgba(0, 0, 0, 0.15);
	}

	.dropdown-campaigns {
		max-height: 200px;
		overflow-y: auto;
	}

	.dropdown-campaign-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: transparent;
		border: none;
		cursor: pointer;
		transition: all 0.15s ease;
		text-align: left;
	}

	.dropdown-campaign-item:hover {
		background: var(--bg-hover);
	}

	.dropdown-campaign-item.is-selected {
		background: rgba(255, 111, 97, 0.15);
	}

	.campaign-item-indicator {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--text-muted);
		flex-shrink: 0;
		transition: all 0.15s ease;
	}

	.campaign-item-indicator.incomplete {
		background: #f59e0b;
		box-shadow: 0 0 6px rgba(245, 158, 11, 0.4);
	}

	.dropdown-campaign-item.is-selected .campaign-item-indicator {
		background: var(--coral);
		box-shadow: 0 0 8px rgba(255, 111, 97, 0.5);
	}

	.dropdown-campaign-item.is-incomplete {
		opacity: 0.85;
	}

	.incomplete-badge {
		margin-left: auto;
		padding: 0.125rem 0.375rem;
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #f59e0b;
		background: rgba(245, 158, 11, 0.15);
		border-radius: 0.25rem;
	}

	.campaign-item-name {
		font-size: 0.85rem;
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.dropdown-campaign-item.is-selected .campaign-item-name {
		font-weight: 600;
		color: var(--coral);
	}

	.dropdown-divider {
		height: 1px;
		background: var(--border-subtle);
	}

	.dropdown-new-campaign {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.75rem 1rem;
		background: transparent;
		border: none;
		cursor: pointer;
		transition: all 0.15s ease;
		text-align: left;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--coral);
	}

	.dropdown-new-campaign:hover {
		background: rgba(255, 111, 97, 0.1);
	}

	/* Spacer */
	.sidebar-spacer {
		flex: 1;
	}

	/* Bottom Section */
	.bottom-section {
		flex-shrink: 0;
		padding: 0.75rem;
	}

	/* Minimal Usage Panel */
	.usage-panel-minimal {
		display: block;
		width: 100%;
		padding: 0.625rem 0.75rem;
		background: var(--bg-elevated);
		border: none;
		border-radius: 0.25rem;
		cursor: pointer;
		transition: all 0.3s ease;
		text-align: left;
		position: relative;
	}

	.usage-panel-minimal:hover {
		background: var(--bg-hover);
	}

	.usage-panel-minimal:hover .upgrade-btn-hover {
		opacity: 1;
		transform: translateY(-50%) translateY(0);
	}

	.usage-content {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.usage-plan-name {
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-muted);
		transition: color 0.3s ease;
	}

	.usage-stats {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.usage-stat {
		font-size: 0.7rem;
		color: var(--text-secondary);
		transition: color 0.3s ease;
	}

	.usage-bars {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-top: 0.125rem;
	}

	.usage-bar {
		height: 2px;
		background: var(--border-subtle);
		border-radius: 1px;
		overflow: hidden;
		transition: background 0.3s ease;
	}

	.usage-bar-fill {
		height: 100%;
		width: var(--fill, 0%);
		background: linear-gradient(90deg, var(--coral) 0%, var(--coral-dark) 100%);
		border-radius: 1px;
		transition: all 0.5s ease;
	}

	.upgrade-btn-hover {
		position: absolute;
		right: 0.5rem;
		top: 50%;
		transform: translateY(-50%) translateY(4px);
		padding: 0.25rem 0.5rem;
		background: var(--coral);
		color: white;
		font-size: 0.6rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		border-radius: 0.25rem;
		opacity: 0;
		transition: all 0.3s ease;
	}

	/* Nav Separator */
	.nav-separator {
		height: 1px;
		background: var(--border-primary);
		margin: 0.75rem 0;
	}

	/* Navigation Section */
	.nav-section {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.5rem;
		text-decoration: none;
		transition: all 0.2s ease;
		border-radius: 0.25rem;
	}

	.nav-item:hover {
		background: var(--bg-elevated);
	}

	.nav-item:hover .nav-icon {
		color: var(--coral);
	}

	.nav-item:hover .nav-label {
		color: var(--text-primary);
	}

	.nav-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		transition: color 0.2s ease;
	}

	.nav-label {
		flex: 1;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-secondary);
		transition: color 0.2s ease;
	}

	.nav-badge {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 16px;
		height: 16px;
		padding: 0 0.25rem;
		background: var(--coral);
		color: white;
		font-size: 0.6rem;
		font-weight: 700;
		border-radius: 8px;
	}

	/* New Campaign Wrapper for hint positioning */
	.new-campaign-wrapper {
		position: relative;
	}

	/* Campaign Hint Bubble */
	.campaign-hint-bubble {
		position: absolute;
		left: calc(100% + 12px);
		top: 50%;
		transform: translateY(-50%);
		width: 200px;
		padding: 0.875rem 1rem;
		background: #1a1a1a;
		color: white;
		border-radius: 10px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
		z-index: 100;
		animation: hintFadeIn 0.3s ease-out;
	}

	@keyframes hintFadeIn {
		from {
			opacity: 0;
			transform: translateY(-50%) translateX(-8px);
		}
		to {
			opacity: 1;
			transform: translateY(-50%) translateX(0);
		}
	}

	.campaign-hint-bubble p {
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.4;
		color: rgba(255, 255, 255, 0.9);
	}

	.hint-close {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		background: transparent;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		color: rgba(255, 255, 255, 0.5);
		transition: all 0.15s ease;
	}

	.hint-close:hover {
		background: rgba(255, 255, 255, 0.1);
		color: white;
	}

	.hint-arrow {
		position: absolute;
		left: -6px;
		top: 50%;
		transform: translateY(-50%);
		width: 0;
		height: 0;
		border-top: 6px solid transparent;
		border-bottom: 6px solid transparent;
		border-right: 6px solid #1a1a1a;
	}

	/* Light theme hint bubble */
	.sidebar-container.theme-light .campaign-hint-bubble {
		background: white;
		color: #1a1a1a;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.05);
	}

	.sidebar-container.theme-light .campaign-hint-bubble p {
		color: #4a4a4a;
	}

	.sidebar-container.theme-light .hint-close {
		color: rgba(0, 0, 0, 0.4);
	}

	.sidebar-container.theme-light .hint-close:hover {
		background: rgba(0, 0, 0, 0.05);
		color: #1a1a1a;
	}

	.sidebar-container.theme-light .hint-arrow {
		border-right-color: white;
	}
</style>
