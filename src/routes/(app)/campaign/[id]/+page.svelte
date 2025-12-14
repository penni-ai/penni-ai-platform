<script lang="ts">
import { onMount } from 'svelte';
import { page } from '$app/stores';
import { browser } from '$app/environment';
import SimplePipelinePanel from '$lib/components/campaign/SimplePipelinePanel.svelte';
import { UpgradeModal } from '$lib/components/billing';
import SearchLimitExceededPanel from '$lib/components/SearchLimitExceededPanel.svelte';
import CampaignLoadingCover from '$lib/components/campaign/CampaignLoadingCover.svelte';
import FindMorePopup from '$lib/components/campaign/FindMorePopup.svelte';
import type { PageData } from './$types';
import { firebaseFirestore, firebaseAuth } from '$lib/firebase/client';
import { doc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { firebaseAuthReady } from '$lib/stores/firebase-auth';
import type { SerializedCampaign } from '$lib/server/campaigns';
import type { PipelineStatus, SearchParams, SearchUsage, InfluencerProfile } from '$lib/types/campaign';
import { getProfileId } from '$lib/utils/campaign';

// Page data
let { data }: { data: PageData } = $props();
const campaign = $derived(data.campaign);
const routeCampaignId = $derived($page.params.id);

// Local campaign state for optimistic updates
let localCampaign = $state<SerializedCampaign | null>(null);

// Search form state
let influencerSummary = $state('');
let searchFormTopN = $state(10);
let searchFormMinFollowers = $state<number | null>(null);
let searchFormMaxFollowers = $state<number | null>(null);
let isSearchFormSubmitting = $state(false);
let searchUsage = $state<SearchUsage | null>(null);

// Pipeline state
let pipelineStatus = $state<PipelineStatus | null>(null);
let pipelineError = $state<{ code: string; message: string; pipelineId: string } | null>(null);
let temporaryPipelineId = $state<string | null>(null);

// Dialog state
let upgradePanelOpen = $state(false);
let upgradePanelTitle = $state<string | undefined>(undefined);
let upgradePanelDescription = $state<string | undefined>(undefined);
let searchLimitExceededOpen = $state(false);
let searchLimitError = $state<{ remaining?: number; requested?: number; limit?: number } | null>(null);
let findMorePopupOpen = $state(false);
let pendingExcludeProfileUrls = $state<string[]>([]);
let isFindMoreMode = $state(false);
let previousPipelineProfiles = $state<InfluencerProfile[]>([]);
let prefilledData = $state<{ brand?: string; website?: string; about?: string; influencerType?: string } | null>(null);

// Derived helpers
const effectiveCampaign = $derived(localCampaign ?? campaign ?? null);
const isPageLoaded = $derived(!browser || campaign !== null);
const effectivePipelineId = $derived(effectiveCampaign?.pipeline_id ?? temporaryPipelineId ?? null);

// Sync localCampaign when server data changes
$effect(() => {
  if (campaign && localCampaign?.id !== campaign.id) {
    localCampaign = campaign;
  } else if (!campaign) {
    localCampaign = null;
  }
});

// Search submission
async function handleSearchFormSubmit(event?: SubmitEvent, params?: SearchParams) {
  if (event) event.preventDefault();
  if (isSearchFormSubmitting) return;

  const description = (params?.business_description ?? influencerSummary).trim();
  if (!description) return;
  influencerSummary = description;

  isSearchFormSubmitting = true;
  try {
    const targetCampaignId = params?.campaign_id ?? campaign?.id ?? routeCampaignId ?? null;
    const response = await fetch('/api/search/influencers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_description: description,
        top_n: params?.top_n ?? searchFormTopN,
        min_followers: params?.min_followers ?? searchFormMinFollowers,
        max_followers: params?.max_followers ?? searchFormMaxFollowers,
        campaign_id: targetCampaignId,
        strict_location_matching: params?.strict_location_matching ?? false
      })
    });

    const responseData = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errorInfo = (responseData as any).error || responseData;
      if (errorInfo?.code === 'SEARCH_LIMIT_EXCEEDED' && errorInfo.details) {
        searchLimitError = {
          remaining: errorInfo.details.remaining ?? 0,
          requested: errorInfo.details.requested ?? searchFormTopN,
          limit: errorInfo.details.limit ?? 0
        };
        searchLimitExceededOpen = true;
        isSearchFormSubmitting = false;
        return;
      }
      throw new Error(errorInfo?.message || `Search failed: ${response.status}`);
    }

    const data = (responseData as any).data ?? responseData;
    if (data.job_id) {
      const baseCampaign = localCampaign ?? campaign;
      if (baseCampaign) {
        localCampaign = { ...baseCampaign, pipeline_id: data.job_id, updatedAt: Date.now() };
      }
      temporaryPipelineId = data.job_id;
    }
  } catch (error) {
    if (!searchLimitExceededOpen) {
      alert(error instanceof Error ? error.message : 'An unexpected error occurred');
    }
  } finally {
    isSearchFormSubmitting = false;
  }
}

