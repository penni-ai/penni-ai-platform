<script lang="ts">
import { onMount } from 'svelte';
import { page } from '$app/stores';
import { browser } from '$app/environment';
import SimplePipelinePanel from '$lib/components/campaign/SimplePipelinePanel.svelte';
import OutreachUpgradePanel from '$lib/components/OutreachUpgradePanel.svelte';
import SearchLimitExceededPanel from '$lib/components/SearchLimitExceededPanel.svelte';
import CampaignLoadingCover from '$lib/components/campaign/CampaignLoadingCover.svelte';
import FindMorePopup from '$lib/components/campaign/FindMorePopup.svelte';
import type { PageData } from './$types';
import { firebaseFirestore, firebaseAuth } from '$lib/firebase/client';
import { doc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import type { SerializedCampaign } from '$lib/server/campaigns';
import type {
  ApiMessage,
  ConversationResponse,
  PipelineStatus,
  SearchParams,
  SearchUsage,
  InfluencerProfile,
  CollectedData,
  FollowerRange
} from '$lib/types/campaign';
import { getProfileId, normalizePlatforms } from '$lib/utils/campaign';

const SHOW_CHAT = false; // Frontend chat disabled; backend chat APIs remain

// Page data
let { data }: { data: PageData } = $props();
const campaign = $derived(data.campaign);
const routeCampaignId = $derived($page.params.id);

// Keep a mutable local copy of campaign for optimistic updates
let localCampaign = $state<SerializedCampaign | null>(null);

// Conversation state
let campaignId = $state<string | null>(null);
let messages = $state<ApiMessage[]>([]);
let draft = $state('');
let collected = $state<CollectedData>({});
let followerRange = $state<FollowerRange>({ min: null, max: null });
let conversationStatus = $state<'collecting' | 'ready' | 'searching' | 'complete' | 'needs_config' | 'error'>('collecting');
let isInitializing = $state(true);
let isSending = $state(false);
let initError = $state<string | null>(null);
let chatError = $state<string | null>(null);
let hasLoadedConversation = $state(false);
const textDecoder = new TextDecoder();
let messagesContainer: HTMLDivElement | null = null;
let scrollTimeoutId: ReturnType<typeof setTimeout> | null = null;

// Influencer search form state
let influencerSummary = $state('');
let searchFormTopN = $state(10);
let searchFormMinFollowers = $state<number | null>(null);
let searchFormMaxFollowers = $state<number | null>(null);
let isSearchFormSubmitting = $state(false);

// Search usage limits
let searchUsage = $state<SearchUsage | null>(null);

// Pipeline state
let pipelineStatus = $state<PipelineStatus | null>(null);
let pipelineError = $state<{ code: string; message: string; pipelineId: string } | null>(null);
let pipelinePollInterval: ReturnType<typeof setInterval> | null = null;
let manualRefreshInterval: ReturnType<typeof setInterval> | null = null;
let currentPollingPipelineId = $state<string | null>(null);
let temporaryPipelineId = $state<string | null>(null);
let pipelineCreationTimestamps = $state<Map<string, { createdAt: number; attemptCount: number }>>(new Map());
let lastApiSetPipelineId = $state<{ pipelineId: string; timestamp: number } | null>(null);
let unsubscribePipelineJob: (() => void) | null = null;
let lastSeenPipelineId = $state<string | null>(null);
let lastRouteCampaignId = $state<string | null>(null);

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

// Derived helpers
const effectiveCampaign = $derived(localCampaign ?? campaign ?? null);
const currentPlanKey = $derived(data.user?.currentPlan?.planKey ?? null);
const isPageLoaded = $derived(() => !browser || campaign !== null);

function effectivePipelineId() {
  return effectiveCampaign?.pipeline_id ?? temporaryPipelineId ?? null;
}

function maxInfluencers() {
  return currentPlanKey === 'free' || currentPlanKey === null ? 10 : 50;
}

$effect(() => {
  if (campaign) {
    if (localCampaign?.id !== campaign.id) {
      localCampaign = campaign;
    }
  } else {
    localCampaign = null;
  }
});

// Basic helpers
function addUserMessage(id: string, content: string) {
  messages = [
    ...messages,
    {
      id,
      role: 'user',
      content,
      type: 'text',
      createdAt: new Date().toISOString()
    }
  ];
}

function addAssistantPlaceholder(id: string) {
  messages = [
    ...messages,
    {
      id,
      role: 'assistant',
      content: '',
      type: 'text',
      createdAt: new Date().toISOString()
    }
  ];
}

function updateAssistantPlaceholder(id: string, content: string) {
  messages = messages.map((message) => (message.id === id ? { ...message, content } : message));
}

function removeMessageById(id: string) {
  messages = messages.filter((message) => message.id !== id);
}

function scrollToBottom() {
  if (scrollTimeoutId) clearTimeout(scrollTimeoutId);
  scrollTimeoutId = setTimeout(() => {
    if (!messagesContainer) return;
    const start = messagesContainer.scrollTop;
    const target = messagesContainer.scrollHeight;
    const distance = target - start;
    const duration = Math.min(800, Math.max(300, Math.abs(distance) * 0.5));
    const startTime = performance.now();
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const animate = (time: number) => {
      const progress = Math.min((time - startTime) / duration, 1);
      messagesContainer!.scrollTop = start + distance * easeOutCubic(progress);
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
    scrollTimeoutId = null;
  }, 30);
}

// Conversation load
async function loadConversation(campId: string) {
  isInitializing = true;
  initError = null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`/api/chat/${campId}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`Failed to load conversation (${response.status})`);
    const data = (await response.json()) as ConversationResponse;
    applyConversationSnapshot(data);
    hasLoadedConversation = true;
  } catch (error) {
    clearTimeout(timeoutId);
    initError = error instanceof Error ? error.message : 'Failed to load conversation';
    hasLoadedConversation = false;
  } finally {
    isInitializing = false;
  }
}

function applyConversationSnapshot(data: ConversationResponse) {
  campaignId = data.conversation.id;
  messages = data.conversation.messages;
  collected = data.conversation.collected ?? {};
  followerRange = data.conversation.followerRange ?? { min: null, max: null };
  conversationStatus = data.conversation.status;

  if (data.conversation.status === 'ready' || data.conversation.status === 'complete') {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'assistant' && lastMessage.content) {
        const summaryMatch = lastMessage.content.match(/All required slots filled[^\n]*\n\n([\s\S]*)/);
        if (summaryMatch && summaryMatch[1]) {
          influencerSummary = summaryMatch[1].trim();
        }
      }
    }

    if (collected) {
      const parts: string[] = [];
      if (collected.business_name) parts.push(collected.business_name);
      if (collected.business_about) parts.push(collected.business_about);
      if (collected.website) parts.push(`Website: ${collected.website}`);
      const influencerParts: string[] = [];
      if (collected.type_of_influencer) influencerParts.push(collected.type_of_influencer);
      const platforms = normalizePlatforms(collected.platform);
      if (platforms.length) influencerParts.push(`on ${platforms.join(' and ')}`);
      if (collected.influencer_location) influencerParts.push(`in ${collected.influencer_location}`);
      if (followerRange.min !== null || followerRange.max !== null) {
        const followerStr =
          followerRange.min !== null && followerRange.max !== null
            ? `${followerRange.min}-${followerRange.max}`
            : followerRange.min !== null
              ? `${followerRange.min}+`
              : `up to ${followerRange.max}`;
        influencerParts.push(`with ${followerStr} followers`);
      }
      if (influencerParts.length) parts.push(`Looking for ${influencerParts.join(' ')}`);
      if (parts.length) {
        const generated = parts.join('. ');
        if (!influencerSummary) influencerSummary = generated;
        else if (!influencerSummary.includes(generated)) influencerSummary = `${influencerSummary}. ${generated}`;
      }
    }
    if (!influencerSummary) influencerSummary = 'Ready to search for influencers matching your campaign criteria.';
    if (followerRange.min !== null) searchFormMinFollowers = followerRange.min;
    if (followerRange.max !== null) searchFormMaxFollowers = followerRange.max;
  }
}

// Streaming send
async function sendStreamingMessage(value: string) {
  if (!campaignId) throw new Error('Campaign not initialized');
  const userMessageId = crypto.randomUUID();
  addUserMessage(userMessageId, value);
  isSending = true;

  const placeholderId = crypto.randomUUID();
  let assistantBuffer = '';
  let buffer = '';
  let hasPlaceholder = false;

  const processEvent = (eventType: string, data: string) => {
    if (eventType === 'delta') {
      const payload = JSON.parse(data) as { delta: string };
      if (!hasPlaceholder) {
        addAssistantPlaceholder(placeholderId);
        hasPlaceholder = true;
      }
      assistantBuffer += payload.delta ?? '';
      updateAssistantPlaceholder(placeholderId, assistantBuffer);
    } else if (eventType === 'final') {
      const payload = JSON.parse(data) as { conversation: ConversationResponse['conversation'] };
      if (hasPlaceholder) {
        removeMessageById(placeholderId);
        hasPlaceholder = false;
      }
      applyConversationSnapshot({ conversation: payload.conversation } as ConversationResponse);
    } else if (eventType === 'error') {
      const payload = JSON.parse(data) as { message?: string };
      chatError = payload.message ?? 'Assistant stream failed';
      throw new Error(chatError);
    }
  };

  const parseBuffer = () => {
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (!rawEvent.trim() || rawEvent.startsWith(':')) continue;
      const lines = rawEvent.split('\n');
      let eventType = 'message';
      let data = '';
      for (const line of lines) {
        if (line.startsWith('event:')) eventType = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data) processEvent(eventType, data);
    }
  };

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    const response = await fetch(`/api/chat/${campaignId}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: value })
    });
    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new Error(errorText || `Assistant error (${response.status})`);
    }
    reader = response.body.getReader();
    while (true) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      buffer += textDecoder.decode(chunk, { stream: true });
      parseBuffer();
    }
    buffer += textDecoder.decode();
    parseBuffer();
    if (hasPlaceholder) removeMessageById(placeholderId);
  } catch (error) {
    if (hasPlaceholder) removeMessageById(placeholderId);
    removeMessageById(userMessageId);
    throw error;
  } finally {
    if (reader) {
      try {
        reader.releaseLock();
      } catch (e) {
        console.warn('Failed to release reader lock', e);
      }
    }
    isSending = false;
  }
}

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
        lastApiSetPipelineId = { pipelineId: data.job_id, timestamp: Date.now() };
      }
      temporaryPipelineId = data.job_id;
      pipelineCreationTimestamps.set(data.job_id, { createdAt: Date.now(), attemptCount: 0 });
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

