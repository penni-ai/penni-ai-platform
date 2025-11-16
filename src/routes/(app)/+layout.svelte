<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import DashboardShell from '$lib/components/DashboardShell.svelte';
	import OutreachUpgradePanel from '$lib/components/OutreachUpgradePanel.svelte';
import { firebaseAuth, firebaseFirestore } from '$lib/firebase/client';
import { ensureFirebaseAuthSession } from '$lib/firebase/auth-sync';
import type { LayoutData } from './$types';
import type { SerializedCampaign } from '$lib/server/campaigns';
import {
	collection,
	limit,
	onSnapshot,
	query,
	type DocumentData,
	type QueryDocumentSnapshot
} from 'firebase/firestore';

	const SIDEBAR_CAMPAIGN_LIMIT = 25;

let { data, children }: { data: LayoutData; children: any } = $props();
let campaignsState = $state<SerializedCampaign[]>(data?.campaigns ?? []);

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
	if (!uid) return;

	let unsubscribe: (() => void) | null = null;
	ensureFirebaseAuthSession(uid)
		.then(async () => {
			const unsubscribeFn = await subscribeToCampaigns(uid);
			if (unsubscribeFn) {
				unsubscribe = unsubscribeFn;
			}
		})
		.catch((error) => {
			console.error('[sidebar] unable to start campaign listener due to auth sync failure', error);
		});

	return () => {
		if (unsubscribe && typeof unsubscribe === 'function') {
			unsubscribe();
		}
	};
});

	const pathname = $derived(() => $page.url.pathname);
	const sidebarCampaigns = $derived(() =>
		campaignsState
			.map((campaign) => {
				const id = campaign?.id;
				if (!id) return null;
				return {
					id,
					name: resolveCampaignName(campaign),
					href: `/campaign/${id}`
				};
			})
			.filter((campaign): campaign is { id: string; name: string; href: string } => Boolean(campaign))
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
		business_location: pickString((data as any).business_location) ?? null,
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
		missing: undefined,
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

	let upgradePanelOpen = $state(false);
	let upgradePanelTitle = $state<string | undefined>(undefined);
	let upgradePanelDescription = $state<string | undefined>(undefined);

	function openUpgradePanel(title?: string, description?: string) {
		upgradePanelTitle = title;
		upgradePanelDescription = description;
		upgradePanelOpen = true;
	}

	function closeUpgradePanel() {
		upgradePanelOpen = false;
		upgradePanelTitle = undefined;
		upgradePanelDescription = undefined;
	}
</script>

<DashboardShell campaigns={sidebarCampaigns()} activeCampaignId={activeCampaignId()} showToggleControls={false} onUpgrade={openUpgradePanel}>
	{@render children()}
</DashboardShell>

<OutreachUpgradePanel 
	open={upgradePanelOpen} 
	onClose={closeUpgradePanel}
	returnUrl={$page.url.pathname}
	title={upgradePanelTitle}
	description={upgradePanelDescription}
/>
