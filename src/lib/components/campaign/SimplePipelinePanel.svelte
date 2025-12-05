<script lang="ts">
import { browser } from '$app/environment';
import { fly, fade } from 'svelte/transition';
import Button from '$lib/components/Button.svelte';
import PipelineStatusComponent from './PipelineStatus.svelte';
import InfluencersTable from './InfluencersTable.svelte';
import SendOutreachPopupPanel from '$lib/components/outreach/SendOutreachPopupPanel.svelte';
import EmailDraftPrompt from './EmailDraftPrompt.svelte';
import EmailEditor from '$lib/components/EmailEditor.svelte';
import InboxManagementPopup from './InboxManagementPopup.svelte';
import { getProfileId } from '$lib/utils/campaign';
import type { PipelineStatus, SearchParams, SearchUsage, InfluencerProfile } from '$lib/types/campaign';
import type { SerializedCampaign } from '$lib/server/campaigns';

  interface Props {
    effectiveCampaign: SerializedCampaign | null;
    pipelineStatus: PipelineStatus | null;
    pipelineError?: { code: string; message: string; pipelineId: string } | null;
    searchUsage: SearchUsage | null;
    campaignId: string | null;
    influencerSummary: string;
    searchFormTopN: number;
    searchFormMinFollowers: number | null;
    searchFormMaxFollowers: number | null;
    isSearchFormSubmitting: boolean;
    maxInfluencers: number;
    user?: { uid: string; email: string | null; currentPlan: any; capabilities: any } | null;
    prefilledData?: { brand?: string; website?: string; about?: string; influencerType?: string } | null;
    onSubmit: (params: SearchParams) => void;
    onRerun?: () => void;
    onFindMore?: (excludeProfileUrls: string[]) => void; // For "Find More Influencers" functionality
    onSendAll?: () => void;
    onReopenWebsitePrefill?: () => void; // For reopening website prefill popup
  }

  let {
    effectiveCampaign,
    pipelineStatus,
    pipelineError = null,
    searchUsage,
    influencerSummary,
    searchFormTopN,
    searchFormMinFollowers,
    searchFormMaxFollowers,
    isSearchFormSubmitting,
    maxInfluencers,
    campaignId,
    user = null,
    prefilledData = null,
    onSubmit,
    onRerun,
    onFindMore,
    onSendAll,
    onReopenWebsitePrefill
  }: Props = $props();

  // Derived: Check if user has premium features (growth or event plan)
  const isPremiumUser = $derived(() => {
    const planKey = user?.currentPlan?.planKey ?? user?.capabilities?.planKey ?? null;
    return planKey === 'growth' || planKey === 'event';
  });

  let brand = $state('');
  let website = $state('');
  let about = $state('');
  let influencerType = $state('');
  let platforms = $state('Instagram, TikTok');
  let selectedPlatforms = $state<string[]>(['Instagram', 'TikTok']);
  let location = $state('US');

  let minFollowersLocal = $state<number | null>(10000);
  let maxFollowersLocal = $state<number | null>(500000);
  let topNLocal = $state(searchFormTopN || 10);
  let strictLocationMatching = $state(true);
  let hasAutoAdvanced = $state(false); // Track if we've auto-advanced from website prefill

  // Non-linear slider position (0-100)
  let sliderPosition = $state(0);

  // Calculate effective max for the slider (respects remaining count)
  const effectiveMaxInfluencers = $derived(() => {
    return Math.min(searchUsage?.remaining ?? maxInfluencers, maxInfluencers);
  });

  // Convert slider position (0-100) to topN value (10 to effectiveMax)
  // First half (0-50) maps to 10-100
  // Second half (50-100) maps to 100-effectiveMax
  function positionToTopN(position: number): number {
    const max = effectiveMaxInfluencers();

    if (position <= 50) {
      // First half: 10-100
      return Math.round(10 + (position / 50) * 90);
    } else {
      // Second half: 100-max
      const remaining = max - 100;
      return Math.round(100 + ((position - 50) / 50) * remaining);
    }
  }

  // Convert topN value to slider position (0-100)
  function topNToPosition(topN: number): number {
    const max = effectiveMaxInfluencers();

    if (topN <= 100) {
      // First half: 10-100 maps to 0-50
      return ((topN - 10) / 90) * 50;
    } else {
      // Second half: 100-max maps to 50-100
      const remaining = max - 100;
      if (remaining <= 0) return 50;
      return 50 + ((topN - 100) / remaining) * 50;
    }
  }

  // Initialize slider position from topNLocal and ensure topNLocal doesn't exceed max
  $effect(() => {
    const max = effectiveMaxInfluencers();
    // Cap topNLocal at the effective max
    if (topNLocal > max) {
      topNLocal = max;
    }
    // Update slider position to match topNLocal
    sliderPosition = topNToPosition(topNLocal);
  });

  // Update topNLocal when slider position changes
  function handleSliderChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const position = Number(target.value);
    sliderPosition = position;
    const newValue = positionToTopN(position);
    const max = effectiveMaxInfluencers();
    // Ensure we don't exceed the max
    topNLocal = Math.min(newValue, max);
    scheduleAutosave();
  }

  // Apply prefilled data when provided
  $effect(() => {
    if (prefilledData) {
      if (prefilledData.brand) brand = prefilledData.brand;
      if (prefilledData.website) website = prefilledData.website;
      if (prefilledData.about) about = prefilledData.about;
      if (prefilledData.influencerType) influencerType = prefilledData.influencerType;

      // Auto-advance to step 1 when website is provided (only once)
      if (prefilledData.website && step === 0 && !hasAutoAdvanced) {
        step = 1;
        hasAutoAdvanced = true;
      }
    }
  });

  // Outreach + Gmail + template state (simple view)
  type GmailConnection = { id: string; email: string; primary?: boolean | null };
  let gmailConnections = $state<GmailConnection[]>([]);
  let isLoadingGmail = $state(false);
  let gmailError: string | null = $state(null);
  let gmailLoadedCampaignId: string | null = $state(null);
  let showConnectGmailPrompt = $state(false);
  let promptedGmailPipelineId: string | null = $state(null);
  const gmailConnected = $derived(gmailConnections.length > 0);
  const primaryGmail = $derived(() => gmailConnections.find((c) => c.primary) ?? gmailConnections[0] ?? null);
  let inboxPopupOpen = $state(false);

  let emailTemplate = $state('');
  let templateLastSavedAt: number | null = $state(null);
  let templateSaving = $state(false);
  let templateError: string | null = $state(null);
