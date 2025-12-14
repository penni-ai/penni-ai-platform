<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { fade, fly } from 'svelte/transition';
import DashboardShell from '$lib/components/DashboardShell.svelte';
import SimplePipelinePanel from '$lib/components/campaign/SimplePipelinePanel.svelte';
	import { UpgradeModal } from '$lib/components/billing';
	import { upgradeModal } from '$lib/stores/upgrade';
import { firebaseAuth, firebaseFirestore } from '$lib/firebase/client';
import { ensureFirebaseAuthSession } from '$lib/firebase/auth-sync';
import { setFirebaseAuthReady, resetFirebaseAuth } from '$lib/stores/firebase-auth';
import { campaignPanel } from '$lib/stores/campaign-panel';
import type { LayoutData } from './$types';
import type { SerializedCampaign } from '$lib/server/campaigns';
import type { SearchParams, SearchUsage } from '$lib/types/campaign';
import {
	collection,
	doc,
	limit,
	onSnapshot,
	query,
	type DocumentData,
	type QueryDocumentSnapshot
} from 'firebase/firestore';

	const SIDEBAR_CAMPAIGN_LIMIT = 25;

let { data, children }: { data: LayoutData; children: any } = $props();
let campaignsState = $state<SerializedCampaign[]>(data?.campaigns ?? []);

// Campaign hint state - show hint if onboarding not completed and no campaigns
let showCampaignHint = $state(!data?.onboardingCompleted && (data?.campaigns?.length ?? 0) === 0);

async function dismissCampaignHint() {
	showCampaignHint = false;
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

// Campaign editing panel state - sync with store
let editingCampaign = $state<SerializedCampaign | null>(null);
let searchUsage = $state<SearchUsage | null>(null);
let isSearchFormSubmitting = $state(false);

// Get the campaign being edited from the campaigns list
const currentEditingCampaign = $derived(() => {
	if (!$campaignPanel.campaignId) return null;
	return campaignsState.find(c => c.id === $campaignPanel.campaignId) ?? editingCampaign;
});

// Load search usage for the panel
async function loadSearchUsage() {
	try {
		const response = await fetch('/api/usage');
		if (response.ok) {
			const result = await response.json();
			const usageData = (result as any).data ?? result;
			searchUsage = usageData.influencersFound ?? usageData;
		}
	} catch (error) {
		console.error('Failed to load usage:', error);
	}
}

// Handle creating a new campaign - called from SidebarNavigation
function handleCreateCampaign(campaignId: string) {
	// Dismiss hint when creating a campaign
	if (showCampaignHint) {
		showCampaignHint = false;
	}
	editingCampaign = {
		id: campaignId,
		title: 'New Campaign',
		status: 'collecting',
		createdAt: Date.now(),
		updatedAt: Date.now(),
		website: null,
		business_name: null,
		type_of_influencer: null,
		locations: null,
		followers: null,
		platform: null,
		followersMin: null,
		followersMax: null,
		businessSummary: null,
		lastUpdatedTurnId: null,
		pipeline_id: null
	};
	campaignPanel.open(campaignId);
	void loadSearchUsage();
}

// Handle selecting an incomplete campaign
function handleSelectIncompleteCampaign(campaignId: string) {
	editingCampaign = campaignsState.find(c => c.id === campaignId) ?? null;
	campaignPanel.open(campaignId);
	void loadSearchUsage();
}

// Close the panel
function closePanel() {
	campaignPanel.close();
	// Clear editing campaign after animation
	setTimeout(() => {
		if (!$campaignPanel.isOpen) {
			editingCampaign = null;
		}
	}, 300);
}

// Watch for store-initiated opens (from dashboard buttons) - client only
$effect(() => {
	if (!browser) return;

	if ($campaignPanel.isOpen && $campaignPanel.campaignId) {
		// Load search usage if not loaded
		if (!searchUsage) {
			void loadSearchUsage();
		}
		// Create placeholder campaign if not in campaigns list and not already set
		const campaignId = $campaignPanel.campaignId;
		const exists = campaignsState.some(c => c.id === campaignId);
		if (!exists && (!editingCampaign || editingCampaign.id !== campaignId)) {
			editingCampaign = {
				id: campaignId,
				title: 'New Campaign',
				status: 'collecting',
				createdAt: Date.now(),
				updatedAt: Date.now(),
				website: null,
				business_name: null,
				type_of_influencer: null,
				locations: null,
				followers: null,
				platform: null,
				followersMin: null,
				followersMax: null,
				businessSummary: null,
				lastUpdatedTurnId: null,
				pipeline_id: null
			};
		}
	}
});

// Handle search form submission from the panel
async function handlePanelSubmit(params: SearchParams) {
	const campaignId = $campaignPanel.campaignId;
	if (isSearchFormSubmitting || !campaignId) return;

	isSearchFormSubmitting = true;
	try {
		const response = await fetch('/api/search/influencers', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				business_description: params.business_description,
				top_n: params.top_n ?? 10,
				min_followers: params.min_followers,
				max_followers: params.max_followers,
				campaign_id: campaignId,
				strict_location_matching: params.strict_location_matching ?? false
			})
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new Error((errorData as any)?.error?.message || 'Search failed');
		}

		// Close panel and navigate to the campaign page to see results
		closePanel();
		await goto(`/campaign/${campaignId}`);
	} catch (error) {
		console.error('Search failed:', error);
		alert(error instanceof Error ? error.message : 'An unexpected error occurred');
	} finally {
		isSearchFormSubmitting = false;
	}
}