function closeSearchLimitPanel() {
  searchLimitExceededOpen = false;
  searchLimitError = null;
}

// Pipeline listener - uses Svelte's effect cleanup for proper lifecycle management
$effect(() => {
  const pipelineId = effectivePipelineId;
  const authReady = $firebaseAuthReady;

  // Reset state when pipeline changes
  pipelineStatus = null;
  pipelineError = null;

  // Wait for auth and pipeline ID
  if (!authReady || !pipelineId) return;

  let loadedProfilesForPipeline: string | null = null;

  // Fetch profiles via API (avoids CORS issues with direct storage access)
  const loadProfiles = async () => {
    if (loadedProfilesForPipeline === pipelineId) return;
    try {
      const response = await fetch(`/api/pipeline/${pipelineId}`);
      if (response.ok) {
        const data = await response.json();
        const profiles = Array.isArray(data.profiles)
          ? data.profiles.map((p: any) => ({ ...p, _id: p._id || getProfileId(p) }))
          : [];
        const preliminaryCandidates = Array.isArray(data.preliminary_candidates)
          ? data.preliminary_candidates.map((p: any) => ({ ...p, _id: p._id || getProfileId(p) }))
          : [];
        pipelineStatus = {
          ...pipelineStatus,
          profiles,
          preliminary_candidates: preliminaryCandidates,
          is_progressive: data.is_progressive ?? false,
        } as PipelineStatus;
        loadedProfilesForPipeline = pipelineId;
      }
    } catch {
      // Will retry on next snapshot
    }
  };

  // Set up Firestore listener
  const pipelineDocRef = doc(firebaseFirestore, 'pipeline_jobs', pipelineId);
  let docNotFoundCount = 0;

  const unsubscribe = onSnapshot(
    pipelineDocRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        docNotFoundCount++;
        if (docNotFoundCount >= 10) {
          pipelineError = { code: 'PIPELINE_NOT_FOUND', message: 'Pipeline not found', pipelineId };
        } else {
          pipelineStatus = {
            status: 'pending',
            overall_progress: 0,
            current_stage: null,
            completed_stages: [],
            profiles_count: 0,
            profiles: [],
            stages: {}
          } as PipelineStatus;
        }
        return;
      }

      docNotFoundCount = 0;
      pipelineError = null;
      const data = snapshot.data();

      // Load profiles when available (including Weaviate candidates)
      if ((data.profiles_count ?? 0) > 0 ||
          (data.progressive_profiles_count ?? 0) > 0 ||
          (data.weaviate_search?.candidates_count ?? 0) > 0) {
        void loadProfiles();
      }

      // Update status, preserving loaded profiles and preliminary candidates
      pipelineStatus = {
        ...data,
        profiles: pipelineStatus?.profiles ?? [],
        preliminary_candidates: pipelineStatus?.preliminary_candidates ?? [],
        is_progressive: pipelineStatus?.is_progressive ?? false,
      } as PipelineStatus;
    },
    (error) => {
      pipelineError = { code: 'LISTENER_ERROR', message: error.message, pipelineId };
    }
  );

  // Cleanup: Svelte calls this when effect re-runs or component unmounts
  return () => {
    unsubscribe();
  };
});