// Pipeline helpers
async function loadPipelineStatus(pipelineId: string) {
  const creationInfo = pipelineCreationTimestamps.get(pipelineId);
  if (creationInfo) creationInfo.attemptCount += 1;

  try {
    const response = await fetch(`/api/pipeline/${pipelineId}`);
    if (response.ok) {
      pipelineError = null;
      const result = await response.json();
      const data = result.data || result;
      if (Array.isArray(data.profiles)) {
        data.profiles = data.profiles.map((profile: any) => ({ ...profile, _id: profile._id || getProfileId(profile) }));
      }
      if (Array.isArray(data.preliminary_candidates)) {
        data.preliminary_candidates = data.preliminary_candidates.map((candidate: any) => ({
          ...candidate,
          _id: candidate._id || getProfileId(candidate)
        }));
      }

      if (data.preliminary_candidates && data.preliminary_candidates.length > 0 && data.profiles && data.profiles.length > 0) {
        const completedProfilesMap = new Map<string, any>();
        data.profiles.forEach((profile: any) => completedProfilesMap.set(profile._id || getProfileId(profile), profile));
        data.preliminary_candidates = data.preliminary_candidates.map((candidate: any) => {
          const candidateId = candidate._id || getProfileId(candidate);
          const completedProfile = completedProfilesMap.get(candidateId);
          return completedProfile ? { ...candidate, ...completedProfile, _id: candidateId } : candidate;
        });
      }

      pipelineStatus = data;
      pipelineCreationTimestamps.delete(pipelineId);
    } else {
      const errorData = await response.json().catch(() => ({ message: 'Failed to load pipeline status' }));
      const errorCode = errorData?.error?.code || errorData?.code || 'UNKNOWN_ERROR';
      const errorMessage = errorData?.error?.message || errorData?.message || 'Failed to load pipeline status';
      pipelineError = { code: errorCode, message: errorMessage, pipelineId };
    }
  } catch (error) {
    pipelineError = {
      code: 'NETWORK_ERROR',
      message: error instanceof Error ? error.message : 'Failed to load pipeline status',
      pipelineId
    };
  }
}