// Handle website prefill
async function handleWebsitePrefill(websiteUrl: string) {
	const response = await fetch('/api/campaigns/prefill-from-website', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ websiteUrl })
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || 'Failed to analyze website');
	}

	return await response.json();
}

async function subscribeToCampaigns(uid: string) {
	// Ensure Firebase Auth is synchronized before subscribing
	await ensureFirebaseAuthSession(uid);
	
	// Verify that Firebase Auth is properly authenticated
	if (!firebaseAuth.currentUser || firebaseAuth.currentUser.uid !== uid) {
		console.error('[sidebar] Cannot subscribe to campaigns: Auth state invalid', {
			expected: uid,
			actual: firebaseAuth.currentUser?.uid ?? null
		});
		return null;
			}

	// Force refresh the ID token to ensure Firestore picks it up
	try {
		await firebaseAuth.currentUser.getIdToken(true);
		} catch (error) {
		console.error('[sidebar] Failed to refresh ID token before subscribing', error);
		return null;
		}

	const campaignsRef = collection(firebaseFirestore, 'users', uid, 'campaigns');
	const campaignsQuery = query(campaignsRef, limit(SIDEBAR_CAMPAIGN_LIMIT * 2));
	return onSnapshot(
		campaignsQuery,
		(snapshot) => {
			try {
				const deserialized = snapshot.docs.map(deserializeCampaignSnapshot);
				const sorted = sortCampaignsByRecency(deserialized).slice(0, SIDEBAR_CAMPAIGN_LIMIT);
				campaignsState = sorted;
			} catch (error) {
				console.error('[sidebar] failed to deserialize campaigns', error);
				campaignsState = [];
			}
		},
		(error) => {
			console.error('[sidebar] campaigns listener failed', error);
			// Log additional context for permissions errors
			if (error.code === 'permission-denied' || error.message?.includes('permissions')) {
				// Try to get the current token to verify it's valid
				firebaseAuth.currentUser?.getIdToken(false)
					.then((token) => {
						console.error('[sidebar] Permission denied details', {
							uid,
							currentUser: firebaseAuth.currentUser?.uid,
							hasAuth: !!firebaseAuth.currentUser,
							hasToken: !!token,
							tokenLength: token?.length,
							errorCode: error.code,
							errorMessage: error.message
						});
					})
					.catch((tokenError) => {
						console.error('[sidebar] Permission denied details (token check failed)', {
							uid,
							currentUser: firebaseAuth.currentUser?.uid,
							hasAuth: !!firebaseAuth.currentUser,
							tokenError: tokenError.message,
							errorCode: error.code,
							errorMessage: error.message
						});
					});
			}
			campaignsState = [];
		}
	);
}