onMount(() => {
  if (!browser) return;
  void loadSearchUsage();

  // Firebase auth is synced by the layout - we just use the store
  let unsubscribeCampaign: (() => void) | null = null;
  const setupCampaignListener = () => {
    const currentUser = firebaseAuth.currentUser;
    const campaignId = routeCampaignId;
    if (!currentUser || !campaignId) return;
    if (unsubscribeCampaign) {
      unsubscribeCampaign();
      unsubscribeCampaign = null;
    }
    const campaignDocRef = doc(firebaseFirestore, 'users', currentUser.uid, 'campaigns', campaignId);
    unsubscribeCampaign = onSnapshot(
      campaignDocRef,
      (snapshot) => {
        if (!snapshot.exists()) return;
        if (campaignId !== routeCampaignId) return;
        const dataSnapshot = snapshot.data();
        const updatedPipelineId = typeof dataSnapshot?.pipeline_id === 'string' ? dataSnapshot.pipeline_id : null;
        const baseCampaign = localCampaign ?? campaign;
        if (!baseCampaign || baseCampaign.id !== campaignId) return;
        const currentPipelineId = baseCampaign.pipeline_id ?? null;
        if (updatedPipelineId !== currentPipelineId) {
          localCampaign = { ...baseCampaign, pipeline_id: updatedPipelineId };
          if (temporaryPipelineId === updatedPipelineId) temporaryPipelineId = null;
        }
      },
      () => {
        // Campaign listener error - silent fail, will use server data
      }
    );
  };

  const unsubscribeAuth = onAuthStateChanged(firebaseAuth, (user) => {
    if (user) setupCampaignListener();
  });
  if (firebaseAuth.currentUser) setupCampaignListener();

  return () => {
    if (unsubscribeCampaign) unsubscribeCampaign();
    if (unsubscribeAuth) unsubscribeAuth();
  };
});

// Load search usage from API
async function loadSearchUsage() {
  try {
    const response = await fetch('/api/usage');
    if (response.ok) {
      const result = await response.json();
      const data = (result as any).data ?? result;
      searchUsage = data.influencersFound ?? data;
    }
  } catch (error) {
    console.error('Failed to load usage:', error);
  }
}

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

function openFindMorePopup(excludeProfileUrls: string[]) {
  pendingExcludeProfileUrls = excludeProfileUrls;
  findMorePopupOpen = true;
}

function closeFindMorePopup() {
  findMorePopupOpen = false;
  pendingExcludeProfileUrls = [];
}

function remainingInfluencerAllowance() {
  return Math.max(searchUsage?.remaining ?? 0, 0);
}

function currentInfluencerCount() {
  return pipelineStatus?.profiles?.length ?? 0;
}

async function handleFindMoreConfirm(additionalCount: number) {
  if (isSearchFormSubmitting) return;
  if (remainingInfluencerAllowance() <= 0) {
    openUpgradePanel('Upgrade to find more influencers', 'You have no influencer searches remaining. Upgrade to unlock more results.');
    return;
  }
  const allowedCount = Math.min(additionalCount, remainingInfluencerAllowance());
  findMorePopupOpen = false;
  previousPipelineProfiles = pipelineStatus?.profiles ?? [];
  isFindMoreMode = true;

  const description = influencerSummary.trim();
  if (!description) return;
  isSearchFormSubmitting = true;
  try {
    const currentCampaignId = campaign?.id ?? routeCampaignId ?? null;
    const response = await fetch('/api/search/influencers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_description: description,
        top_n: allowedCount,
        min_followers: searchFormMinFollowers,
        max_followers: searchFormMaxFollowers,
        campaign_id: currentCampaignId,
        exclude_profile_urls: pendingExcludeProfileUrls
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'Failed to find more influencers');

    if (data.job_id) {
      const baseCampaign = localCampaign ?? campaign;
      if (baseCampaign) {
        localCampaign = { ...baseCampaign, pipeline_id: data.job_id, updatedAt: Date.now() };
      }
      temporaryPipelineId = data.job_id;
    }
  } catch (error) {
    if (!searchLimitExceededOpen) {
      alert(error instanceof Error ? error.message : 'An unexpected error occurred');
    }
  } finally {
    isSearchFormSubmitting = false;
    pendingExcludeProfileUrls = [];
  }
}