let templateWarning: string | null = $state(null);
let templateLoadedCampaignId: string | null = $state(null);
let lastPipelineId: string | null = $state(null);
let connectAccountType = $state<'draft' | 'send'>('draft');
  const templateKey = () => {
    const id = campaignId ?? effectiveCampaign?.id ?? '';
    return `simpleEmailTemplate:${id}`;
  };
  const hasTemplate = $derived(emailTemplate.trim().length > 0);
  const templateSaved = $derived(hasTemplate && templateLastSavedAt !== null);
  let templateJustSaved = $state(false);
  
  function templateStatusText() {
    if (!templateSaved && emailTemplate.trim().length === 0) return 'Not drafted';
    if (templateSaving) return 'Saving…';
    if (templateJustSaved) return '✓ Saved!';
    if (templateSaved) return 'Drafted';
    return 'Draft';
  }

  // Popup / preview state
  let showEmailPopup = $state(false);
  let showDraftPrompt = $state(false);
  let previewPopupOpen = $state(false);
  let draftInFlight = $state(false);
  let draftStatus: string | null = $state(null);
  let draftError: string | null = $state(null);
  let autoPromptedPipelineId: string | null = $state(null);
  let isQuickDrafting = $state(false);
  let quickDraftError: string | null = $state(null);
  let quickDraftRanCampaignId: string | null = $state(null);

  // Selection state for influencers
  let selectedInfluencerIds = $state<Set<string>>(new Set());
  let contactedInfluencerIds = $state<Set<string>>(new Set());
  let showContacted = $state(false);
  let previousProfileIds = $state<Set<string>>(new Set());
  
  const selectedCount = $derived(selectedInfluencerIds.size);
  const allProfiles = $derived((): InfluencerProfile[] => {
    return pipelineStatus?.profiles ?? [];
  });
  
  function toggleInfluencerSelection(id: string) {
    const next = new Set(selectedInfluencerIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selectedInfluencerIds = next;
  }
  
  function selectAllInfluencers() {
    const allIds = allProfiles()
      .filter(p => !contactedInfluencerIds.has(p._id || getProfileId(p)))
      .map(p => p._id || getProfileId(p));
    selectedInfluencerIds = new Set(allIds);
  }
  
  function deselectAllInfluencers() {
    selectedInfluencerIds = new Set();
  }
  
  // Auto-select all influencers when pipeline completes
  let autoSelectedPipelineId: string | null = $state(null);
  $effect(() => {
    const pipelineId = effectiveCampaign?.pipeline_id ?? null;
    const completed = isCompleted();
    const profiles = allProfiles();
    
    if (completed && pipelineId && autoSelectedPipelineId !== pipelineId && profiles.length > 0) {
      autoSelectedPipelineId = pipelineId;
      selectAllInfluencers();
    }
  });

  // Multi-step navigation
  let step = $state(0);
  const steps = [
    'Brand basics',
    'Targets & reach',
    'Premium features'
  ];
  const isLastStep = $derived(step === steps.length - 1);
  const isFirstStep = $derived(step === 0);

  // Autosave state
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  let isSaving = $state(false);
  let saveError: string | null = null;
  let lastPrefillCampaignId: string | null = null;

  const platformOptions = ['TikTok', 'Instagram'];
  const previewProfiles = $derived((): InfluencerProfile[] => {
    const candidates = pipelineStatus?.preliminary_candidates;
    return Array.isArray(candidates) ? candidates.slice(0, 10) : [];
  });

  // Whether we're showing preliminary (pre-analysis) profiles
  const isPreliminaryPreview = $derived(() => {
    return !(pipelineStatus?.profiles && pipelineStatus.profiles.length > 0);
  });

  // Shuffle array using seeded random (consistent per session)
  function shuffleArray<T>(array: T[], seed: number): T[] {
    const shuffled = [...array];
    let currentIndex = shuffled.length;
    let seedValue = seed;
    
    const seededRandom = () => {
      seedValue = (seedValue * 9301 + 49297) % 233280;
      return seedValue / 233280;
    };
    
    while (currentIndex > 0) {
      const randomIndex = Math.floor(seededRandom() * currentIndex);
      currentIndex--;
      [shuffled[currentIndex], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[currentIndex]];
    }
    return shuffled;
  }

  // Rotating seed for preview cycling - changes every 5 seconds
  let previewRotationSeed = $state(0);
  let previewRotationInterval: ReturnType<typeof setInterval> | null = null;
  
  // Start/stop preview rotation based on pipeline status
  $effect(() => {
    const isRunning = pipelineStatus?.status === 'running' && !isCompleted();
    
    if (browser && isRunning) {
      // Start rotation interval
      if (!previewRotationInterval) {
        previewRotationInterval = setInterval(() => {
          previewRotationSeed = (previewRotationSeed + 1) % 1000;
        }, 5000);
      }
    } else {
      // Stop rotation when not running
      if (previewRotationInterval) {
        clearInterval(previewRotationInterval);
        previewRotationInterval = null;
      }
    }
    
    return () => {
      if (previewRotationInterval) {
        clearInterval(previewRotationInterval);
        previewRotationInterval = null;
      }
    };
  });

  // Preview profiles for preliminary (ghosty) display - show random 6, rotating every 5s
  const previewDisplayProfiles = $derived((): InfluencerProfile[] => {
    const candidates = previewProfiles();
    if (candidates.length <= 6) return candidates;
    // Use campaign ID + rotation seed for shuffling
    const baseSeed = (campaignId ?? effectiveCampaign?.id ?? 'default').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const seed = baseSeed + previewRotationSeed * 12345; // Multiply to get more variation
    return shuffleArray(candidates, seed).slice(0, 6);
  });
  
  // For completed results, use the full profiles list
  const displayedProfiles = $derived((): InfluencerProfile[] => {
    if (pipelineStatus?.profiles && pipelineStatus.profiles.length > 0) {
      return pipelineStatus.profiles;
    }
    return previewDisplayProfiles();
  });
  
  // Whether pipeline is completed with results
  const isCompleted = $derived(() => {
    return pipelineStatus?.status === 'completed' && pipelineStatus?.profiles && pipelineStatus.profiles.length > 0;
  });
  
  // Get existing profile URLs for "Find More" exclusion
  const existingProfileUrls = $derived(() => {
    const profiles = pipelineStatus?.profiles ?? [];
    return profiles
      .map(p => p.profile_url)
      .filter((url): url is string => typeof url === 'string' && url.length > 0);
  });
  
  // Handle "Find More Influencers" button click
  function handleFindMore() {
    if (onFindMore && existingProfileUrls().length > 0) {
      onFindMore(existingProfileUrls());
    }
  }

  const recipientsForOutreach = $derived(() =>
    (pipelineStatus?.profiles ?? pipelineStatus?.preliminary_candidates ?? []).filter(
      (p) => p?.email_address || p?.business_email
    )
  );

  const shouldAutoPromptEmail = $derived(() => {
    const pipelineId = effectiveCampaign?.pipeline_id ?? null;
    const qeDone = pipelineStatus?.stages?.query_expansion?.status === 'completed';
    const running = pipelineStatus?.status === 'running';
    const llmStarted = pipelineStatus?.stages?.llm_analysis?.status === 'running' || pipelineStatus?.stages?.llm_analysis?.status === 'completed';
    // Trigger when Weaviate/search (query expansion) is done and before/at category analysis
    return pipelineId && running && qeDone && llmStarted && (!gmailConnected || !templateSaved);
  });

  function setPlatformsFromString(value: string | string[] | null | undefined) {
    const normalized = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(',').map((p) => p.trim())
        : ['Instagram', 'TikTok'];  // Default to capitalized versions

    // Capitalize platform names to match UI options
    const capitalized = normalized.map(p => {
      const lower = p.toLowerCase();
      if (lower === 'instagram') return 'Instagram';
      if (lower === 'tiktok') return 'TikTok';
      return p;
    });

    const list = capitalized.filter(Boolean);
    selectedPlatforms = Array.from(new Set(list));
    platforms = selectedPlatforms.join(', ');
  }

  const hasPipeline = $derived(!!(effectiveCampaign?.pipeline_id || pipelineStatus));

  // Keep selectedPlatforms in sync with freeform platforms string (initial load)
  $effect(() => {
    if (!platforms) {
      selectedPlatforms = ['Instagram', 'TikTok'];
      platforms = 'Instagram, TikTok';
      return;
    }
    const fromString = platforms.split(',').map((p) => p.trim()).filter(Boolean);

    // Capitalize platform names to match UI options
    const capitalized = fromString.map(p => {
      const lower = p.toLowerCase();
      if (lower === 'instagram') return 'Instagram';
      if (lower === 'tiktok') return 'TikTok';
      return p;
    });

    selectedPlatforms = Array.from(new Set(capitalized));
  });

  // Load saved template (per campaign) from localStorage
  $effect(() => {
    if (!browser) return;
    const id = campaignId ?? effectiveCampaign?.id ?? null;
    if (!id || templateLoadedCampaignId === id) return;
    templateLoadedCampaignId = id;
    const saved = localStorage.getItem(templateKey());
    if (saved !== null) {
      emailTemplate = saved;
      templateLastSavedAt = Date.now();
    } else {
      emailTemplate = defaultTemplate();
    }
  });

  // Auto prompt once per pipeline when Weaviate search completes and category analysis starts
  $effect(() => {
    const pipelineId = effectiveCampaign?.pipeline_id ?? null;
    if (shouldAutoPromptEmail() && pipelineId && autoPromptedPipelineId !== pipelineId) {
      autoPromptedPipelineId = pipelineId;
      showDraftPrompt = true;
    }
    if (pipelineStatus?.status === 'completed' || pipelineStatus?.status === 'error') {
      showDraftPrompt = false;
    }
  });

  // Prompt Gmail connect when pipeline starts or category analysis begins
  $effect(() => {
    const pipelineId = effectiveCampaign?.pipeline_id ?? 'session-pipeline';
    const running = pipelineStatus?.status === 'running';
    const categoryRunning = pipelineStatus?.stages?.llm_analysis?.status === 'running';

    // Reset prompt tracking when pipeline changes
    if (pipelineId !== lastPipelineId) {
      lastPipelineId = pipelineId;
      promptedGmailPipelineId = null;
    }

    if (!gmailConnected && pipelineId && (running || categoryRunning) && promptedGmailPipelineId !== pipelineId) {
      promptedGmailPipelineId = pipelineId;
      showConnectGmailPrompt = true;
    }

    // Hide prompt once a mailbox is connected
    if (gmailConnected) {
      showConnectGmailPrompt = false;
    }
  });

  // Auto-run Penni Quick Draft the first time outreach loads and no template exists
  $effect(() => {
    const id = campaignId ?? effectiveCampaign?.id ?? null;
    if (!id) return;
    if (quickDraftRanCampaignId === id) return;
    if (isQuickDrafting) return;
    if (templateSaved || emailTemplate.trim().length > 0) {
      quickDraftRanCampaignId = id;
      return;
    }
    quickDraftRanCampaignId = id;
    void quickDraftEmail();
  });

  // Load Gmail connections on mount or when popup opens
  $effect(() => {
    if (!browser) return;
    const id = campaignId ?? effectiveCampaign?.id ?? null;
    if (!id || gmailLoadedCampaignId === id) return;
    gmailLoadedCampaignId = id;
    void refreshGmailStatus();
  });

  function togglePlatform(value: string) {
    const next = new Set(selectedPlatforms);
    if (next.has(value)) next.delete(value); else next.add(value);
    selectedPlatforms = Array.from(next);
    platforms = selectedPlatforms.join(', ');
    scheduleAutosave();
  }

  // Prefill from existing campaign when available
  $effect(() => {
    const id = effectiveCampaign?.id ?? null;
    if (!id || id === lastPrefillCampaignId) return;

    lastPrefillCampaignId = id;

    const platformString = effectiveCampaign?.platform ?? null;
    setPlatformsFromString(platformString);

    brand = effectiveCampaign?.business_name ?? brand;
    about = effectiveCampaign?.businessSummary ?? about;
    website = effectiveCampaign?.website ?? website;
    influencerType = effectiveCampaign?.type_of_influencer ?? influencerType;
    location = effectiveCampaign?.locations ?? location;
    if (effectiveCampaign?.followersMin !== undefined && effectiveCampaign.followersMin !== null) {
      minFollowersLocal = effectiveCampaign.followersMin;
    } else {
      minFollowersLocal = 10000;
    }
    if (effectiveCampaign?.followersMax !== undefined && effectiveCampaign.followersMax !== null) {
      maxFollowersLocal = effectiveCampaign.followersMax;
    } else {
      maxFollowersLocal = 500000;
    }

    // Carry over defaults from props if present
    if (searchFormMinFollowers !== null && searchFormMinFollowers !== undefined) {
      minFollowersLocal = searchFormMinFollowers;
    }
    if (searchFormMaxFollowers !== null && searchFormMaxFollowers !== undefined) {
      maxFollowersLocal = searchFormMaxFollowers;
    }
    if (searchFormTopN !== null && searchFormTopN !== undefined) {
      topNLocal = searchFormTopN || 10;
    }
  });

  function buildDescription() {
    const parts = [] as string[];
    if (brand) parts.push(`Brand: ${brand}`);
    if (about) parts.push(about);
    if (website) parts.push(`Website: ${website}`);
    const ask: string[] = [];
    if (influencerType) ask.push(influencerType);
    const platformList = selectedPlatforms.length ? selectedPlatforms.join(', ') : platforms;
    if (platformList) ask.push(`on ${platformList}`);
    if (location) ask.push(`in ${location}`);
    if (minFollowersLocal !== null || maxFollowersLocal !== null) {
      if (minFollowersLocal !== null && maxFollowersLocal !== null) {
        ask.push(`with ${minFollowersLocal}-${maxFollowersLocal} followers`);
      } else if (minFollowersLocal !== null) {
        ask.push(`with at least ${minFollowersLocal} followers`);
      } else if (maxFollowersLocal !== null) {
        ask.push(`up to ${maxFollowersLocal} followers`);
      }
    }
    if (ask.length) parts.push(`Looking for ${ask.join(' ')}`);
    return parts.join('. ').trim();
  }

  function submitMinimal(event?: Event) {
    event?.preventDefault();
    const description = buildDescription() || influencerSummary || 'Find relevant influencers for my campaign.';
    onSubmit({
      business_description: description,
      top_n: topNLocal,
      min_followers: minFollowersLocal,
      max_followers: maxFollowersLocal,
      campaign_id: effectiveCampaign?.id ?? null,
      strict_location_matching: strictLocationMatching
    });
  }

  function scheduleAutosave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      void saveCampaignDetails();
    }, 600);
  }

  async function saveCampaignDetails() {
    const id = campaignId ?? effectiveCampaign?.id ?? null;
    if (!id) return;
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    isSaving = true;
    saveError = null;
    const payload: Record<string, unknown> = {};

    const trimOrNull = (v: string) => (v && v.trim().length > 0 ? v.trim() : undefined);

    const brandVal = trimOrNull(brand);
    const aboutVal = trimOrNull(about);
    const websiteVal = trimOrNull(website);
    const typeVal = trimOrNull(influencerType);
    const platformsVal = selectedPlatforms.length ? selectedPlatforms.join(', ') : trimOrNull(platforms);
    const locationVal = trimOrNull(location);

    if (brandVal !== undefined) payload.business_name = brandVal;
    if (aboutVal !== undefined) payload.businessSummary = aboutVal;
    if (websiteVal !== undefined) payload.website = websiteVal;
    if (typeVal !== undefined) payload.type_of_influencer = typeVal;
    if (platformsVal !== undefined) payload.platform = platformsVal;
    if (locationVal !== undefined) payload.locations = locationVal;
    if (minFollowersLocal !== null) payload.followersMin = minFollowersLocal;
    if (maxFollowersLocal !== null) payload.followersMax = maxFollowersLocal;

    if (Object.keys(payload).length === 0) {
      isSaving = false;
      return;
    }

    try {
      const response = await fetch(`/api/campaigns/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to save campaign');
      }
    } catch (error) {
      saveError = error instanceof Error ? error.message : 'Failed to save';
    } finally {
      isSaving = false;
    }
  }

  function defaultTemplate() {
    return `<p>Hi {{influencer_name}},</p><p>We love your content and think you'd be a great fit for our campaign. Are you open to a quick collaboration chat?</p><p>Thanks!</p>`;
  }

  // Check for unfilled placeholder fields like [Your Name], [Company], etc.
  function checkUnfilledPlaceholders(template: string): string[] {
    // Match patterns like [Your Name], [Company Name], [Product], etc.
    // But exclude valid template variables like {{influencer_name}}
    const placeholderRegex = /\[([A-Z][A-Za-z\s]+)\]/g;
    const matches: string[] = [];
    let match;
    while ((match = placeholderRegex.exec(template)) !== null) {
      matches.push(match[0]);
    }
    return [...new Set(matches)]; // Remove duplicates
  }

  async function saveTemplate() {
    if (!browser) return;
    templateSaving = true;
    templateError = null;
    templateWarning = null;
    templateJustSaved = false;
    
    try {
      // Check for unfilled placeholders
      const unfilled = checkUnfilledPlaceholders(emailTemplate);
      if (unfilled.length > 0) {
        templateWarning = `Unfilled fields: ${unfilled.join(', ')}`;
      }
      
      localStorage.setItem(templateKey(), emailTemplate);
      templateLastSavedAt = Date.now();
      
      // Show "Saved!" feedback briefly, then close the editor
      templateJustSaved = true;
      setTimeout(() => {
        templateJustSaved = false;
        showEmailPopup = false;
      }, 500);
    } catch (error) {
      templateError = error instanceof Error ? error.message : 'Failed to save template';
    } finally {
      templateSaving = false;
    }
  }

  async function refreshGmailStatus() {
    try {
      isLoadingGmail = true;
      gmailError = null;
      const response = await fetch('/api/auth/gmail/status');
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      const connections: GmailConnection[] = Array.isArray(data.connections)
        ? data.connections.map((c: any) => ({
            id: c.id,
            email: c.email,
            primary: c.primary ?? false
          }))
        : [];
      gmailConnections = connections;
    } catch (error) {
      gmailError = error instanceof Error ? error.message : 'Failed to load Gmail status';
      gmailConnections = [];
    } finally {
      isLoadingGmail = false;
    }
  }

  function goToMailboxSettings() {
    if (browser) {
      window.location.href = '/my-account/gmail';
    }
  }

  function handleConnectInbox() {
    if (browser) {
      const id = campaignId ?? effectiveCampaign?.id;
      const url = id
        ? `/api/auth/gmail/connect?returnCampaignId=${encodeURIComponent(id)}`
        : '/api/auth/gmail/connect';
      window.location.href = url;
    }
  }

  async function handleDisconnectInbox(connectionId: string) {
    try {
      const response = await fetch('/api/auth/gmail/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId })
      });

      if (!response.ok) {
        throw new Error('Failed to disconnect inbox');
      }

      // Refresh Gmail connections after disconnect
      await refreshGmailStatus();
    } catch (error) {
      console.error('Error disconnecting inbox:', error);
      throw error;
    }
  }

  async function handleSetPrimary(connectionId: string) {
    try {
      const response = await fetch('/api/auth/gmail/primary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId })
      });

      if (!response.ok) {
        throw new Error('Failed to set primary inbox');
      }

      // Refresh Gmail connections after setting primary
      await refreshGmailStatus();
    } catch (error) {
      console.error('Error setting primary inbox:', error);
      throw error;
    }
  }

  async function quickDraftEmail() {
    if (isQuickDrafting) return;
    isQuickDrafting = true;
    quickDraftError = null;
    emailTemplate = '<p></p>';

    try {
      const response = await fetch('/api/outreach/draft/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: campaignId ?? effectiveCampaign?.id ?? null,
          tone: 'friendly',
          platform: 'email'
        })
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        throw new Error(text || 'Failed to start quick draft');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      const processEvent = (eventType: string, data: string) => {
        try {
          const payload = JSON.parse(data);
          if (eventType === 'delta' && payload.delta) {
            accumulated += payload.delta;
            emailTemplate = renderTemplateFromText(accumulated);
          } else if (eventType === 'final' && payload.message) {
            accumulated = payload.message;
            emailTemplate = renderTemplateFromText(accumulated);
          } else if (eventType === 'error') {
            throw new Error(payload.message || 'Streaming error occurred');
          }
        } catch (err) {
          console.error('Failed to parse draft event', err);
        }
      };

      const parseBuffer = () => {
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const lines = chunk.split('\n');
          let eventType = '';
          let data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            else if (line.startsWith('data: ')) data = line.slice(6).trim();
          }
          if (eventType && data) processEvent(eventType, data);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        parseBuffer();
      }
      if (buffer.trim()) parseBuffer();

      await saveTemplate();
      templateLastSavedAt = Date.now();
    } catch (error) {
      quickDraftError = error instanceof Error ? error.message : 'Failed to quick draft';
    } finally {
      isQuickDrafting = false;
    }
  }

  function renderTemplateFromText(text: string) {
    // convert plain text to simple HTML paragraphs
    const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length === 0) return '<p></p>';
    return paragraphs.map((p) => `<p>${p}</p>`).join('');
  }

  function renderTemplateForRecipient(profile: InfluencerProfile) {
    const name = profile.display_name || 'there';
    return (emailTemplate || defaultTemplate()).replace(/{{\s*influencer_name\s*}}/gi, name);
  }

  const needsAttention = $derived(() => !gmailConnected || !templateSaved);

  async function createGmailDrafts() {
    if (!campaignId && !effectiveCampaign?.id) {
      draftError = 'Campaign missing';
      showEmailPopup = true;
      return;
    }
    const sender = primaryGmail();
    if (!sender) {
      draftError = 'Connect Gmail before creating drafts.';
      showEmailPopup = true;
      return;
    }
    if (!templateSaved) {
      draftError = 'Add and save an email template first.';
      showEmailPopup = true;
      return;
    }

    // Use selected influencers if any are selected, otherwise use all with email
    const allRecips = recipientsForOutreach().filter((r) => r.email_address || r.business_email);
    const recips = selectedCount > 0 
      ? allRecips.filter(r => selectedInfluencerIds.has(r._id || getProfileId(r)))
      : allRecips;
      
    if (recips.length === 0) {
      draftError = selectedCount > 0 
        ? 'Selected influencers have no email addresses.'
        : 'No influencer emails available yet.';
      return;
    }

    draftInFlight = true;
    draftStatus = null;
    draftError = null;
    try {
      const recipientsPayload = recips.map((r) => ({
        influencerId: r._id || r.profile_url || r.display_name || Math.random().toString(36),
        email: r.email_address || r.business_email,
        name: r.display_name,
        platform: r.platform
      }));

      const response = await fetch('/api/outreach/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          campaignId: campaignId ?? effectiveCampaign?.id ?? undefined,
          recipients: recipientsPayload,
          emailContent: emailTemplate || defaultTemplate(),
          platform: 'gmail',
          senderConnectionId: sender.id
        })
      });

      if (!response.ok) {
        const txt = await response.text();
        throw new Error(txt || 'Failed to create drafts');
      }
      draftStatus = `Drafts created for ${recips.length} influencers`;
      // Mark as contacted
      const newContacted = new Set(contactedInfluencerIds);
      recips.forEach(r => newContacted.add(r._id || getProfileId(r)));
      contactedInfluencerIds = newContacted;
      // Clear selection
      selectedInfluencerIds = new Set();
      showEmailPopup = false;
    } catch (error) {
      draftError = error instanceof Error ? error.message : 'Failed to create drafts';
    } finally {
      draftInFlight = false;
    }
  }

  function attemptSendAll() {
    if (!gmailConnected || !templateSaved) {
      showEmailPopup = true;
      return;
    }
    if (onSendAll) {
      onSendAll();
    } else {
      void createGmailDrafts();
    }
  }

  const previewRecipient = $derived(() => recipientsForOutreach()[0] ?? displayedProfiles()[0] ?? null);
  const previewHtml = $derived(() => {
    const recipient = previewRecipient();
    return recipient ? renderTemplateForRecipient(recipient) : emailTemplate;
  });

  function openPreview() {
    if (!templateSaved) {
      showEmailPopup = true;
      return;
    }
    previewPopupOpen = true;
  }

  function nextStep() {
    if (step < steps.length - 1) {
      step += 1;
    }
  }

  function prevStep() {
    if (step > 0) {
      step -= 1;
    }
  }