onMount(() => {
	const uid = data?.user?.uid;
	if (!uid) {
		// No user, but still mark auth as "ready" (just not authenticated)
		setFirebaseAuthReady();
		return;
	}

	let unsubscribe: (() => void) | null = null;
	ensureFirebaseAuthSession(uid)
		.then(async () => {
			// Firebase client auth is now synced with server session
			console.log('[layout] Firebase auth synced for uid:', uid);
			setFirebaseAuthReady();

			const unsubscribeFn = await subscribeToCampaigns(uid);
			if (unsubscribeFn) {
				unsubscribe = unsubscribeFn;
			}
		})
		.catch((error) => {
			console.error('[layout] Firebase auth sync failed', error);
			// Still mark as ready so pages don't hang forever
			setFirebaseAuthReady();
		});

	return () => {
		if (unsubscribe && typeof unsubscribe === 'function') {
			unsubscribe();
		}
		// Reset auth state on unmount (e.g., logout)
		resetFirebaseAuth();
	};
});

	const pathname = $derived(() => $page.url.pathname);
	const sidebarCampaigns = $derived(() =>
		campaignsState
			.map((campaign) => {
				const id = campaign?.id;
				if (!id) return null;
				// Campaign is incomplete if status is 'collecting' or missing required fields
				// Campaign is incomplete only if it's in 'collecting' status AND missing key fields
				// Once search starts (status: 'searching', 'ready', 'complete'), it's no longer incomplete
				const isIncomplete = (campaign.status === 'collecting' || !campaign.status) &&
					(!campaign.website && !campaign.business_name && !campaign.businessSummary);
				return {
					id,
					name: resolveCampaignName(campaign),
					href: `/campaign/${id}`,
					isIncomplete
				};
			})
			.filter((campaign): campaign is { id: string; name: string; href: string; isIncomplete: boolean } => Boolean(campaign))
		);

	const activeCampaignId = $derived(() => {
		const path = pathname();
		if (path.startsWith('/campaign/')) {
			return path.split('/')[2] ?? null;
		}
		return null;
	});

	function resolveCampaignName(campaign: SerializedCampaign): string {
		if (campaign.title) return campaign.title;
		if (campaign.website) return campaign.website;
		if (campaign.influencerTypes) return campaign.influencerTypes;
		if (campaign.locations) return campaign.locations;
		if (campaign.businessSummary) return truncate(campaign.businessSummary, 42);
		return 'Untitled campaign';
	}

	function truncate(value: string, maxLength = 42) {
		return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
	}

	function deserializeCampaignSnapshot(
		doc: QueryDocumentSnapshot<DocumentData>
	): SerializedCampaign {
		const data = doc.data() ?? {};
		// New structure: campaign root only has minimal fields
		// Collected data is in chat/collected subcollection (not accessible from client-side snapshot)
		// For sidebar, we only need basic fields anyway
	return {
		id: pickString(data.id) ?? doc.id,
		createdAt: timestampToMillis(data.createdAt) ?? numberOrNull(data.createdAtMs) ?? numberOrNull(data.createdAt),
		updatedAt: timestampToMillis(data.updatedAt) ?? numberOrNull(data.updatedAtMs) ?? numberOrNull(data.updatedAt),
		title: pickString(data.title),
		// These fields are now in chat/collected, but keep fallback for old campaigns
		website: pickString(data.website) ?? null,
		business_name: pickString((data as any).business_name) ?? null,
		type_of_influencer: pickString((data as any).type_of_influencer) ?? null,
		locations: pickString(data.locations) ?? null,
		followers: pickString(data.followers) ?? null,
		platform: pickString((data as any).platform) ?? null,
		followersMin: numberOrNull(data.followersMin),
		followersMax: numberOrNull(data.followersMax),
		businessSummary: pickString(data.businessSummary) ?? null,
		lastUpdatedTurnId: pickString(data.lastUpdatedTurnId) ?? null,
		status: typeof data.status === 'string' ? data.status as SerializedCampaign['status'] : undefined,
		influencerTypes: pickString(data.influencerTypes) ?? pickString(data.audience) ?? null,
		influencerSearchQuery: pickString((data as any).influencerSearchQuery) ?? null,
		pipeline_id: pickString((data as any).pipeline_id) ?? null,
		fieldStatus: undefined,
		collected: undefined,
		search: undefined,
		followerRange: undefined,
		messageSequence: undefined
	};
}

	function pickString(value: unknown): string | null {
		return typeof value === 'string' && value.trim().length > 0 ? value : null;
	}

	function numberOrNull(value: unknown): number | null {
		return typeof value === 'number' && Number.isFinite(value) ? value : null;
	}

	function timestampToMillis(value: unknown): number | null {
		// Handle Firestore Timestamp objects
		if (value && typeof value === 'object' && 'toMillis' in value) {
			try {
				const millis = (value as { toMillis: () => number }).toMillis();
				return typeof millis === 'number' && Number.isFinite(millis) ? millis : null;
			} catch (error) {
				console.warn('[sidebar] failed to convert timestamp', error);
			}
		}
		// Handle number timestamps (new structure)
		if (typeof value === 'number' && Number.isFinite(value)) {
			return value;
		}
		// Handle seconds timestamps (convert to milliseconds)
		if (typeof value === 'number' && value < 1e12) {
			return value * 1000;
		}
		return null;
	}

	function normalizeKeywords(raw: unknown): string[] {
		if (!Array.isArray(raw)) return [];
		const seen = new Set<string>();
		const keywords: string[] = [];
		for (const entry of raw) {
			if (typeof entry !== 'string') continue;
			const normalized = entry.trim().toLowerCase();
			if (!normalized || seen.has(normalized)) continue;
			seen.add(normalized);
			keywords.push(normalized);
		}
		return keywords;
	}

	function sortCampaignsByRecency(campaigns: SerializedCampaign[]) {
		return campaigns.sort((a, b) => {
			const aTime = a.updatedAt ?? a.createdAt ?? 0;
			const bTime = b.updatedAt ?? b.createdAt ?? 0;
			return bTime - aTime;
		});
	}

	// Sync with upgrade store for components that use the store directly
	$effect(() => {
		// This allows both the store and callback patterns to work
		return upgradeModal.subscribe(() => {});
	});

	function openUpgradePanel(title?: string, description?: string) {
		upgradeModal.open(title, description);
	}

	function closeUpgradePanel() {
		upgradeModal.close();
	}