// Merge new profiles after find-more completes
$effect(() => {
  if (isFindMoreMode && pipelineStatus?.status === 'completed' && pipelineStatus.profiles?.length) {
    const existingUrls = new Set(previousPipelineProfiles.map((p) => p.profile_url?.toLowerCase()).filter(Boolean));
    const newProfiles = pipelineStatus.profiles.filter((p) => {
      const url = p.profile_url?.toLowerCase();
      return url && !existingUrls.has(url);
    });
    pipelineStatus = { ...pipelineStatus, profiles: [...previousPipelineProfiles, ...newProfiles] } as PipelineStatus;
    isFindMoreMode = false;
    previousPipelineProfiles = [];
  }
});
</script>

<svelte:head>
  <title>{campaign?.title ?? 'Campaign'} – Penni AI</title>
</svelte:head>

<div style="display: flex; flex-direction: column; width: 100%; height: 100%; position: relative; overflow: hidden;">
  <CampaignLoadingCover isLoading={browser && !isPageLoaded} />

  <div style="flex: 1; width: 100%; height: 100%; overflow: hidden;">
    <SimplePipelinePanel
      campaignId={routeCampaignId ?? null}
      {effectiveCampaign}
      {pipelineStatus}
      {pipelineError}
      {searchUsage}
      {influencerSummary}
      {searchFormTopN}
      {searchFormMinFollowers}
      {searchFormMaxFollowers}
      {isSearchFormSubmitting}
      maxInfluencers={1000}
      user={data.user}
      {prefilledData}
      onSubmit={(params) => void handleSearchFormSubmit(undefined, params)}
      onFindMore={openFindMorePopup}
      onWebsitePrefill={async (websiteUrl: string) => {
        const response = await fetch('/api/campaigns/prefill-from-website', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ websiteUrl })
        });
        if (!response.ok) {
          throw new Error(await response.text() || 'Failed to analyze website');
        }
        const data = await response.json();
        prefilledData = {
          brand: data.brand || '',
          website: data.website || '',
          about: data.about || '',
          influencerType: data.influencerType || ''
        };
        return prefilledData;
      }}
    />
  </div>

  <UpgradeModal
    open={upgradePanelOpen}
    onClose={closeUpgradePanel}
    returnUrl={`/campaign/${routeCampaignId ?? ''}`}
    title={upgradePanelTitle ?? 'Choose your plan'}
    description={upgradePanelDescription ?? 'Scale your influencer outreach with the right plan for your needs.'}
    showFreePlan={true}
    dismissible={true}
    currentPlanKey={($page.data as any).user?.currentPlan?.planKey ?? 'free'}
  />

  <SearchLimitExceededPanel
    open={searchLimitExceededOpen}
    onClose={closeSearchLimitPanel}
    onUpgrade={() => openUpgradePanel(
      "You're out of influencer search usage",
      "You've reached your monthly search limit. Upgrade your plan to get more searches and continue finding influencers."
    )}
    remaining={searchLimitError?.remaining}
    requested={searchLimitError?.requested}
    limit={searchLimitError?.limit}
  />

  <FindMorePopup
    open={findMorePopupOpen}
    currentCount={currentInfluencerCount()}
    maxRemaining={remainingInfluencerAllowance()}
    isSearching={isSearchFormSubmitting}
    onConfirm={handleFindMoreConfirm}
    onCancel={closeFindMorePopup}
  />
</div>