function startPipelinePolling(pipelineId: string) {
  if (pipelinePollInterval) {
    clearInterval(pipelinePollInterval);
    pipelinePollInterval = null;
  }
  currentPollingPipelineId = pipelineId;
  pipelineError = null;
  const pollInterval = 5000;
  pipelinePollInterval = setInterval(async () => {
    if (currentPollingPipelineId !== pipelineId) return;
    await loadPipelineStatus(pipelineId);
    const status = pipelineStatus?.status;
    const isTerminal = status === 'completed' || status === 'error' || status === 'cancelled';
    if (isTerminal || pipelineError?.code === 'PIPELINE_NOT_FOUND' || pipelineError?.code === 'PIPELINE_FORBIDDEN') {
      clearInterval(pipelinePollInterval!);
      pipelinePollInterval = null;
      currentPollingPipelineId = null;
    }
  }, pollInterval);
}

// Effects
$effect(() => {
  const pipelineId = effectivePipelineId();
  const previousPipelineId = lastSeenPipelineId;
  lastSeenPipelineId = pipelineId;

  if (pipelinePollInterval && pipelineId !== previousPipelineId) {
    clearInterval(pipelinePollInterval);
    pipelinePollInterval = null;
  }

  if (pipelineId && pipelineId !== previousPipelineId) {
    pipelineStatus = null;
    pipelineError = null;
    void loadPipelineStatus(pipelineId);
    startPipelinePolling(pipelineId);
  }
});