</script>



<DashboardShell
	campaigns={sidebarCampaigns()}
	activeCampaignId={activeCampaignId()}
	showToggleControls={true}
	onUpgrade={openUpgradePanel}
	onCreateCampaign={handleCreateCampaign}
	onSelectIncompleteCampaign={handleSelectIncompleteCampaign}
	showCampaignHint={showCampaignHint}
	onDismissCampaignHint={dismissCampaignHint}
>
	{@render children()}
</DashboardShell>

<!-- Campaign Editing Panel Overlay (client-only to avoid hydration issues) -->
{#if browser && $campaignPanel.isOpen && $campaignPanel.campaignId}
	<div
		class="panel-overlay"
		onclick={closePanel}
		onkeydown={(e) => e.key === 'Escape' && closePanel()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="panel-container"
			onclick={(e) => e.stopPropagation()}
			transition:fly={{ x: 400, duration: 300 }}
		>
			<button
				type="button"
				class="panel-close-btn"
				onclick={closePanel}
				aria-label="Close panel"
			>
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18 6L6 18M6 6l12 12" />
				</svg>
			</button>
	{#key $campaignPanel.campaignId}
			<SimplePipelinePanel
				campaignId={$campaignPanel.campaignId}
				effectiveCampaign={currentEditingCampaign()}
				pipelineStatus={null}
				pipelineError={null}
				searchUsage={searchUsage}
				influencerSummary=""
				searchFormTopN={10}
				searchFormMinFollowers={null}
				searchFormMaxFollowers={null}
				isSearchFormSubmitting={isSearchFormSubmitting}
				maxInfluencers={1000}
				user={data.user}
				prefilledData={null}
				forceOpenForm={true}
				onSubmit={handlePanelSubmit}
				onWebsitePrefill={handleWebsitePrefill}
			/>
			{/key}
		</div>
	</div>
{/if}

<UpgradeModal
	open={$upgradeModal.open}
	onClose={closeUpgradePanel}
	returnUrl={$page.url.pathname}
	title={$upgradeModal.title ?? 'Choose your plan'}
	description={$upgradeModal.description ?? 'Scale your influencer outreach with the right plan for your needs.'}
	showFreePlan={true}
	dismissible={true}
	currentPlanKey={(data.user?.currentPlan?.planKey as import('$lib/billing/plans').PlanKey) ?? 'free'}
/>

<style>
	.panel-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(4px);
		display: flex;
		justify-content: flex-end;
		z-index: 100;
	}

	.panel-container {
		position: relative;
		width: 60%;
		max-width: 900px;
		min-width: 400px;
		height: 100%;
		background: var(--color-bg-elevated, #ffffff);
		box-shadow: -8px 0 40px rgba(0, 0, 0, 0.15);
		overflow-y: auto;
	}

	.panel-close-btn {
		position: absolute;
		top: 1rem;
		right: 1rem;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		background: var(--color-bg-elevated, #ffffff);
		border: 1px solid var(--color-border, #e8e6e3);
		border-radius: 50%;
		cursor: pointer;
		color: var(--color-text-secondary, #4a4a4a);
		transition: all 0.2s ease;
	}

	.panel-close-btn:hover {
		background: var(--color-bg-subtle, #f5f4f2);
		color: var(--color-text, #1a1a1a);
	}

	/* Dark mode support */
	:global([data-theme="dark"]) .panel-container {
		background: #1a1a1a;
		box-shadow: -8px 0 40px rgba(0, 0, 0, 0.4);
	}

	:global([data-theme="dark"]) .panel-close-btn {
		background: #262626;
		border-color: #3a3a3a;
		color: #a3a3a3;
	}

	:global([data-theme="dark"]) .panel-close-btn:hover {
		background: #333333;
		color: #f5f5f5;
	}
</style>
