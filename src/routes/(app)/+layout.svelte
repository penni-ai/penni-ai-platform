<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import DashboardShell from '$lib/components/DashboardShell.svelte';
	import { firebaseFirestore } from '$lib/firebase/client';
	import type { LayoutData } from './$types';
	import type { SerializedCampaign } from '$lib/server/campaigns';
	import {
		collection,
		limit,
		onSnapshot,
		orderBy,
		query,
		type DocumentData,
		type QueryDocumentSnapshot
	} from 'firebase/firestore';

	const SIDEBAR_CAMPAIGN_LIMIT = 25;

	let { data, children }: { data: LayoutData; children: any } = $props();
	let campaignsState = $state<SerializedCampaign[]>(data?.campaigns ?? []);

	onMount(() => {
		const uid = data?.user?.uid;
		if (!uid) return;

		const campaignsRef = collection(firebaseFirestore, 'users', uid, 'campaigns');
		const campaignsQuery = query(
			campaignsRef,
			orderBy('createdAtMs', 'desc'),
			limit(SIDEBAR_CAMPAIGN_LIMIT)
		);

		const unsubscribe = onSnapshot(
			campaignsQuery,
			(snapshot) => {
				const nextCampaigns = sortCampaignsByRecency(snapshot.docs.map(deserializeCampaignSnapshot));
				campaignsState = nextCampaigns;
			},
			(error) => {
				console.error('[sidebar] campaigns listener failed', error);
			}
		);

		return () => unsubscribe();
	});

	const pathname = $derived(() => $page.url.pathname);
	const sidebarCampaigns = $derived(() =>
		campaignsState
			.map((campaign) => {
				const id = campaign?.sourceConversationId ?? campaign?.id;
				if (!id) return null;
				return {
					id,
					name: resolveCampaignName(campaign),
					href: `/campaign/chat/${id}`
				};
			})
			.filter((campaign): campaign is { id: string; name: string; href: string } => Boolean(campaign))
	);

	const activeCampaignId = $derived(() => {
		const path = pathname();
		if (path.startsWith('/campaign/chat/')) {
			return path.split('/')[3] ?? null;
		}
		if (path.startsWith('/campaign/')) {
			return path.split('/')[2] ?? null;
		}
		return null;
	});

	function resolveCampaignName(campaign: SerializedCampaign): string {
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
		return {
			id: pickString(data.id) ?? doc.id,
			createdAt: timestampToMillis(data.createdAt) ?? numberOrNull(data.createdAtMs),
			updatedAt: timestampToMillis(data.updatedAt) ?? numberOrNull(data.updatedAtMs),
			website: pickString(data.website),
			influencerTypes:
				pickString(data.influencerTypes) ?? pickString(data.audience) ?? null,
			locations: pickString(data.locations),
			followers: pickString(data.followers),
			followersMin: numberOrNull(data.followersMin),
			followersMax: numberOrNull(data.followersMax),
			keywords: normalizeKeywords(data.keywords),
			businessSummary: pickString(data.businessSummary),
			sourceConversationId: pickString(data.sourceConversationId),
			lastUpdatedTurnId: pickString(data.lastUpdatedTurnId)
		};
	}

	function pickString(value: unknown): string | null {
		return typeof value === 'string' && value.trim().length > 0 ? value : null;
	}

	function numberOrNull(value: unknown): number | null {
		return typeof value === 'number' && Number.isFinite(value) ? value : null;
	}

	function timestampToMillis(value: unknown): number | null {
		if (value && typeof value === 'object' && 'toMillis' in value) {
			try {
				const millis = (value as { toMillis: () => number }).toMillis();
				return typeof millis === 'number' ? millis : null;
			} catch (error) {
				console.warn('[sidebar] failed to convert timestamp', error);
			}
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
</script>

<DashboardShell campaigns={sidebarCampaigns()} activeCampaignId={activeCampaignId()} showToggleControls={false}>
	{@render children()}
</DashboardShell>