$effect(() => {
  if (manualRefreshInterval) {
    clearInterval(manualRefreshInterval);
    manualRefreshInterval = null;
  }
  const pipelineId = effectivePipelineId();
  if (pipelineId && !(pipelineStatus?.status === 'completed' || pipelineStatus?.status === 'error' || pipelineStatus?.status === 'cancelled')) {
    manualRefreshInterval = setInterval(() => {
      if (effectivePipelineId() === pipelineId) void loadPipelineStatus(pipelineId);
    }, 5000);
  }
  return () => {
    if (manualRefreshInterval) {
      clearInterval(manualRefreshInterval);
      manualRefreshInterval = null;
    }
  };
});

// Clear pipeline state when campaign changes
$effect(() => {
  const currentId = routeCampaignId ?? null;
  if (currentId !== lastRouteCampaignId) {
    lastRouteCampaignId = currentId;
    pipelineStatus = null;
    pipelineError = null;
    currentPollingPipelineId = null;
    temporaryPipelineId = null;
    pipelineCreationTimestamps.clear();
    if (pipelinePollInterval) {
      clearInterval(pipelinePollInterval);
      pipelinePollInterval = null;
    }
    if (manualRefreshInterval) {
      clearInterval(manualRefreshInterval);
      manualRefreshInterval = null;
    }
    if (unsubscribePipelineJob) {
      try { unsubscribePipelineJob(); } catch (error) { console.warn('[pipeline] cleanup listener on route change', error); }
      unsubscribePipelineJob = null;
    }
  }
});

onMount(() => {
  if (!browser) return;
  void loadSearchUsage();

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
        const data = snapshot.data();
        const updatedPipelineId = typeof data?.pipeline_id === 'string' ? data.pipeline_id : null;
        const baseCampaign = localCampaign ?? campaign;
        if (!baseCampaign || baseCampaign.id !== campaignId) return;
        const currentPipelineId = baseCampaign.pipeline_id ?? null;
        const recentlySetFromApi =
          lastApiSetPipelineId && Date.now() - lastApiSetPipelineId.timestamp < 5000 && currentPipelineId === lastApiSetPipelineId.pipelineId;
        if (updatedPipelineId !== currentPipelineId) {
          if (recentlySetFromApi && lastApiSetPipelineId && updatedPipelineId !== lastApiSetPipelineId.pipelineId) {
            return; // keep API-set value
          }
          localCampaign = { ...baseCampaign, pipeline_id: updatedPipelineId };
          if (temporaryPipelineId === updatedPipelineId) temporaryPipelineId = null;
          lastApiSetPipelineId = null;
        }
      },
      (error) => {
        console.error('[campaign] Failed to listen to campaign updates', error);
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
      searchUsage = (result as any).data ?? result;
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
        lastApiSetPipelineId = { pipelineId: data.job_id, timestamp: Date.now() };
      }
      temporaryPipelineId = data.job_id;
      pipelineCreationTimestamps.set(data.job_id, { createdAt: Date.now(), attemptCount: 0 });
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
    const merged = [...previousPipelineProfiles, ...newProfiles];
    pipelineStatus = { ...pipelineStatus, profiles: merged } as PipelineStatus;
    isFindMoreMode = false;
    previousPipelineProfiles = [];
  }
});

// Load conversation when campaign changes
$effect(() => {
  const currentCampaignId = routeCampaignId;
  if (currentCampaignId && (!hasLoadedConversation || campaignId !== currentCampaignId)) {
    campaignId = null;
    messages = [];
    collected = {};
    followerRange = { min: null, max: null };
    hasLoadedConversation = false;
    void loadConversation(currentCampaignId);
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
      influencerSummary={influencerSummary}
      searchFormTopN={searchFormTopN}
      searchFormMinFollowers={searchFormMinFollowers}
      searchFormMaxFollowers={searchFormMaxFollowers}
      {isSearchFormSubmitting}
      maxInfluencers={maxInfluencers()}
      onSubmit={(params) => void handleSearchFormSubmit(undefined, params)}
      onFindMore={openFindMorePopup}
    />
  </div>

  <OutreachUpgradePanel
    open={upgradePanelOpen}
    onClose={closeUpgradePanel}
    returnUrl={`/campaign/${routeCampaignId ?? ''}`}
    title={upgradePanelTitle}
    description={upgradePanelDescription}
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