</script>

<div style="display: flex; flex-direction: column; width: 100%; height: 100%; background: {hasPipeline && isCompleted() ? '#ffffff' : 'linear-gradient(145deg, #faf9f7 0%, #f5f3f0 50%, #f0eeeb 100%)'}; position: relative; overflow: hidden;">
  <!-- Subtle grid pattern (only show for form and preliminary) -->
  {#if !hasPipeline || !isCompleted()}
    <div style="position: absolute; inset: 0; background-image: linear-gradient(rgba(0,0,0,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.02) 1px, transparent 1px); background-size: 40px 40px; pointer-events: none;"></div>

    <!-- Soft gradient orbs for depth -->
    <div style="position: absolute; top: -15%; right: -5%; width: 500px; height: 500px; background: radial-gradient(circle, rgba(255,111,97,0.08) 0%, transparent 70%); pointer-events: none; filter: blur(80px);"></div>
    <div style="position: absolute; bottom: -20%; left: -10%; width: 600px; height: 600px; background: radial-gradient(circle, rgba(147,112,219,0.06) 0%, transparent 70%); pointer-events: none; filter: blur(100px);"></div>
  {/if}

  {#if !hasPipeline && !isSearchFormSubmitting}
    <!-- Form mode: Full screen with glass effect -->
    <div style="flex: 1; display: flex; flex-direction: column; width: 100%; height: 100%; padding: 32px; overflow-y: auto; position: relative; z-index: 1;">
      <!-- Top bar with usage -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 11px; font-weight: 600; color: rgba(0,0,0,0.4); text-transform: uppercase; letter-spacing: 0.1em;">Step {step + 1} of {steps.length}</span>
          <span style="font-size: 11px; color: rgba(0,0,0,0.2);">·</span>
          <span style="font-size: 11px; color: #FF6F61; font-weight: 500;">{steps[step]}</span>
        </div>
        {#if searchUsage && searchUsage.limit !== undefined && searchUsage.remaining !== undefined}
          <div style="display: flex; align-items: center; gap: 6px; padding: 6px 14px; background: rgba(255,255,255,0.7); backdrop-filter: blur(10px); border: 1px solid rgba(0,0,0,0.06); border-radius: 999px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
            <span style="font-size: 11px; color: rgba(0,0,0,0.5);">Searches:</span>
            <span style="font-size: 12px; font-weight: 600; color: #FF6F61;">{searchUsage.remaining}</span>
            <span style="font-size: 11px; color: rgba(0,0,0,0.3);">/ {searchUsage.limit}</span>
          </div>
        {/if}
      </div>

      <!-- Progress bar -->
      <div style="width: 100%; height: 3px; background: rgba(0,0,0,0.06); border-radius: 2px; margin-bottom: 48px; position: relative; overflow: hidden;">
        <div style="height: 100%; background: linear-gradient(90deg, #FF6F61, #FF8A80); border-radius: 2px; transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1); width: {((step + 1) / steps.length) * 100}%;"></div>
      </div>

      <!-- Main content area -->
      <div style="flex: 1; display: flex; flex-direction: column; width: 100%;">
        <form style="display: flex; flex-direction: column; flex: 1; width: 100%;" onsubmit={submitMinimal}>
          {#if step === 0}
            <div style="display: flex; flex-direction: column; gap: 32px; flex: 1;">
              <div style="margin-bottom: 16px;">
                <h1 style="font-size: 38px; font-weight: 700; color: #1a1a1a; margin: 0 0 8px 0; letter-spacing: -0.02em;">Tell us about your brand</h1>
                <p style="font-size: 16px; color: rgba(0,0,0,0.5); margin: 0;">We'll use this to find the perfect creators for you.</p>
              </div>
              
              <div style="display: flex; flex-direction: column; gap: 24px;">
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  <label for="simple-brand" style="font-size: 13px; font-weight: 500; color: rgba(0,0,0,0.7);">Brand / Company name</label>
                  <input id="simple-brand" class="light-input" bind:value={brand} oninput={scheduleAutosave} placeholder="e.g., Dune Skincare" />
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  <label for="simple-about" style="font-size: 13px; font-weight: 500; color: rgba(0,0,0,0.7);">What do you sell?</label>
                  <textarea id="simple-about" rows="3" class="light-input" bind:value={about} oninput={scheduleAutosave} placeholder="Describe your product and what makes it special..."></textarea>
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  <label for="simple-website" style="font-size: 13px; font-weight: 500; color: rgba(0,0,0,0.7);">Website <span style="color: rgba(0,0,0,0.3);">(optional)</span></label>
                  <input id="simple-website" class="light-input" bind:value={website} oninput={scheduleAutosave} placeholder="https://yoursite.com" />
                </div>
              </div>
            </div>
          {:else if step === 1}
            <div style="display: flex; flex-direction: column; gap: 32px; flex: 1;">
              <div style="margin-bottom: 16px;">
                <h1 style="font-size: 38px; font-weight: 700; color: #1a1a1a; margin: 0 0 8px 0; letter-spacing: -0.02em;">Who are you looking for?</h1>
                <p style="font-size: 16px; color: rgba(0,0,0,0.5); margin: 0;">Define the type of creators you need.</p>
              </div>

              <div style="display: flex; flex-direction: column; gap: 24px;">
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  <label for="simple-type" style="font-size: 13px; font-weight: 500; color: rgba(0,0,0,0.7);">Creator niche or type</label>
                  <input id="simple-type" class="light-input" bind:value={influencerType} oninput={scheduleAutosave} placeholder="e.g., beauty reviewers, fitness coaches, food bloggers" />
                </div>

                <div style="display: flex; flex-direction: column; gap: 8px;">
                  <label for="simple-location" style="font-size: 13px; font-weight: 500; color: rgba(0,0,0,0.7);">Location of Influencers</label>
                  <input id="simple-location" class="light-input" bind:value={location} oninput={scheduleAutosave} placeholder="e.g., US, Canada, UK" />
                </div>

                <div style="display: flex; flex-direction: column; gap: 12px;">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <label for="simple-topn" style="font-size: 13px; font-weight: 500; color: rgba(0,0,0,0.7);">How many creators do you want?</label>
                    <span style="font-size: 16px; font-weight: 600; color: #FF6F61;">{topNLocal}</span>
                  </div>
                  <input
                    id="simple-topn"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    class="slider"
                    value={sliderPosition}
                    oninput={handleSliderChange}
                    style="width: 100%; height: 6px; border-radius: 999px; background: linear-gradient(to right, #FF6F61 0%, #FF6F61 {sliderPosition}%, rgba(0,0,0,0.08) {sliderPosition}%, rgba(0,0,0,0.08) 100%); outline: none; -webkit-appearance: none; appearance: none; cursor: pointer;"
                  />
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <p style="font-size: 11px; color: rgba(0,0,0,0.4); margin: 0;">Min: 10</p>
                    <p style="font-size: 11px; color: rgba(0,0,0,0.4); margin: 0;">
                      {#if searchUsage?.remaining !== undefined}
                        Max: {effectiveMaxInfluencers()} {searchUsage.remaining < maxInfluencers ? '(remaining searches)' : '(per-search limit)'}
                      {:else}
                        Max: {maxInfluencers} (per-search limit)
                      {/if}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          {:else}
            <div style="display: flex; flex-direction: column; gap: 32px; flex: 1;">
              <div style="margin-bottom: 16px;">
                <h1 style="font-size: 38px; font-weight: 700; color: #1a1a1a; margin: 0 0 8px 0; letter-spacing: -0.02em;">Premium features</h1>
                <p style="font-size: 16px; color: rgba(0,0,0,0.5); margin: 0;">Fine-tune your search with advanced filters.</p>
              </div>

              {#if !isPremiumUser()}
                <div style="padding: 20px 24px; background: linear-gradient(135deg, rgba(255,111,97,0.08), rgba(255,138,128,0.05)); border: 1px solid rgba(255,111,97,0.2); border-radius: 12px; box-shadow: 0 2px 12px rgba(255,111,97,0.1);">
                  <div style="display: flex; align-items: flex-start; gap: 16px;">
                    <div style="font-size: 24px; line-height: 1;">✨</div>
                    <div style="flex: 1;">
                      <h3 style="font-size: 16px; font-weight: 600; color: #e85a4f; margin: 0 0 8px 0;">Upgrade to unlock Premium Features</h3>
                      <p style="font-size: 14px; color: rgba(0,0,0,0.6); margin: 0 0 16px 0;">Get access to advanced platform selection, custom follower ranges, and strict location matching to find the perfect influencers for your campaign.</p>
                      <a
                        href="/pricing"
                        style="display: inline-flex; align-items: center; gap: 8px; padding: 12px 24px; font-size: 14px; font-weight: 600; border-radius: 8px; background: linear-gradient(135deg, #FF6F61, #FF8A80); color: white; text-decoration: none; transition: all 0.2s; box-shadow: 0 4px 16px rgba(255,111,97,0.25);"
                      >
                        View Plans →
                      </a>
                    </div>
                  </div>
                </div>
              {/if}

              <div style="display: flex; flex-direction: column; gap: 24px;">
                <div style="display: flex; flex-direction: column; gap: 12px;">
                  <div id="platforms-label" style="font-size: 13px; font-weight: 500; color: rgba(0,0,0,0.7);">Platforms</div>
                  <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                    {#each platformOptions as option}
                      <button
                        type="button"
                        class="platform-btn"
                        disabled={!isPremiumUser()}
                        style="padding: 14px 28px; font-size: 14px; font-weight: 500; border-radius: 10px; border: 1px solid {selectedPlatforms.includes(option) ? 'rgba(255,111,97,0.4)' : 'rgba(0,0,0,0.1)'}; background: {selectedPlatforms.includes(option) ? 'linear-gradient(135deg, rgba(255,111,97,0.12), rgba(255,138,128,0.08))' : 'rgba(255,255,255,0.7)'}; backdrop-filter: blur(10px); color: {selectedPlatforms.includes(option) ? '#e85a4f' : 'rgba(0,0,0,0.6)'}; cursor: {isPremiumUser() ? 'pointer' : 'not-allowed'}; opacity: {isPremiumUser() ? '1' : '0.5'}; transition: all 0.2s; box-shadow: {selectedPlatforms.includes(option) ? '0 2px 12px rgba(255,111,97,0.15)' : '0 2px 8px rgba(0,0,0,0.04)'};"
                        onclick={() => togglePlatform(option)}
                        aria-labelledby="platforms-label"
                      >
                        {option === 'TikTok' ? '🎵' : '📸'} {option}
                      </button>
                    {/each}
                  </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                  <div style="display: flex; flex-direction: column; gap: 8px;">
                    <label for="simple-min" style="font-size: 13px; font-weight: 500; color: rgba(0,0,0,0.7);">Min followers</label>
                    <input id="simple-min" type="number" class="light-input" bind:value={minFollowersLocal} oninput={scheduleAutosave} min="0" step="1000" placeholder="10,000" disabled={!isPremiumUser()} style="opacity: {isPremiumUser() ? '1' : '0.5'}; cursor: {isPremiumUser() ? 'text' : 'not-allowed'};" />
                  </div>
                  <div style="display: flex; flex-direction: column; gap: 8px;">
                    <label for="simple-max" style="font-size: 13px; font-weight: 500; color: rgba(0,0,0,0.7);">Max followers</label>
                    <input id="simple-max" type="number" class="light-input" bind:value={maxFollowersLocal} oninput={scheduleAutosave} min="0" step="1000" placeholder="500,000" disabled={!isPremiumUser()} style="opacity: {isPremiumUser() ? '1' : '0.5'}; cursor: {isPremiumUser() ? 'text' : 'not-allowed'};" />
                  </div>
                </div>

                <div style="display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: rgba(255,255,255,0.6); backdrop-filter: blur(10px); border: 1px solid rgba(0,0,0,0.06); border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); opacity: {isPremiumUser() ? '1' : '0.5'};">
                  <button
                    type="button"
                    disabled={!isPremiumUser()}
                    onclick={() => strictLocationMatching = !strictLocationMatching}
                    id="simple-strict-location"
                    style="position: relative; width: 48px; height: 26px; border-radius: 999px; border: none; cursor: {isPremiumUser() ? 'pointer' : 'not-allowed'}; transition: background 0.2s; background: {strictLocationMatching ? 'linear-gradient(90deg, #FF6F61, #FF8A80)' : 'rgba(0,0,0,0.15)'};"
                    role="switch"
                    aria-checked={strictLocationMatching}
                    aria-label="Toggle strict location matching"
                  >
                    <span style="position: absolute; top: 3px; left: {strictLocationMatching ? '25px' : '3px'}; width: 20px; height: 20px; background: #ffffff; border-radius: 50%; transition: left 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.15);"></span>
                  </button>
                  <div style="flex: 1;">
                    <label id="simple-strict-location-label" style="font-size: 14px; font-weight: 500; color: rgba(0,0,0,0.8);" for="simple-strict-location">Strict location matching</label>
                    <p style="font-size: 12px; color: rgba(0,0,0,0.4); margin: 4px 0 0 0;">Only show creators with verified locations</p>
                  </div>
                </div>
              </div>
            </div>
          {/if}

          <!-- Navigation buttons - sticky at bottom -->
          <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 32px; margin-top: auto; border-top: 1px solid rgba(0,0,0,0.06);">
            {#if isFirstStep}
              <button
                type="button"
                onclick={() => onReopenWebsitePrefill?.()}
                class="nav-btn-back-light"
                style="padding: 14px 28px; font-size: 14px; font-weight: 500; border-radius: 10px; border: 1px solid rgba(0,0,0,0.1); background: rgba(255,255,255,0.7); backdrop-filter: blur(10px); color: rgba(0,0,0,0.5); cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.04);"
              >
                I have a website
              </button>
            {:else}
              <button
                type="button"
                onclick={prevStep}
                class="nav-btn-back-light"
                style="padding: 14px 28px; font-size: 14px; font-weight: 500; border-radius: 10px; border: 1px solid rgba(0,0,0,0.1); background: rgba(255,255,255,0.7); backdrop-filter: blur(10px); color: rgba(0,0,0,0.6); cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.04);"
              >
                ← Back
              </button>
            {/if}
            
            {#if isLastStep}
              <button
                type="submit"
                disabled={isSearchFormSubmitting}
                class="nav-btn-primary-light"
                style="padding: 16px 40px; font-size: 15px; font-weight: 600; border-radius: 12px; border: none; background: linear-gradient(135deg, #FF6F61 0%, #FF8A80 100%); color: #ffffff; cursor: {isSearchFormSubmitting ? 'not-allowed' : 'pointer'}; transition: all 0.2s; box-shadow: 0 4px 20px rgba(255,111,97,0.25); opacity: {isSearchFormSubmitting ? '0.7' : '1'};"
              >
                {#if isSearchFormSubmitting}
                  <span style="display: inline-flex; align-items: center; gap: 8px;">
                    <span style="width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite;"></span>
                    Launching...
                  </span>
                {:else}
                  Launch search →
                {/if}
              </button>
            {:else}
              <button
                type="button"
                onclick={nextStep}
                class="nav-btn-primary-light"
                style="padding: 16px 40px; font-size: 15px; font-weight: 600; border-radius: 12px; border: none; background: linear-gradient(135deg, #FF6F61 0%, #FF8A80 100%); color: #ffffff; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 20px rgba(255,111,97,0.25);"
              >
                Continue →
              </button>
            {/if}
          </div>
        </form>
      </div>
    </div>
  {:else}
    <!-- Pipeline mode: Full-width light layout with glass effect -->
    <div style="display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden;">
      <div style="flex-shrink: 0; padding: 32px 32px 0 32px;">
        {#if pipelineError}
          <div style="padding: 16px 20px; background: rgba(239,68,68,0.08); backdrop-filter: blur(10px); border: 1px solid rgba(239,68,68,0.2); border-radius: 12px; color: #dc2626; font-size: 14px; margin-bottom: 24px;">
            {pipelineError.message}
          </div>
        {/if}
        {#if pipelineStatus}
          <div style="margin-bottom: 24px;">
            <PipelineStatusComponent status={pipelineStatus} />
          </div>
          {@const isPreliminary = isPreliminaryPreview()}

          {#if !isCompleted()}
            <!-- Running/Preliminary: Show ghosty preview with cycling animation -->
            {@const list = previewDisplayProfiles()}
            {#if list.length > 0}
              <div style="display: flex; flex-direction: column; gap: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <p style="font-size: 16px; font-weight: 600; color: rgba(0,0,0,0.8); margin: 0;">Preview</p>
                    <span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; background: rgba(255,255,255,0.7); backdrop-filter: blur(10px); border: 1px solid rgba(0,0,0,0.06); border-radius: 999px; font-size: 11px; color: rgba(0,0,0,0.5); box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
                      <span style="width: 6px; height: 6px; background: #FF6F61; border-radius: 50%; animation: pulse 1.5s ease-in-out infinite;"></span>
                      Searching...
                    </span>
                  </div>
                  <span style="font-size: 11px; color: rgba(0,0,0,0.4);">
                    {list.length} of {previewProfiles().length} candidates
                  </span>
                </div>
                <!-- Use keyed block to trigger full re-render on rotation -->
                {#key previewRotationSeed}
                  <div style="display: flex; flex-direction: column; gap: 10px; user-select: none; pointer-events: none;">
                    {#each list as profile, i (profile?._id ?? profile?.profile_url ?? profile?.display_name ?? `preview-${i}`)}
                      <div
                        class="ghosty-card"
                        style="--delay: {i * 80}ms;"
                        in:fly={{ y: 20, duration: 500, delay: i * 80, opacity: 0 }}
                        out:fade={{ duration: 250 }}
                      >
                        <div class="ghosty-shimmer"></div>
                        <div style="position: relative; z-index: 1; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;">
                          <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px;">
                            <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                              <span style="font-weight: 600; color: rgba(0,0,0,0.45); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{profile?.display_name ?? profile?.profile_url ?? 'Profile'}</span>
                              {#if profile?.platform}
                                <span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border: 1px solid rgba(0,0,0,0.06); border-radius: 999px; font-size: 11px; color: rgba(0,0,0,0.35); background: rgba(255,255,255,0.4);">
                                  {profile.platform === 'TikTok' ? '🎵' : '📸'} {profile.platform}
                                </span>
                              {/if}
                            </div>
                            {#if profile?.biography || profile?.bio}
                              <p style="font-size: 13px; color: rgba(0,0,0,0.3); margin: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">{profile.biography ?? profile.bio}</p>
                            {/if}
                          </div>
                          <div style="flex-shrink: 0; text-align: right; font-size: 13px; color: rgba(0,0,0,0.3);">
                            {#if profile?.followers}
                              <div>{profile.followers.toLocaleString()} followers</div>
                            {/if}
                          </div>
                        </div>
                      </div>
                    {/each}
                  </div>
                {/key}
                <p style="font-size: 12px; text-align: center; color: rgba(0,0,0,0.35); font-style: italic; margin: 0;">
                  Preliminary matches. Final results may differ after analysis.
                </p>
              </div>
            {/if}
          {/if}
        {:else}
          <p style="font-size: 14px; color: rgba(0,0,0,0.5);">Fetching pipeline status…</p>
        {/if}
      </div>

      {#if isCompleted()}
        <!-- Scrollable influencer table -->
        <div style="flex: 1; min-height: 0; overflow-y: auto; padding: 0 32px;">
          <InfluencersTable
            profiles={allProfiles()}
            selectedIds={selectedInfluencerIds}
            contactedIds={contactedInfluencerIds}
            {showContacted}
            status={pipelineStatus?.status ?? 'pending'}
            isPreliminary={false}
            {previousProfileIds}
            isSearching={isSearchFormSubmitting}
            onToggleSelection={toggleInfluencerSelection}
            onToggleContacted={() => showContacted = !showContacted}
            onFindMore={handleFindMore}
          />
        </div>
      {:else if pipelineStatus?.status === 'running'}
        <!-- Spacer to push bottom bar down when pipeline is running -->
        <div style="flex: 1;"></div>
      {/if}
      
        <!-- Bottom Action Bar (sticky outside scroll) -->
        {#if isCompleted()}
          <div style="border-top: 1px solid rgba(0,0,0,0.08); background: white; flex-shrink: 0; box-shadow: 0 -2px 10px rgba(0,0,0,0.05);">
            <!-- Selection row -->
            <div style="padding: 16px 32px; border-bottom: 1px solid rgba(0,0,0,0.06); display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 20px;">
                <div style="display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; background: linear-gradient(135deg, #FF6F61, #FF8A80); border-radius: 8px;">
                  <span style="font-size: 14px; font-weight: 600; color: white;">
                    {selectedCount} {selectedCount === 1 ? 'creator' : 'creators'} selected
                  </span>
                </div>
                {#if selectedCount === 0}
                  <button
                    type="button"
                    class="select-link-btn-light select-all-light"
                    onclick={selectAllInfluencers}
                  >
                    Select all
                  </button>
                {:else}
                  <button
                    type="button"
                    class="select-link-btn-light clear-selection-light"
                    onclick={deselectAllInfluencers}
                  >
                    Clear selection
                  </button>
                {/if}
              </div>
            </div>
            
            <!-- Status indicators & Action row -->
            <div style="padding: 20px 32px; display: flex; align-items: center; justify-content: flex-end; gap: 12px;">
              <!-- Step 1: Gmail status indicator -->
              <div style="position: relative;">
                <div
                  style="display: flex; align-items: center; gap: 8px; padding: 13px 32px; border-radius: 8px; cursor: pointer; transition: all 0.2s; background: {gmailConnected ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'}; border: 1px solid {gmailConnected ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}; min-width: 224px;"
                  onclick={() => inboxPopupOpen = true}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => e.key === 'Enter' && (inboxPopupOpen = true)}
                >
                  <div style="display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: {gmailConnected ? '#22c55e' : '#ef4444'}; color: white; font-size: 11px; font-weight: 700;">
                    {#if gmailConnected}
                      ✓
                    {:else}
                      1
                    {/if}
                  </div>
                  <div style="display: flex; flex-direction: column;">
                    <span style="font-size: 12px; font-weight: 500; color: {gmailConnected ? '#16a34a' : '#dc2626'};">
                      {gmailConnected ? 'Email Selected' : 'Select Email'}
                    </span>
                    <span style="font-size: 10px; color: {gmailConnected ? 'rgba(22,163,74,0.7)' : 'rgba(220,38,38,0.7)'};">
                      {gmailConnected ? `${gmailConnections.length} inbox${gmailConnections.length !== 1 ? 'es' : ''}` : 'Click to connect'}
                    </span>
                  </div>
                </div>
                {#if !gmailConnected}
                  <div class="chat-bubble">
                    Connect your Gmail! 📧
                  </div>
                {/if}
              </div>

              <!-- Step 2: Template status indicator -->
              <div style="position: relative;">
                <div
                  style="display: flex; align-items: center; gap: 8px; padding: 13px 32px; border-radius: 8px; cursor: pointer; transition: all 0.2s; background: {templateSaved ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'}; border: 1px solid {templateSaved ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}; min-width: 224px;"
                  onclick={() => showEmailPopup = true}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => e.key === 'Enter' && (showEmailPopup = true)}
                  class={templateSaved ? '' : 'attention-pulse'}
                >
                  <div style="display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: {templateSaved ? '#22c55e' : '#ef4444'}; color: white; font-size: 11px; font-weight: 700;">
                    {#if templateSaved}
                      ✓
                    {:else}
                      2
                    {/if}
                  </div>
                  <div style="display: flex; flex-direction: column;">
                    <span style="font-size: 12px; font-weight: 500; color: {templateSaved ? '#16a34a' : '#dc2626'};">
                      {templateSaved ? 'Draft Complete' : 'Draft Incomplete'}
                    </span>
                    <span style="font-size: 10px; color: {templateSaved ? 'rgba(22,163,74,0.7)' : 'rgba(220,38,38,0.7)'};">
                      {templateSaved ? 'Ready to send' : 'Click to write email'}
                    </span>
                  </div>
                </div>
                {#if !templateSaved}
                  <div class="chat-bubble">
                    Write your email template! ✍️
                  </div>
                {/if}
              </div>

              <!-- Step 3: Send outreach -->
              <div style="position: relative;">
                <div
                  style="display: flex; align-items: center; gap: 8px; padding: 13px 32px; border-radius: 8px; cursor: {selectedCount === 0 || draftInFlight || !gmailConnected || !templateSaved ? 'not-allowed' : 'pointer'}; transition: all 0.2s; background: {gmailConnected && templateSaved && selectedCount > 0 && !draftInFlight ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'}; border: 1px solid {gmailConnected && templateSaved && selectedCount > 0 && !draftInFlight ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}; min-width: 224px; opacity: {selectedCount === 0 || draftInFlight || !gmailConnected || !templateSaved ? '0.5' : '1'};"
                  onclick={selectedCount > 0 && !draftInFlight && gmailConnected && templateSaved ? createGmailDrafts : null}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => e.key === 'Enter' && selectedCount > 0 && !draftInFlight && gmailConnected && templateSaved && createGmailDrafts()}
                  class={(selectedCount === 0 || !gmailConnected || !templateSaved) && !draftInFlight ? 'attention-pulse' : ''}
                >
                  <div style="display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: {gmailConnected && templateSaved && selectedCount > 0 && !draftInFlight ? '#22c55e' : '#ef4444'}; color: white; font-size: 11px; font-weight: 700;">
                    {#if gmailConnected && templateSaved && selectedCount > 0 && !draftInFlight}
                      ✓
                    {:else}
                      3
                    {/if}
                  </div>
                  <div style="display: flex; flex-direction: column;">
                    <span style="font-size: 12px; font-weight: 500; color: {gmailConnected && templateSaved && selectedCount > 0 && !draftInFlight ? '#16a34a' : '#dc2626'};">
                      {#if draftInFlight}
                        Sending…
                      {:else if gmailConnected && templateSaved && selectedCount > 0}
                        Ready to Send
                      {:else}
                        Send Outreach
                      {/if}
                    </span>
                    <span style="font-size: 10px; color: {gmailConnected && templateSaved && selectedCount > 0 && !draftInFlight ? 'rgba(22,163,74,0.7)' : 'rgba(220,38,38,0.7)'};">
                      {#if draftInFlight}
                        Processing…
                      {:else if !gmailConnected}
                        Connect Gmail first
                      {:else if !templateSaved}
                        Write template first
                      {:else if selectedCount === 0}
                        Select creators
                      {:else}
                        Click to send ({selectedCount})
                      {/if}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        {:else if pipelineStatus?.status === 'running'}
          <!-- During search: show simplified prompt bar -->
          <div style="border-top: 1px solid rgba(0,0,0,0.08); background: white; padding: 20px 32px; flex-shrink: 0; box-shadow: 0 -2px 10px rgba(0,0,0,0.05);">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px;">
              <span style="font-size: 13px; color: rgba(0,0,0,0.4);">Draft your email while you wait...</span>

              <div style="display: flex; align-items: center; gap: 16px;">
                <!-- Gmail status -->
                <div style="position: relative;">
                  <button
                    type="button"
                    style="display: flex; align-items: center; gap: 6px; padding: 11px 26px; background: rgba(255,255,255,0.9); border: 1px solid rgba(0,0,0,0.08); border-radius: 8px; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 6px rgba(0,0,0,0.04); min-width: 160px;"
                    onclick={() => inboxPopupOpen = true}
                    class={!gmailConnected ? 'attention-pulse' : ''}
                  >
                    {#if gmailConnected}
                      <span style="width: 8px; height: 8px; background: #22c55e; border-radius: 50%;"></span>
                      <span style="font-size: 13px; color: rgba(0,0,0,0.6);">{gmailConnections.length} inbox{gmailConnections.length !== 1 ? 'es' : ''}</span>
                    {:else}
                      <span style="width: 8px; height: 8px; background: rgba(0,0,0,0.2); border-radius: 50%;"></span>
                      <span style="font-size: 13px; color: #FF6F61; font-weight: 500;">Connect Gmail</span>
                    {/if}
                  </button>
                  {#if !gmailConnected}
                    <div class="chat-bubble chat-bubble-small">
                      Connect your Gmail! 📧
                    </div>
                  {/if}
                </div>

                <!-- Template status -->
                <div style="position: relative;">
                  <button
                    type="button"
                    style="display: flex; align-items: center; gap: 6px; padding: 11px 26px; background: rgba(255,255,255,0.9); border: 1px solid rgba(0,0,0,0.08); border-radius: 8px; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 6px rgba(0,0,0,0.04); min-width: 160px;"
                    onclick={() => showEmailPopup = true}
                    class={!templateSaved ? 'attention-pulse' : ''}
                  >
                    {#if templateSaved}
                      <span style="width: 8px; height: 8px; background: #22c55e; border-radius: 50%;"></span>
                    {:else}
                      <span style="width: 8px; height: 8px; background: #f59e0b; border-radius: 50%;"></span>
                    {/if}
                    <span style="font-size: 13px; color: rgba(0,0,0,0.6);">{templateStatusText()}</span>
                  </button>
                  {#if !templateSaved}
                    <div class="chat-bubble chat-bubble-small">
                      Write your email! ✍️
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/if}
</div>

<SendOutreachPopupPanel
  open={showEmailPopup}
  onClose={() => showEmailPopup = false}
  title="Email Template"
  subtitle=""
>
  <div class="h-full flex flex-col">
    <div class="flex-1 min-h-0 flex flex-col p-4 gap-2">
      <div class="flex items-center justify-between">
        <Button variant="primary" size="sm" onclick={quickDraftEmail} disabled={isQuickDrafting}>
          {isQuickDrafting ? 'Drafting…' : 'Penni Quick Draft'}
        </Button>
        <span class="text-xs text-gray-600">{templateStatusText()}</span>
      </div>
      {#if quickDraftError}
        <p class="text-xs text-red-700">{quickDraftError}</p>
      {/if}
      <div class="flex-1 min-h-[200px] rounded-lg border border-gray-200 bg-white overflow-hidden">
        <EmailEditor
          content={emailTemplate || defaultTemplate()}
          onUpdate={(content) => { emailTemplate = content; }}
        />
      </div>
      {#if templateWarning || templateError}
        <div class="text-xs">
          {#if templateWarning}<span class="text-amber-600">⚠️ {templateWarning}</span>{/if}
          {#if templateError}<span class="text-red-600">{templateError}</span>{/if}
        </div>
      {/if}
    </div>
    <div class="border-t border-gray-200 px-4 py-3 flex justify-end">
      <Button variant="secondary" size="sm" onclick={() => void saveTemplate()} disabled={templateSaving}>Save</Button>
    </div>
  </div>
</SendOutreachPopupPanel>

<SendOutreachPopupPanel
  open={previewPopupOpen}
  onClose={() => previewPopupOpen = false}
  title="Preview"
  subtitle={previewRecipient()?.display_name ?? ''}
>
  <div class="h-full flex flex-col max-w-lg">
    <div class="flex-1 overflow-y-auto px-4 py-3">
      {#if previewRecipient()}
        <div class="prose prose-sm max-w-none border border-gray-200 rounded-lg bg-white p-4">
          {@html previewHtml()}
        </div>
      {:else}
        <p class="text-sm text-gray-600">No recipients yet.</p>
      {/if}
    </div>
    <div class="border-t border-gray-200 px-4 py-3 flex justify-end">
      <Button variant="primary" size="sm" onclick={() => previewPopupOpen = false}>Close</Button>
    </div>
  </div>
</SendOutreachPopupPanel>

<EmailDraftPrompt
  open={showDraftPrompt}
  onConfirm={() => { showDraftPrompt = false; showEmailPopup = true; }}
  onDismiss={() => { showDraftPrompt = false; }}
/>

<SendOutreachPopupPanel
  open={showConnectGmailPrompt && !gmailConnected}
  onClose={() => showConnectGmailPrompt = false}
  title="Connect Gmail"
  subtitle=""
  size="compact"
>
  <div class="p-4 flex flex-col gap-3 w-full">
    <div class="space-y-2 w-full">
      <label class="flex items-start gap-2 p-2 rounded-lg border text-sm cursor-pointer {connectAccountType === 'draft' ? 'border-rose-300 bg-rose-50' : 'border-gray-200'}">
        <input type="radio" name="connectType" value="draft" bind:group={connectAccountType} class="mt-0.5 h-4 w-4 text-rose-500" />
        <div class="flex-1">
          <div class="font-medium text-gray-900">Draft only</div>
          <div class="text-xs text-gray-600">Creates drafts for review.</div>
        </div>
      </label>
      <label class="flex items-start gap-2 p-2 rounded-lg border text-sm cursor-pointer {connectAccountType === 'send' ? 'border-rose-300 bg-rose-50' : 'border-gray-200'}">
        <input type="radio" name="connectType" value="send" bind:group={connectAccountType} class="mt-0.5 h-4 w-4 text-rose-500" />
        <div class="flex-1">
          <div class="font-medium text-gray-900">Send & Draft</div>
          <div class="text-xs text-gray-600">Creates drafts and sends automatically.</div>
        </div>
      </label>
    </div>
    {#if gmailError}<p class="text-xs text-red-600">{gmailError}</p>{/if}
    <div class="flex justify-end gap-2 pt-2 border-t border-gray-100">
      <Button variant="secondary" size="sm" onclick={() => showConnectGmailPrompt = false}>Later</Button>
      <Button variant="primary" size="sm" onclick={() => {
        const id = campaignId ?? effectiveCampaign?.id;
        const params = new URLSearchParams({ accountType: connectAccountType || 'draft' });
        if (id) params.set('returnCampaignId', id);
        window.location.href = `/api/auth/gmail/connect?${params.toString()}`;
      }}>Connect</Button>
    </div>
  </div>
</SendOutreachPopupPanel>


<InboxManagementPopup
  open={inboxPopupOpen}
  connections={gmailConnections}
  onClose={() => inboxPopupOpen = false}
  onConnect={handleConnectInbox}
  onDisconnect={handleDisconnectInbox}
  onSetPrimary={handleSetPrimary}
/>

<style>
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  @keyframes pulse-red {
    0% {
      box-shadow: 0 0 0 0 rgba(255, 111, 97, 0.5);
    }
    70% {
      box-shadow: 0 0 0 10px rgba(255, 111, 97, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(255, 111, 97, 0);
    }
  }

  .attention-pulse {
    animation: pulse-red 1.5s ease-out infinite;
  }

  /* Light mode input styling */
  .light-input {
    width: 100%;
    padding: 16px 20px;
    background: rgba(255,255,255,0.7);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(0,0,0,0.08);
    border-radius: 12px;
    color: #1a1a1a;
    font-size: 16px;
    outline: none;
    transition: all 0.2s;
    resize: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
  }

  .light-input::placeholder {
    color: rgba(0,0,0,0.35);
  }

  .light-input:focus {
    border-color: rgba(255,111,97,0.4);
    background: rgba(255,255,255,0.9);
    box-shadow: 0 2px 12px rgba(255,111,97,0.1);
  }

  /* Light mode navigation buttons */
  .nav-btn-back-light:not(:disabled):hover {
    border-color: rgba(0,0,0,0.2) !important;
    background: rgba(255,255,255,0.9) !important;
    box-shadow: 0 4px 12px rgba(0,0,0,0.08) !important;
  }

  .nav-btn-primary-light:not(:disabled):hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 25px rgba(255,111,97,0.35) !important;
  }

  /* Platform button hover */
  .platform-btn:hover {
    border-color: rgba(255,111,97,0.3) !important;
    box-shadow: 0 4px 12px rgba(255,111,97,0.1) !important;
  }

  /* Light mode selection links */
  .select-link-btn-light {
    font-size: 13px;
    font-weight: 500;
    background: none;
    border: none;
    cursor: pointer;
    transition: color 0.2s;
  }

  .select-link-btn-light.select-all-light {
    color: #FF6F61;
  }

  .select-link-btn-light.select-all-light:hover {
    color: #e85a4f;
  }

  .select-link-btn-light.clear-selection-light {
    color: rgba(0,0,0,0.5);
  }

  .select-link-btn-light.clear-selection-light:hover {
    color: rgba(0,0,0,0.7);
  }

  /* Slider thumb styling */
  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #FF6F61;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(255,111,97,0.3);
    transition: all 0.2s;
  }

  .slider::-webkit-slider-thumb:hover {
    transform: scale(1.1);
    box-shadow: 0 4px 12px rgba(255,111,97,0.4);
  }

  .slider::-moz-range-thumb {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #FF6F61;
    cursor: pointer;
    border: none;
    box-shadow: 0 2px 8px rgba(255,111,97,0.3);
    transition: all 0.2s;
  }

  .slider::-moz-range-thumb:hover {
    transform: scale(1.1);
    box-shadow: 0 4px 12px rgba(255,111,97,0.4);
  }

  /* Chat bubble prompts */
  @keyframes bounce-in {
    0% {
      opacity: 0;
      transform: translateY(10px) scale(0.8);
    }
    60% {
      opacity: 1;
      transform: translateY(-5px) scale(1.05);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes float {
    0%, 100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-3px);
    }
  }

  .chat-bubble {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 0;
    background: linear-gradient(135deg, #ef4444, #dc2626);
    color: white;
    padding: 10px 16px;
    border-radius: 12px;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    box-shadow: 0 4px 16px rgba(239, 68, 68, 0.3);
    z-index: 100;
    animation: bounce-in 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55), float 2s ease-in-out 0.5s infinite;
  }

  .chat-bubble::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 24px;
    width: 0;
    height: 0;
    border-style: solid;
    border-width: 8px 8px 0 8px;
    border-color: #dc2626 transparent transparent transparent;
  }

  .chat-bubble-small {
    padding: 8px 12px;
    font-size: 12px;
    border-radius: 10px;
  }

  .chat-bubble-small::after {
    border-width: 6px 6px 0 6px;
    left: 20px;
  }

  /* Ghosty preview cards */
  .ghosty-card {
    position: relative;
    padding: 18px 22px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.4);
    border: 1.5px dashed rgba(0, 0, 0, 0.08);
    backdrop-filter: blur(12px);
    overflow: hidden;
    opacity: 0;
    animation: ghosty-fade-in 0.6s ease-out forwards;
    animation-delay: var(--delay);
  }

  @keyframes ghosty-fade-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .ghosty-shimmer {
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.3) 50%,
      transparent 100%
    );
    animation: shimmer 2.5s infinite;
    animation-delay: var(--delay);
    pointer-events: none;
  }

  @keyframes shimmer {
    0% {
      left: -100%;
    }
    100% {
      left: 100%;
    }
  }

  .ghosty-card::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 14px;
    padding: 1.5px;
    background: linear-gradient(
      135deg,
      rgba(255, 111, 97, 0.1),
      rgba(147, 112, 219, 0.05)
    );
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    opacity: 0;
    animation: ghosty-pulse 3s ease-in-out infinite;
    animation-delay: calc(var(--delay) + 0.5s);
  }

  @keyframes ghosty-pulse {
    0%, 100% {
      opacity: 0;
    }
    50% {
      opacity: 0.6;
    }
  }
</style>
