<script lang="ts">
import { browser } from '$app/environment';
import { fly, fade } from 'svelte/transition';
import { tweened } from 'svelte/motion';
import { cubicOut } from 'svelte/easing';
import Button from '$lib/components/Button.svelte';
import InfluencersTable from './InfluencersTable.svelte';
import SendOutreachPopupPanel from '$lib/components/outreach/SendOutreachPopupPanel.svelte';
import EmailDraftPrompt from './EmailDraftPrompt.svelte';
import EmailEditor from '$lib/components/EmailEditor.svelte';
import InboxManagementPopup from './InboxManagementPopup.svelte';
import DraftOptionsModal from './DraftOptionsModal.svelte';
import GmailAccountTypeModal from './GmailAccountTypeModal.svelte';
import { getProfileId } from '$lib/utils/campaign';
import { upgradeModal } from '$lib/stores/upgrade';
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
    forceOpenForm?: boolean; // When true, opens the form panel immediately regardless of pipeline state
    onSubmit: (params: SearchParams) => void;
    onRerun?: () => void;
    onFindMore?: (excludeProfileUrls: string[]) => void;
    onSendAll?: () => void;
    onWebsitePrefill?: (websiteUrl: string) => Promise<{ brand?: string; website?: string; about?: string; influencerType?: string }>;
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
    forceOpenForm = false,
    onSubmit,
    onRerun,
    onFindMore,
    onSendAll,
    onWebsitePrefill
  }: Props = $props();

  // Tweened progress for smooth animation
  const tweenedProgress = tweened(0, {
    duration: 800,
    easing: cubicOut
  });

  // Update tweened progress when pipelineStatus changes
  $effect(() => {
    const targetProgress = pipelineStatus?.overall_progress ?? 0;
    tweenedProgress.set(targetProgress);
  });

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
  let location = $state('');

  let minFollowersLocal = $state<number | null>(10000);
  let maxFollowersLocal = $state<number | null>(500000);
  let topNLocal = $state(searchFormTopN || 10);
  let strictLocationMatching = $state(true);
  let hasAutoAdvanced = $state(false); // Track if we've auto-advanced from website prefill

  // Website entry step state (step 0)
  let websiteUrl = $state('');
  let isAnalyzingWebsite = $state(false);
  let websiteError = $state<string | null>(null);

  // Locked slider interaction state
  let sliderLockedError = $state(false);
  let sliderErrorTimeout: ReturnType<typeof setTimeout> | null = null;

  // Form validation state
  let fieldErrors = $state<Record<string, string | null>>({
    brand: null,
    about: null,
    influencerType: null,
    location: null
  });

  // Validate fields for a specific step
  function validateStep(stepNum: number): boolean {
    const errors: Record<string, string | null> = { ...fieldErrors };
    let isValid = true;

    if (stepNum === 1) {
      // Step 1: Brand Details - brand and about are required
      if (!brand.trim()) {
        errors.brand = 'Brand name is required';
        isValid = false;
      } else {
        errors.brand = null;
      }
      if (!about.trim()) {
        errors.about = 'Please describe what you sell';
        isValid = false;
      } else {
        errors.about = null;
      }
    } else if (stepNum === 2) {
      // Step 2: Influencer Details - type and location are required
      if (!influencerType.trim()) {
        errors.influencerType = 'Creator type is required';
        isValid = false;
      } else {
        errors.influencerType = null;
      }
      if (!location.trim()) {
        errors.location = 'Location is required';
        isValid = false;
      } else {
        errors.location = null;
      }
    }

    fieldErrors = errors;
    return isValid;
  }

  // Clear error when user starts typing
  function clearFieldError(field: string) {
    if (fieldErrors[field]) {
      fieldErrors = { ...fieldErrors, [field]: null };
    }
  }

  function handleLockedSliderClick() {
    sliderLockedError = true;
    // Clear any existing timeout
    if (sliderErrorTimeout) {
      clearTimeout(sliderErrorTimeout);
    }
    // Auto-dismiss after 3 seconds
    sliderErrorTimeout = setTimeout(() => {
      sliderLockedError = false;
    }, 3000);
  }

  // Non-linear slider position (0-100)
  let sliderPosition = $state(0);

  // Calculate effective max for the slider (respects remaining count)
  const effectiveMaxInfluencers = $derived.by(() => {
    return Math.min(searchUsage?.remaining ?? maxInfluencers, maxInfluencers);
  });

  // Hide slider if user has 10 or fewer remaining
  const shouldHideSlider = $derived(effectiveMaxInfluencers <= 10);

  // Convert slider position (0-100) to topN value (10 to effectiveMax)
  // First half (0-50) maps to 10-100
  // Second half (50-100) maps to 100-effectiveMax
  function positionToTopN(position: number): number {
    const max = effectiveMaxInfluencers;

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
    const max = effectiveMaxInfluencers;

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
    const max = effectiveMaxInfluencers;
    // If slider is hidden (10 or fewer remaining), hardcode to 10
    if (shouldHideSlider) {
      topNLocal = 10;
      sliderPosition = 0;
      return;
    }
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
    const max = effectiveMaxInfluencers;
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
let showGmailTypeModal = $state(false);
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
  let showDraftOptionsModal = $state(false);

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
  
  // Show select all hint popup when pipeline completes (one-time)
  let showSelectAllHint = $state(false);
  let hintShownForPipelineId: string | null = $state(null);

  $effect(() => {
    const pipelineId = effectiveCampaign?.pipeline_id ?? null;
    const completed = isCompleted();
    const profiles = allProfiles();

    // Show hint when pipeline completes (if not already shown for this pipeline and not dismissed globally)
    if (completed && pipelineId && hintShownForPipelineId !== pipelineId && profiles.length > 0) {
      hintShownForPipelineId = pipelineId;
      // Check if user has dismissed this hint before
      const dismissed = typeof localStorage !== 'undefined' && localStorage.getItem('selectAllHintDismissed') === 'true';
      if (!dismissed) {
        showSelectAllHint = true;
      }
    }
  });

  function dismissSelectAllHint() {
    showSelectAllHint = false;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('selectAllHintDismissed', 'true');
    }
  }

  // Multi-step navigation
  let step = $state(0);
  const steps = [
    'Website',        // Step 0: Website entry
    'Brand basics',   // Step 1: Brand details
    'Targets & reach', // Step 2: Creator targeting
    'Premium features' // Step 3: Premium options
  ];
  const isLastStep = $derived(step === steps.length - 1);
  const isFirstStep = $derived(step === 0);
  const isWebsiteStep = $derived(step === 0); // Used to hide navigation on website step

  // Sliding panel state - starts closed, opens after mount for animation
  let showFormPanel = $state(false);
  let panelMounted = $state(false);

  // Open panel after mount (with slight delay for animation)
  $effect(() => {
    // Open form panel if:
    // 1. forceOpenForm is true (editing mode from sidebar), OR
    // 2. No pipeline and not submitting (normal new campaign flow)
    const shouldOpen = forceOpenForm || (!hasPipeline && !isSearchFormSubmitting);

    if (!panelMounted && browser && shouldOpen) {
      panelMounted = true;
      // Small delay to ensure CSS transition triggers
      setTimeout(() => {
        showFormPanel = true;
      }, 50);
    }
  });

  // Close panel when form is submitted (only if not in forced mode)
  $effect(() => {
    if (isSearchFormSubmitting) {
      showFormPanel = false;
    }
  });

  // Autosave state
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  let isSaving = $state(false);
  let saveError: string | null = null;
  let lastPrefillCampaignId: string | null = null;

  const platformOptions = ['TikTok', 'Instagram'];
  const previewProfiles = $derived((): InfluencerProfile[] => {
    // First try progressive/final profiles
    const profiles = pipelineStatus?.profiles;
    if (Array.isArray(profiles) && profiles.length > 0) {
      return profiles.slice(0, 10);
    }
    // Fallback to preliminary candidates from Weaviate
    const candidates = pipelineStatus?.preliminary_candidates;
    return Array.isArray(candidates) ? candidates.slice(0, 10) : [];
  });

  // Whether we're showing progressive (partial) results
  const isProgressivePreview = $derived(() => {
    return pipelineStatus?.is_progressive === true;
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

  // Whether we have progressive results (evaluated profiles during analysis, before full completion)
  const hasProgressiveResults = $derived(() => {
    return pipelineStatus?.is_progressive === true && pipelineStatus?.profiles && pipelineStatus.profiles.length > 0;
  });

  // Whether to show the InfluencersTable (either completed OR has progressive results)
  const shouldShowResults = $derived(() => {
    return isCompleted() || hasProgressiveResults();
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
    (pipelineStatus?.profiles ?? []).filter(
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

  // REMOVED: Auto prompt popups are disabled - chat bubbles in bottom bar handle this
  // Keep the effects but don't show popups - the showDraftPrompt and showConnectGmailPrompt
  // are now only triggered manually via button clicks
  $effect(() => {
    // Track pipeline changes but don't auto-show popups
    const pipelineId = effectiveCampaign?.pipeline_id ?? null;
    if (pipelineId && autoPromptedPipelineId !== pipelineId) {
      autoPromptedPipelineId = pipelineId;
      // showDraftPrompt = true; // Disabled - chat bubbles handle this
    }
    if (pipelineStatus?.status === 'completed' || pipelineStatus?.status === 'error') {
      showDraftPrompt = false;
    }
  });

  // Track Gmail state but don't auto-show popup - chat bubbles handle this
  $effect(() => {
    const pipelineId = effectiveCampaign?.pipeline_id ?? 'session-pipeline';

    // Reset prompt tracking when pipeline changes
    if (pipelineId !== lastPipelineId) {
      lastPipelineId = pipelineId;
      promptedGmailPipelineId = null;
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

    // Validate all required steps before submission
    const step1Valid = validateStep(1);
    const step2Valid = validateStep(2);

    if (!step1Valid || !step2Valid) {
      // Go to the first step with errors
      if (!step1Valid) {
        step = 1;
      } else if (!step2Valid) {
        step = 2;
      }
      return;
    }

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
      // Check for unfilled placeholders - block save if found
      const unfilled = checkUnfilledPlaceholders(emailTemplate);
      if (unfilled.length > 0) {
        templateError = `Please fill in: ${unfilled.join(', ')}`;
        templateSaving = false;
        return;
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
    // Show the account type selection modal instead of redirecting immediately
    showGmailTypeModal = true;
  }

  function handleGmailTypeSelect(type: 'draft' | 'send') {
    showGmailTypeModal = false;
    connectAccountType = type;
    if (browser) {
      const id = campaignId ?? effectiveCampaign?.id;
      const url = id
        ? `/api/auth/gmail/connect?returnCampaignId=${encodeURIComponent(id)}&accountType=${type}`
        : `/api/auth/gmail/connect?accountType=${type}`;
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

      // Don't auto-save - let user review and save manually
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
    // Validate current step before proceeding
    if (!validateStep(step)) {
      return;
    }
    if (step < steps.length - 1) {
      step += 1;
    }
  }

  function prevStep() {
    if (step > 0) {
      step -= 1;
    }
  }

  // Website entry step handlers
  async function handleWebsiteSubmit() {
    if (!websiteUrl.trim()) {
      websiteError = 'Please enter a website URL';
      return;
    }

    websiteError = null;
    isAnalyzingWebsite = true;

    try {
      // Normalize URL
      let url = websiteUrl.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      let data: { brand?: string; website?: string; about?: string; influencerType?: string };

      // Use the prop handler if provided, otherwise call API directly
      if (onWebsitePrefill) {
        data = await onWebsitePrefill(url);
      } else {
        // Call website prefill API directly
        const response = await fetch('/api/campaigns/prefill-from-website', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ websiteUrl: url })
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || 'Failed to analyze website');
        }

        data = await response.json();
      }

      // Populate form fields with extracted data
      if (data.brand) brand = data.brand;
      if (data.about) about = data.about;
      if (data.website) website = data.website;
      if (data.influencerType) influencerType = data.influencerType;

      // Move to next step
      step = 1;
      hasAutoAdvanced = true;
    } catch (err: any) {
      console.error('Website analysis error:', err);
      websiteError = err?.message || 'Failed to analyze website. Please try again or enter details manually.';
    } finally {
      isAnalyzingWebsite = false;
    }
  }

  function handleSkipWebsite() {
    // Skip website entry and go directly to brand details
    step = 1;
  }
</script>

<div class="panel-container" class:inline-mode={forceOpenForm}>
  {#if !forceOpenForm}
  <!-- Main content area - always visible behind the panel (only when not in inline mode) -->
  <div class="main-content-area">
    {#if isSearchFormSubmitting || hasPipeline}
      <!-- Show pipeline/loading content -->
      <div style="display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden;">
        {#if pipelineError}
          <!-- Error state - show error instead of infinite loading -->
          <div style="flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 24px;">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" stroke-width="1.5">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4M12 16h.01"/>
            </svg>
            <p style="font-size: 16px; font-weight: 500; color: var(--color-text-secondary); margin: 0;">Failed to load pipeline</p>
            <p style="font-size: 14px; color: var(--color-text-muted); margin: 0; text-align: center;">{pipelineError.message}</p>
          </div>
        {:else if !pipelineStatus}
          <!-- Loading state -->
          <div style="flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;">
            <div class="loading-spinner"></div>
            <p style="font-size: 16px; font-weight: 500; color: var(--color-text-secondary); margin: 0;">Loading</p>
          </div>
        {/if}
      </div>
    {:else}
      <!-- Empty state when form panel is open -->
      <div style="flex: 1; display: flex; align-items: center; justify-content: center;">
        <p style="font-size: 16px; color: var(--color-text-muted);">Complete the form to search for creators</p>
      </div>
    {/if}
  </div>

  <!-- Backdrop with blur effect -->
  {#if showFormPanel}
    <button
      type="button"
      class="panel-backdrop"
      transition:fade={{ duration: 300 }}
      onclick={() => showFormPanel = false}
      aria-label="Close form panel"
    ></button>
  {/if}
  {/if}

  <!-- Sliding Form Panel (or inline form when forceOpenForm is true) -->
  <div class="sliding-panel" class:panel-open={showFormPanel || forceOpenForm} class:inline-panel={forceOpenForm}>
    <!-- Grid pattern inside panel -->
    <div class="panel-grid-pattern"></div>

    <!-- Soft gradient orbs for depth -->
    <div class="panel-orb panel-orb-top"></div>
    <div class="panel-orb panel-orb-bottom"></div>

    <!-- Close button (hidden in inline mode since parent provides close) -->
    {#if !forceOpenForm}
    <button
      type="button"
      class="panel-close-btn"
      onclick={() => showFormPanel = false}
      aria-label="Close panel"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </button>
    {/if}

    <!-- Panel content wrapper -->
    <div class="panel-content-wrapper">
      <!-- Top bar with step indicator -->
      <div class="panel-top-bar">
        <span class="step-label">Step {step + 1} of {steps.length}</span>
        <span class="step-divider"></span>
        <span class="step-name">{steps[step]}</span>
      </div>

      <!-- Progress bar -->
      <div class="panel-progress-bar">
        <div class="panel-progress-fill" style="width: {((step + 1) / steps.length) * 100}%;"></div>
      </div>

      <!-- Main content area -->
      <div class="panel-form-container">
        <form class="editorial-form" onsubmit={submitMinimal}>
          {#if step === 0}
            <!-- Step 0: Website Entry - Centered hero view -->
            <div class="form-step website-step">
              <div class="website-hero">
                <h1 class="website-hero-title">Enter your website</h1>
                <p class="website-hero-subtitle">We'll automatically extract your brand details</p>

                <div class="website-input-wrapper">
                  <input
                    type="text"
                    class="website-hero-input"
                    bind:value={websiteUrl}
                    placeholder="yourcompany.com"
                    disabled={isAnalyzingWebsite}
                    onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), handleWebsiteSubmit())}
                  />
                  <button
                    type="button"
                    class="website-hero-btn"
                    onclick={handleWebsiteSubmit}
                    disabled={isAnalyzingWebsite}
                  >
                    {#if isAnalyzingWebsite}
                      <span class="btn-spinner"></span>
                    {:else}
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M5 12h14M12 5l7 7-7 7"/>
                      </svg>
                    {/if}
                  </button>
                </div>

                {#if websiteError}
                  <p class="website-error">{websiteError}</p>
                {/if}

                <button
                  type="button"
                  class="website-manual-link"
                  onclick={handleSkipWebsite}
                  disabled={isAnalyzingWebsite}
                >
                  Enter company details manually
                </button>
              </div>
            </div>
          {:else if step === 1}
            <!-- Step 1: Brand Details -->
            <div class="form-step">
              <div class="step-header">
                <span class="step-number-large">01</span>
                <h1 class="step-title">Tell us about your brand</h1>
                <p class="step-subtitle">We'll use this to find the perfect creators for you.</p>
              </div>

              <hr class="section-divider" />

              <div class="form-fields">
                <div class="field-group">
                  <label for="simple-brand" class="field-label">Brand / Company name <span class="field-required">*</span></label>
                  <input id="simple-brand" class="editorial-input" class:input-error={fieldErrors.brand} bind:value={brand} oninput={() => { scheduleAutosave(); clearFieldError('brand'); }} placeholder="e.g., Dune Skincare" />
                  {#if fieldErrors.brand}
                    <p class="field-error-message">{fieldErrors.brand}</p>
                  {/if}
                </div>
                <div class="field-group">
                  <label for="simple-about" class="field-label">What do you sell? <span class="field-required">*</span></label>
                  <textarea id="simple-about" rows="3" class="editorial-input editorial-textarea" class:input-error={fieldErrors.about} bind:value={about} oninput={() => { scheduleAutosave(); clearFieldError('about'); }} placeholder="Describe your product and what makes it special..."></textarea>
                  {#if fieldErrors.about}
                    <p class="field-error-message">{fieldErrors.about}</p>
                  {/if}
                </div>
                <div class="field-group">
                  <label for="simple-website" class="field-label">Website <span class="field-optional">(optional)</span></label>
                  <input id="simple-website" class="editorial-input" bind:value={website} oninput={scheduleAutosave} placeholder="https://yoursite.com" />
                </div>
              </div>
            </div>
          {:else if step === 2}
            <div class="form-step">
              <div class="step-header">
                <span class="step-number-large">02</span>
                <h1 class="step-title">Who are you looking for?</h1>
                <p class="step-subtitle">Define the type of creators you need.</p>
              </div>

              <hr class="section-divider" />

              <div class="form-fields">
                <div class="field-group">
                  <label for="simple-type" class="field-label">Creator niche or type <span class="field-required">*</span></label>
                  <input id="simple-type" class="editorial-input" class:input-error={fieldErrors.influencerType} bind:value={influencerType} oninput={() => { scheduleAutosave(); clearFieldError('influencerType'); }} placeholder="e.g., beauty reviewers, fitness coaches, food bloggers" />
                  {#if fieldErrors.influencerType}
                    <p class="field-error-message">{fieldErrors.influencerType}</p>
                  {/if}
                </div>

                <div class="field-group">
                  <label for="simple-location" class="field-label">Location of Influencers <span class="field-required">*</span></label>
                  <input id="simple-location" class="editorial-input" class:input-error={fieldErrors.location} bind:value={location} oninput={() => { scheduleAutosave(); clearFieldError('location'); }} placeholder="e.g., NYC, New York, US, Remote" />
                  {#if fieldErrors.location}
                    <p class="field-error-message">{fieldErrors.location}</p>
                  {/if}
                </div>

                <!-- Creators count slider - unlocked for premium, locked for free -->
                <div class="field-group">
                  {#if isPremiumUser()}
                    <!-- Unlocked slider for premium users -->
                    <div class="creators-count-minimal">
                      <div class="slider-header">
                        <label for="simple-topn" class="field-label">How many creators do you want?</label>
                        <span class="slider-value">{topNLocal}</span>
                      </div>
                      <input
                        id="simple-topn"
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        class="editorial-slider"
                        value={sliderPosition}
                        oninput={handleSliderChange}
                        style="--slider-percent: {sliderPosition}%;"
                      />
                      <div class="slider-range-labels">
                        <span>Min: 10</span>
                        <span>
                          {#if searchUsage?.remaining !== undefined}
                            Max: {effectiveMaxInfluencers} {searchUsage.remaining < maxInfluencers ? '(remaining)' : '(limit)'}
                          {:else}
                            Max: {maxInfluencers}
                          {/if}
                        </span>
                      </div>
                    </div>
                  {:else}
                    <!-- Locked slider for free users -->
                    <button
                      type="button"
                      class="creators-count-minimal"
                      class:creators-count-minimal-error={sliderLockedError}
                      onclick={handleLockedSliderClick}
                    >
                      <div class="slider-header">
                        <label for="simple-topn-locked" class="field-label">How many creators do you want?</label>
                        <span class="slider-value">{topNLocal}</span>
                      </div>
                      <input
                        id="simple-topn-locked"
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        class="editorial-slider editorial-slider-locked"
                        value={sliderPosition}
                        disabled
                        tabindex="-1"
                        style="--slider-percent: {sliderPosition}%;"
                      />
                      <div class="slider-range-labels">
                        <span>Min: 10</span>
                        <span>
                          {#if searchUsage?.remaining !== undefined}
                            Max: {effectiveMaxInfluencers} {searchUsage.remaining < maxInfluencers ? '(remaining)' : '(limit)'}
                          {:else}
                            Max: {maxInfluencers}
                          {/if}
                        </span>
                      </div>
                      {#if sliderLockedError}
                        <div class="creators-count-error">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 8v4M12 16h.01"/>
                          </svg>
                          <span>Upgrade to customize</span>
                          <button
                            type="button"
                            class="creators-count-upgrade-btn"
                            onclick={(e) => { e.stopPropagation(); upgradeModal.open('Upgrade to customize creator count', 'Get access to search for more creators per campaign.'); }}
                          >
                            View Plans
                          </button>
                        </div>
                      {/if}
                    </button>
                  {/if}
                </div>
              </div>
            </div>
          {:else}
            <div class="form-step" class:premium-locked={!isPremiumUser()}>
              <!-- Premium overlay for non-premium users -->
              {#if !isPremiumUser()}
                <div class="premium-overlay">
                  <div class="premium-overlay-content">
                    <div class="premium-badge">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                      </svg>
                      Premium
                    </div>
                    <h2 class="premium-overlay-title">Unlock Premium Features</h2>
                    <p class="premium-overlay-text">Get access to advanced platform selection, custom follower ranges, and strict location matching.</p>
                    <button
                      type="button"
                      onclick={() => upgradeModal.open('Upgrade to unlock Premium Features', 'Get access to advanced platform selection, custom follower ranges, and strict location matching.')}
                      class="premium-overlay-btn"
                    >
                      View Plans
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M5 12h14M12 5l7 7-7 7"/>
                      </svg>
                    </button>
                  </div>
                </div>
              {/if}

              <div class="step-header">
                <span class="step-number-large">03</span>
                <h1 class="step-title">Premium features</h1>
                <p class="step-subtitle">Fine-tune your search with advanced filters.</p>
              </div>

              <hr class="section-divider" />

              <div class="form-fields">
                <div class="field-group">
                  <span id="platforms-label" class="field-label">Platforms</span>
                  <div class="platform-options">
                    {#each platformOptions as option}
                      <button
                        type="button"
                        class="platform-chip"
                        class:platform-chip-selected={selectedPlatforms.includes(option)}
                        class:platform-chip-disabled={!isPremiumUser()}
                        disabled={!isPremiumUser()}
                        onclick={() => togglePlatform(option)}
                        aria-labelledby="platforms-label"
                      >
                        {option === 'TikTok' ? '🎵' : '📸'} {option}
                      </button>
                    {/each}
                  </div>
                </div>

                <div class="field-row">
                  <div class="field-group">
                    <label for="simple-min" class="field-label">Min followers</label>
                    <input id="simple-min" type="number" class="editorial-input" class:input-disabled={!isPremiumUser()} bind:value={minFollowersLocal} oninput={scheduleAutosave} min="0" step="1000" placeholder="10,000" disabled={!isPremiumUser()} />
                  </div>
                  <div class="field-group">
                    <label for="simple-max" class="field-label">Max followers</label>
                    <input id="simple-max" type="number" class="editorial-input" class:input-disabled={!isPremiumUser()} bind:value={maxFollowersLocal} oninput={scheduleAutosave} min="0" step="1000" placeholder="500,000" disabled={!isPremiumUser()} />
                  </div>
                </div>

                <hr class="section-divider section-divider-light" />

                <div class="toggle-row" class:toggle-disabled={!isPremiumUser()}>
                  <button
                    type="button"
                    disabled={!isPremiumUser()}
                    onclick={() => strictLocationMatching = !strictLocationMatching}
                    id="simple-strict-location"
                    class="toggle-switch"
                    class:toggle-active={strictLocationMatching}
                    role="switch"
                    aria-checked={strictLocationMatching}
                    aria-label="Toggle strict location matching"
                  >
                    <span class="toggle-knob"></span>
                  </button>
                  <div class="toggle-content">
                    <label id="simple-strict-location-label" class="toggle-label" for="simple-strict-location">Strict location matching</label>
                    <p class="toggle-description">Only show creators with verified locations</p>
                  </div>
                </div>
              </div>
            </div>
          {/if}

          <!-- Navigation buttons - sticky at bottom (hidden on website step) -->
          {#if !isWebsiteStep}
          <div class="form-navigation">
            <button
              type="button"
              onclick={prevStep}
              class="nav-btn-secondary"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              Back
            </button>

            {#if isLastStep}
              <button
                type="submit"
                disabled={isSearchFormSubmitting}
                class="nav-btn-primary"
                class:nav-btn-loading={isSearchFormSubmitting}
              >
                {#if isSearchFormSubmitting}
                  <span class="btn-spinner"></span>
                  Launching...
                {:else}
                  Launch search
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                {/if}
              </button>
            {:else}
              <button
                type="button"
                onclick={nextStep}
                class="nav-btn-primary"
              >
                Continue
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>
            {/if}
          </div>
          {/if}
        </form>
      </div>
    </div>
  </div>
  <!-- End of Sliding Panel -->

  <!-- Pipeline status content (shown in main-content-area when pipelineStatus exists) -->
  {#if pipelineStatus}
    <div class="pipeline-overlay">
      <div style="flex-shrink: 0; padding: 32px 32px 0 32px;">
        {#if pipelineError}
          <div style="padding: 16px 20px; background: color-mix(in srgb, var(--color-error) 8%, transparent); backdrop-filter: blur(10px); border: 1px solid color-mix(in srgb, var(--color-error) 20%, transparent); border-radius: 12px; color: var(--color-error); font-size: 14px; margin-bottom: 24px;">
            {pipelineError.message}
          </div>
        {/if}
      </div>

      {#if !shouldShowResults()}
        <!-- Running/Preliminary: Show ghosty preview with cycling animation (only when no progressive results yet) -->
        <div style="flex: 1; min-height: 0; overflow-y: auto; padding: 0 32px 32px 32px;">
          {#if previewDisplayProfiles().length > 0}
            {@const isProgressive = isProgressivePreview()}
            {@const list = previewDisplayProfiles()}
            <div style="display: flex; flex-direction: column; gap: 16px;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <p style="font-size: 16px; font-weight: 600; color: var(--color-text); margin: 0;">Preview</p>
                    <span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; background: color-mix(in srgb, var(--color-bg-elevated) 70%, transparent); backdrop-filter: blur(10px); border: 1px solid var(--color-border); border-radius: 999px; font-size: 11px; color: var(--color-text-secondary); box-shadow: var(--shadow-sm);">
                      <span style="width: 6px; height: 6px; background: var(--color-primary); border-radius: 50%; animation: pulse 1.5s ease-in-out infinite;"></span>
                      Searching...
                    </span>
                  </div>
                  <span style="font-size: 11px; color: var(--color-text-muted);">
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
                              <span style="font-weight: 600; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{profile?.display_name ?? profile?.profile_url ?? 'Profile'}</span>
                              {#if profile?.platform}
                                <span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border: 1px solid var(--color-border); border-radius: 999px; font-size: 11px; color: var(--color-text-muted); background: color-mix(in srgb, var(--color-bg-elevated) 40%, transparent);">
                                  {profile.platform === 'TikTok' ? '🎵' : '📸'} {profile.platform}
                                </span>
                              {/if}
                            </div>
                            {#if profile?.biography || profile?.bio}
                              <p style="font-size: 13px; color: var(--color-text-muted); margin: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">{profile.biography ?? profile.bio}</p>
                            {/if}
                          </div>
                          <div style="flex-shrink: 0; text-align: right; font-size: 13px; color: var(--color-text-muted);">
                            {#if profile?.followers}
                              <div>{profile.followers.toLocaleString()} followers</div>
                            {/if}
                          </div>
                        </div>
                      </div>
                    {/each}
                  </div>
                {/key}
                <p style="font-size: 12px; text-align: center; color: var(--color-text-muted); font-style: italic; margin: 0;">
                  Preliminary matches. Final results may differ after analysis.
                </p>
            </div>
          {:else}
            <!-- No preview profiles yet - show "Starting Search" -->
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; padding: 48px;">
              <div style="display: flex; flex-direction: column; align-items: center; gap: 16px;">
                <!-- Animated search icon -->
                <div style="width: 64px; height: 64px; border-radius: 50%; background: linear-gradient(135deg, var(--color-primary), var(--color-primary-hover)); display: flex; align-items: center; justify-content: center; animation: pulse 2s ease-in-out infinite;">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="11" cy="11" r="8"></circle>
                    <path d="m21 21-4.35-4.35"></path>
                  </svg>
                </div>
                <!-- "Starting Search" with animated dots -->
                <div style="font-size: 18px; font-weight: 600; color: var(--color-text);">
                  Starting Search<span class="animated-dots"></span>
                </div>
                <p style="font-size: 14px; color: var(--color-text-muted); text-align: center; max-width: 320px; margin: 0;">
                  We're generating search queries to find the best creators for your campaign.
                </p>
              </div>
            </div>
          {/if}
        </div>
      {/if}

      {#if shouldShowResults()}
        <!-- Scrollable table area -->
        <div style="flex: 1; min-height: 0; overflow-y: auto;">
          <div style="padding: 0 32px 32px 32px;">
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
        </div>
        <!-- Bottom Action Bar -->
        <div style="border-top: 1px solid var(--color-border); background: var(--color-bg-elevated); flex-shrink: 0; box-shadow: 0 -2px 10px color-mix(in srgb, var(--color-text) 5%, transparent);">
          <!-- Selection row / Pipeline status row -->
          <div style="padding: 16px 32px; border-bottom: 1px solid var(--color-border); display: flex; align-items: center; justify-content: space-between;">
            {#if isCompleted()}
              <!-- Show selection controls when pipeline is completed -->
              <div style="display: flex; align-items: center; gap: 20px;">
                <div style="display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; background: linear-gradient(135deg, var(--color-primary), var(--color-primary-hover)); border-radius: 8px;">
                  <span style="font-size: 14px; font-weight: 600; color: white;">
                    {selectedCount} {selectedCount === 1 ? 'creator' : 'creators'} selected
                  </span>
                </div>
                {#if selectedCount === 0}
                  <div style="position: relative;">
                    <button
                      type="button"
                      class="select-link-btn-light select-all-light"
                      onclick={() => { selectAllInfluencers(); dismissSelectAllHint(); }}
                    >
                      Select all
                    </button>
                    {#if showSelectAllHint}
                      <div class="select-all-hint" transition:fly={{ y: -10, duration: 200 }}>
                        <div class="hint-arrow"></div>
                        <div class="hint-content">
                          <span class="hint-icon">👆</span>
                          <span class="hint-text">Now, select influencers to send outreach to!</span>
                          <button type="button" class="hint-dismiss" onclick={dismissSelectAllHint}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <path d="M18 6L6 18M6 6l12 12"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    {/if}
                  </div>
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
            {:else}
              <!-- Show pipeline status when still running (progressive results) -->
              {@const batchesCompleted = pipelineStatus?.stages?.brightdata_collection?.batches_completed ?? 0}
              {@const totalBatches = pipelineStatus?.stages?.brightdata_collection?.total_batches ?? 0}
              {@const progress = pipelineStatus?.overall_progress ?? 0}
              <div style="flex: 1; display: flex; align-items: center; gap: 16px;">
                <!-- Animated pulse indicator -->
                <div style="width: 10px; height: 10px; background: var(--color-primary); border-radius: 50%; animation: pulse 1.5s ease-in-out infinite; flex-shrink: 0;"></div>

                <!-- Progress bar and text -->
                <div style="flex: 1; display: flex; flex-direction: column; gap: 6px;">
                  <div style="display: flex; align-items: center; justify-content: space-between;">
                    <span style="font-size: 14px; font-weight: 500; color: var(--color-text);">
                      Showing best {pipelineStatus?.profiles?.length ?? 0} matches so far
                    </span>
                    <span style="font-size: 12px; color: var(--color-text-muted);">
                      {Math.round($tweenedProgress)}%
                    </span>
                  </div>
                  <!-- Progress bar -->
                  <div style="height: 6px; background: var(--color-border); border-radius: 3px; overflow: hidden;">
                    <div style="height: 100%; width: {$tweenedProgress}%; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-hover)); border-radius: 3px;"></div>
                  </div>
                  {#if batchesCompleted > 0 && totalBatches > 0}
                    <span style="font-size: 11px; color: var(--color-text-muted);">
                      {batchesCompleted} of {totalBatches} batches complete — results update as more finish
                    </span>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
            
            <!-- Status indicators & Action row -->
            <div style="padding: 20px 32px; display: flex; align-items: center; justify-content: flex-end; gap: 12px;">
              <!-- Step 1: Gmail status indicator -->
              <div style="position: relative;">
                <div
                  style="display: flex; align-items: center; gap: 8px; padding: 13px 32px; border-radius: 8px; cursor: pointer; transition: all 0.2s; background: {gmailConnected ? 'color-mix(in srgb, var(--color-success) 8%, transparent)' : 'color-mix(in srgb, var(--color-error) 8%, transparent)'}; border: 1px solid {gmailConnected ? 'color-mix(in srgb, var(--color-success) 20%, transparent)' : 'color-mix(in srgb, var(--color-error) 20%, transparent)'}; min-width: 224px;"
                  onclick={() => inboxPopupOpen = true}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => e.key === 'Enter' && (inboxPopupOpen = true)}
                >
                  <div style="display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: {gmailConnected ? 'var(--color-success)' : 'var(--color-error)'}; color: white; font-size: 11px; font-weight: 700;">
                    {#if gmailConnected}
                      ✓
                    {:else}
                      1
                    {/if}
                  </div>
                  <div style="display: flex; flex-direction: column;">
                    <span style="font-size: 12px; font-weight: 500; color: {gmailConnected ? 'var(--color-success)' : 'var(--color-error)'};">
                      {gmailConnected ? 'Email Selected' : 'Select Email'}
                    </span>
                    <span style="font-size: 10px; color: {gmailConnected ? 'color-mix(in srgb, var(--color-success) 70%, transparent)' : 'color-mix(in srgb, var(--color-error) 70%, transparent)'};">
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
                  style="display: flex; align-items: center; gap: 8px; padding: 13px 32px; border-radius: 8px; cursor: pointer; transition: all 0.2s; background: {templateSaved ? 'color-mix(in srgb, var(--color-success) 8%, transparent)' : 'color-mix(in srgb, var(--color-error) 8%, transparent)'}; border: 1px solid {templateSaved ? 'color-mix(in srgb, var(--color-success) 20%, transparent)' : 'color-mix(in srgb, var(--color-error) 20%, transparent)'}; min-width: 224px;"
                  onclick={() => showEmailPopup = true}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => e.key === 'Enter' && (showEmailPopup = true)}
                  class={templateSaved ? '' : 'attention-pulse'}
                >
                  <div style="display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: {templateSaved ? 'var(--color-success)' : 'var(--color-error)'}; color: white; font-size: 11px; font-weight: 700;">
                    {#if templateSaved}
                      ✓
                    {:else}
                      2
                    {/if}
                  </div>
                  <div style="display: flex; flex-direction: column;">
                    <span style="font-size: 12px; font-weight: 500; color: {templateSaved ? 'var(--color-success)' : 'var(--color-error)'};">
                      {templateSaved ? 'Draft Complete' : 'Draft Incomplete'}
                    </span>
                    <span style="font-size: 10px; color: {templateSaved ? 'color-mix(in srgb, var(--color-success) 70%, transparent)' : 'color-mix(in srgb, var(--color-error) 70%, transparent)'};">
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
                  style="display: flex; align-items: center; gap: 8px; padding: 13px 32px; border-radius: 8px; cursor: {selectedCount === 0 || draftInFlight || !gmailConnected || !templateSaved ? 'not-allowed' : 'pointer'}; transition: all 0.2s; background: {gmailConnected && templateSaved && selectedCount > 0 && !draftInFlight ? 'color-mix(in srgb, var(--color-success) 8%, transparent)' : 'color-mix(in srgb, var(--color-error) 8%, transparent)'}; border: 1px solid {gmailConnected && templateSaved && selectedCount > 0 && !draftInFlight ? 'color-mix(in srgb, var(--color-success) 20%, transparent)' : 'color-mix(in srgb, var(--color-error) 20%, transparent)'}; min-width: 224px; opacity: {selectedCount === 0 || draftInFlight || !gmailConnected || !templateSaved ? '0.5' : '1'};"
                  onclick={selectedCount > 0 && !draftInFlight && gmailConnected && templateSaved ? createGmailDrafts : null}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => e.key === 'Enter' && selectedCount > 0 && !draftInFlight && gmailConnected && templateSaved && createGmailDrafts()}
                  class={(selectedCount === 0 || !gmailConnected || !templateSaved) && !draftInFlight ? 'attention-pulse' : ''}
                >
                  <div style="display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: {gmailConnected && templateSaved && selectedCount > 0 && !draftInFlight ? 'var(--color-success)' : 'var(--color-error)'}; color: white; font-size: 11px; font-weight: 700;">
                    {#if gmailConnected && templateSaved && selectedCount > 0 && !draftInFlight}
                      ✓
                    {:else}
                      3
                    {/if}
                  </div>
                  <div style="display: flex; flex-direction: column;">
                    <span style="font-size: 12px; font-weight: 500; color: {gmailConnected && templateSaved && selectedCount > 0 && !draftInFlight ? 'var(--color-success)' : 'var(--color-error)'};">
                      {#if draftInFlight}
                        Sending…
                      {:else if gmailConnected && templateSaved && selectedCount > 0}
                        Ready to Send
                      {:else}
                        Send Outreach
                      {/if}
                    </span>
                    <span style="font-size: 10px; color: {gmailConnected && templateSaved && selectedCount > 0 && !draftInFlight ? 'color-mix(in srgb, var(--color-success) 70%, transparent)' : 'color-mix(in srgb, var(--color-error) 70%, transparent)'};">
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
        {:else}
          {@const batchesCompleted = pipelineStatus?.stages?.brightdata_collection?.batches_completed ?? 0}
          {@const totalBatches = pipelineStatus?.stages?.brightdata_collection?.total_batches ?? 0}
          {@const progress = pipelineStatus?.overall_progress ?? 0}
          <!-- During search or loading: show bottom bar with pipeline status -->
          <div style="border-top: 1px solid var(--color-border); background: var(--color-bg-elevated); flex-shrink: 0; box-shadow: 0 -2px 10px color-mix(in srgb, var(--color-text) 5%, transparent); margin-top: auto;">
            <!-- Pipeline status row -->
            <div style="padding: 16px 32px; border-bottom: 1px solid var(--color-border); display: flex; align-items: center; gap: 16px;">
              <!-- Animated pulse indicator -->
              <div style="width: 10px; height: 10px; background: var(--color-primary); border-radius: 50%; animation: pulse 1.5s ease-in-out infinite; flex-shrink: 0;"></div>

              <!-- Progress bar and text -->
              <div style="flex: 1; display: flex; flex-direction: column; gap: 6px;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <span style="font-size: 14px; font-weight: 500; color: var(--color-text);">
                    {#if pipelineStatus?.current_stage === 'query_expansion'}
                      Generating search queries...
                    {:else if pipelineStatus?.current_stage === 'weaviate_search'}
                      Searching for creators...
                    {:else if pipelineStatus?.current_stage === 'brightdata_collection' || pipelineStatus?.current_stage === 'llm_analysis'}
                      Analyzing profiles...
                    {:else}
                      Starting search...
                    {/if}
                  </span>
                  <span style="font-size: 12px; color: var(--color-text-muted);">
                    {Math.round($tweenedProgress)}%
                  </span>
                </div>
                <!-- Progress bar -->
                <div style="height: 6px; background: var(--color-border); border-radius: 3px; overflow: hidden;">
                  <div style="height: 100%; width: {progress}%; background: linear-gradient(90deg, var(--color-primary), var(--color-primary-hover)); border-radius: 3px; transition: width 0.3s ease;"></div>
                </div>
                {#if batchesCompleted > 0 && totalBatches > 0}
                  <span style="font-size: 11px; color: var(--color-text-muted);">
                    {batchesCompleted} of {totalBatches} batches complete
                  </span>
                {/if}
              </div>
            </div>

            <!-- Email drafting row -->
            <div style="padding: 16px 32px; display: flex; align-items: center; justify-content: space-between; gap: 16px;">
              <span style="font-size: 13px; color: var(--color-text-muted);">
                Draft your email while you wait...
              </span>

              <div style="display: flex; align-items: center; gap: 16px;">
                <!-- Gmail status -->
                <div style="position: relative;">
                  <button
                    type="button"
                    style="display: flex; align-items: center; gap: 6px; padding: 11px 26px; background: color-mix(in srgb, var(--color-bg-elevated) 90%, transparent); border: 1px solid var(--color-border); border-radius: 8px; cursor: pointer; transition: all 0.2s; box-shadow: var(--shadow-sm); min-width: 160px;"
                    onclick={() => inboxPopupOpen = true}
                    class={!gmailConnected ? 'attention-pulse' : ''}
                  >
                    {#if gmailConnected}
                      <span style="width: 8px; height: 8px; background: var(--color-success); border-radius: 50%;"></span>
                      <span style="font-size: 13px; color: var(--color-text-secondary);">{gmailConnections.length} inbox{gmailConnections.length !== 1 ? 'es' : ''}</span>
                    {:else}
                      <span style="width: 8px; height: 8px; background: var(--color-border-strong); border-radius: 50%;"></span>
                      <span style="font-size: 13px; color: var(--color-primary); font-weight: 500;">Connect Gmail</span>
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
                    style="display: flex; align-items: center; gap: 6px; padding: 11px 26px; background: color-mix(in srgb, var(--color-bg-elevated) 90%, transparent); border: 1px solid var(--color-border); border-radius: 8px; cursor: pointer; transition: all 0.2s; box-shadow: var(--shadow-sm); min-width: 160px;"
                    onclick={() => showEmailPopup = true}
                    class={!templateSaved ? 'attention-pulse' : ''}
                  >
                    {#if templateSaved}
                      <span style="width: 8px; height: 8px; background: var(--color-success); border-radius: 50%;"></span>
                    {:else}
                      <span style="width: 8px; height: 8px; background: var(--color-warning); border-radius: 50%;"></span>
                    {/if}
                    <span style="font-size: 13px; color: var(--color-text-secondary);">{templateStatusText()}</span>
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
        <div class="flex items-center gap-2">
          <Button variant="primary" size="sm" onclick={quickDraftEmail} disabled={isQuickDrafting}>
            {isQuickDrafting ? 'Drafting…' : 'Penni Quick Draft'}
          </Button>
          <Button variant="secondary" size="sm" onclick={() => showDraftOptionsModal = true} disabled={isQuickDrafting}>
            Customize
          </Button>
        </div>
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

<DraftOptionsModal
  open={showDraftOptionsModal}
  campaignId={campaignId ?? effectiveCampaign?.id ?? ''}
  platform="email"
  onClose={() => showDraftOptionsModal = false}
  onDraftGenerated={(content) => {
    emailTemplate = content;
    showDraftOptionsModal = false;
  }}
/>

<GmailAccountTypeModal
  open={showGmailTypeModal}
  onSelect={handleGmailTypeSelect}
  onCancel={() => showGmailTypeModal = false}
/>

<style>
  /* ========================================
     EDITORIAL DESIGN SYSTEM
     Matching landing page aesthetics
     ======================================== */

  /* Animated dots for "Starting Search..." */
  .animated-dots::after {
    content: '';
    animation: dots 1.5s steps(4, end) infinite;
  }

  @keyframes dots {
    0%, 20% { content: ''; }
    40% { content: '.'; }
    60% { content: '..'; }
    80%, 100% { content: '...'; }
  }

  /* CSS Variables for editorial design */
  .sliding-panel {
    --coral: #FF6F61;
    --coral-dark: #e85d50;
    --ink: #1a1a1a;
    --ink-light: #4a4a4a;
    --ink-muted: #8a8a8a;
    --paper: #fafaf9;
    --paper-warm: #f5f4f2;
    --border-light: #e8e6e3;
  }

  /* ========================================
     SLIDING PANEL STYLES
     ======================================== */
  .panel-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--color-bg-elevated);
    position: relative;
    overflow: hidden;
  }

  .main-content-area {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    z-index: 1;
  }

  .panel-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 10;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }

  .sliding-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 80%;
    background: var(--paper);
    box-shadow: -20px 0 60px rgba(0, 0, 0, 0.2);
    z-index: 20;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transform: translateX(100%);
    transition: transform 500ms cubic-bezier(0.4, 0, 0.2, 1);
    font-family: 'DM Sans', system-ui, sans-serif;
    will-change: transform;
  }

  .sliding-panel.panel-open {
    transform: translateX(0);
  }

  /* Inline mode - when rendered inside another panel overlay */
  .sliding-panel.inline-panel {
    position: relative;
    width: 100%;
    height: 100%;
    top: auto;
    right: auto;
    bottom: auto;
    transform: none;
    box-shadow: none;
    z-index: 1;
  }

  .panel-container.inline-mode {
    height: 100%;
  }

  /* Panel decorative elements */
  .panel-grid-pattern {
    position: absolute;
    inset: 0;
    background-image: linear-gradient(var(--border-light) 1px, transparent 1px), linear-gradient(90deg, var(--border-light) 1px, transparent 1px);
    background-size: 40px 40px;
    pointer-events: none;
    opacity: 0.3;
  }

  .panel-orb {
    position: absolute;
    pointer-events: none;
    border-radius: 50%;
  }

  .panel-orb-top {
    top: -15%;
    right: -5%;
    width: 500px;
    height: 500px;
    background: radial-gradient(circle, rgba(255, 111, 97, 0.08) 0%, transparent 70%);
    filter: blur(80px);
  }

  .panel-orb-bottom {
    bottom: -20%;
    left: -10%;
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, rgba(147, 112, 219, 0.06) 0%, transparent 70%);
    filter: blur(100px);
  }

  /* Close button */
  .panel-close-btn {
    position: absolute;
    top: 24px;
    right: 24px;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--ink-muted);
    cursor: pointer;
    border-radius: 50%;
    transition: all 0.2s ease;
    z-index: 10;
  }

  .panel-close-btn:hover {
    background: var(--border-light);
    color: var(--ink);
  }

  /* Panel content wrapper */
  .panel-content-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 48px 56px;
    overflow-y: auto;
    position: relative;
    z-index: 1;
  }

  /* Top bar with step indicator */
  .panel-top-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 24px;
  }

  .step-label {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--ink-muted);
    text-transform: uppercase;
    letter-spacing: 0.15em;
  }

  .step-divider {
    width: 4px;
    height: 4px;
    background: var(--border-light);
    border-radius: 50%;
  }

  .step-name {
    font-size: 0.7rem;
    color: var(--coral);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  /* Progress bar */
  .panel-progress-bar {
    width: 100%;
    height: 2px;
    background: var(--border-light);
    margin-bottom: 56px;
    position: relative;
    overflow: hidden;
  }

  .panel-progress-fill {
    height: 100%;
    background: var(--coral);
    transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }

  /* Form container */
  .panel-form-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .editorial-form {
    display: flex;
    flex-direction: column;
    flex: 1;
    width: 100%;
  }

  .form-step {
    display: flex;
    flex-direction: column;
    flex: 1;
  }

  /* Website Hero Step */
  .website-step {
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 2rem;
  }

  .website-hero {
    max-width: 500px;
    width: 100%;
  }

  .website-hero-title {
    font-family: 'Instrument Serif', Georgia, serif;
    font-size: clamp(2.5rem, 5vw, 3.5rem);
    font-weight: 400;
    color: var(--ink);
    margin: 0 0 0.75rem 0;
    line-height: 1.1;
  }

  .website-hero-subtitle {
    font-size: 1.1rem;
    color: var(--ink-muted);
    margin: 0 0 2.5rem 0;
    line-height: 1.5;
  }

  .website-input-wrapper {
    display: flex;
    align-items: center;
    gap: 0;
    background: white;
    border: 2px solid var(--border-light);
    border-radius: 3rem;
    padding: 0.25rem;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .website-input-wrapper:focus-within {
    border-color: var(--coral);
    box-shadow: 0 0 0 4px rgba(255, 111, 97, 0.1);
  }

  .website-hero-input {
    flex: 1;
    border: none;
    background: transparent;
    padding: 1rem 1.5rem;
    font-size: 1.1rem;
    color: var(--ink);
    outline: none;
  }

  .website-hero-input::placeholder {
    color: var(--ink-muted);
  }

  .website-hero-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    background: var(--coral);
    color: white;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .website-hero-btn:hover:not(:disabled) {
    background: var(--coral-dark);
    transform: scale(1.05);
  }

  .website-hero-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .btn-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .website-error {
    color: #ef4444;
    font-size: 0.875rem;
    margin: 1rem 0 0 0;
  }

  .website-manual-link {
    display: inline-block;
    margin-top: 2rem;
    padding: 0;
    background: none;
    border: none;
    color: var(--ink-muted);
    font-size: 0.9rem;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
    transition: color 0.2s ease;
  }

  .website-manual-link:hover:not(:disabled) {
    color: var(--coral);
  }

  .website-manual-link:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Step header */
  .step-header {
    margin-bottom: 8px;
  }

  .step-number-large {
    display: block;
    font-family: 'Instrument Serif', Georgia, serif;
    font-size: 4rem;
    color: var(--coral);
    line-height: 1;
    margin-bottom: 16px;
    opacity: 0.9;
  }

  .step-title {
    font-family: 'Instrument Serif', Georgia, serif;
    font-size: clamp(1.75rem, 3vw, 2.25rem);
    font-weight: 400;
    color: var(--ink);
    margin: 0 0 12px 0;
    line-height: 1.2;
  }

  .step-subtitle {
    font-size: 1rem;
    color: var(--ink-light);
    margin: 0;
    line-height: 1.6;
  }

  /* Section divider */
  .section-divider {
    border: none;
    height: 1px;
    background: var(--border-light);
    margin: 32px 0;
  }

  .section-divider-light {
    margin: 24px 0;
    opacity: 0.6;
  }

  /* Form fields */
  .form-fields {
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .field-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }

  .field-label {
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--ink-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .field-optional {
    font-weight: 400;
    color: var(--ink-muted);
    opacity: 0.7;
    text-transform: none;
    letter-spacing: 0;
  }

  .field-required {
    color: var(--color-error, #dc2626);
    font-weight: 500;
  }

  .field-error-message {
    margin: 6px 0 0 0;
    font-size: 0.85rem;
    color: var(--color-error, #dc2626);
  }

  .input-error {
    border-bottom-color: var(--color-error, #dc2626) !important;
  }

  /* Editorial input - bottom border only */
  .editorial-input {
    width: 100%;
    padding: 16px 0;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border-light);
    color: var(--ink);
    font-size: 1.1rem;
    font-family: 'DM Sans', system-ui, sans-serif;
    outline: none;
    transition: border-color 0.2s ease;
    resize: none;
  }

  .editorial-input::placeholder {
    color: var(--ink-muted);
    opacity: 0.6;
  }

  .editorial-input:focus {
    border-bottom-color: var(--coral);
  }

  .editorial-textarea {
    min-height: 80px;
    line-height: 1.6;
  }

  .input-disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Premium locked state */
  .form-step.premium-locked {
    position: relative;
  }

  .form-step.premium-locked > *:not(.premium-overlay) {
    filter: blur(3px);
    pointer-events: none;
    user-select: none;
  }

  .premium-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(255, 111, 97, 0.15) 0%, rgba(255, 111, 97, 0.25) 100%);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
  }

  .premium-overlay-content {
    text-align: center;
    padding: 2rem;
    max-width: 400px;
  }

  .premium-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: var(--coral);
    color: white;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border-radius: 2rem;
    margin-bottom: 1.5rem;
  }

  .premium-badge svg {
    width: 16px;
    height: 16px;
  }

  .premium-overlay-title {
    font-family: 'Instrument Serif', Georgia, serif;
    font-size: 1.75rem;
    font-weight: 400;
    color: var(--ink);
    margin: 0 0 0.75rem;
  }

  .premium-overlay-text {
    font-size: 0.9rem;
    color: var(--ink-light);
    line-height: 1.6;
    margin: 0 0 1.5rem;
  }

  .premium-overlay-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.875rem 1.75rem;
    background: var(--coral);
    color: white;
    font-size: 0.9rem;
    font-weight: 600;
    border: none;
    border-radius: 2rem;
    cursor: pointer;
    transition: all 0.25s ease;
    box-shadow: 0 4px 16px rgba(255, 111, 97, 0.35);
  }

  .premium-overlay-btn:hover {
    background: var(--coral-dark);
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(255, 111, 97, 0.45);
  }

  /* Slider styles */
  .slider-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .slider-value {
    font-family: 'Instrument Serif', Georgia, serif;
    font-size: 1.5rem;
    color: var(--coral);
  }

  .editorial-slider {
    width: 100%;
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(to right, var(--coral) 0%, var(--coral) var(--slider-percent, 0%), var(--border-light) var(--slider-percent, 0%), var(--border-light) 100%);
    outline: none;
    -webkit-appearance: none;
    appearance: none;
    cursor: pointer;
    margin: 12px 0;
  }

  .editorial-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--coral);
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(255, 111, 97, 0.3);
    transition: all 0.2s;
  }

  .editorial-slider::-webkit-slider-thumb:hover {
    transform: scale(1.15);
    box-shadow: 0 4px 12px rgba(255, 111, 97, 0.4);
  }

  .editorial-slider::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--coral);
    cursor: pointer;
    border: none;
    box-shadow: 0 2px 8px rgba(255, 111, 97, 0.3);
    transition: all 0.2s;
  }

  .slider-range-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--ink-muted);
  }

  .slider-range-labels-muted {
    color: rgba(255, 255, 255, 0.5);
  }

  /* Locked slider state */
  .editorial-slider-locked {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .editorial-slider-locked::-webkit-slider-thumb {
    cursor: not-allowed;
  }

  .editorial-slider-locked::-moz-range-thumb {
    cursor: not-allowed;
  }

  /* Minimal creators count wrapper */
  .creators-count-minimal {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
  }

  .creators-count-minimal-error .editorial-slider-locked {
    background: linear-gradient(to right, #ef4444 0%, #ef4444 var(--slider-percent, 0%), var(--border-light) var(--slider-percent, 0%), var(--border-light) 100%);
  }

  .creators-count-error {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 8px;
    color: #ef4444;
    font-size: 0.8rem;
  }

  .creators-count-error svg {
    flex-shrink: 0;
  }

  .creators-count-error span {
    flex: 1;
  }

  .creators-count-upgrade-btn {
    flex-shrink: 0;
    padding: 4px 10px;
    font-size: 0.75rem;
    font-weight: 600;
    color: #fff;
    background: #ef4444;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.2s ease;
  }

  .creators-count-upgrade-btn:hover {
    background: #dc2626;
  }

  /* Platform chips */
  .platform-options {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .platform-chip {
    padding: 12px 24px;
    font-size: 0.95rem;
    font-weight: 500;
    border-radius: 999px;
    border: 1px solid var(--border-light);
    background: transparent;
    color: var(--ink-light);
    cursor: pointer;
    transition: all 0.2s ease;
    font-family: 'DM Sans', system-ui, sans-serif;
  }

  .platform-chip:hover:not(:disabled) {
    border-color: var(--coral);
    color: var(--coral);
  }

  .platform-chip-selected {
    border-color: var(--coral);
    background: rgba(255, 111, 97, 0.08);
    color: var(--coral);
  }

  .platform-chip-disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Toggle switch */
  .toggle-row {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 8px 0;
  }

  .toggle-disabled {
    opacity: 0.5;
  }

  .toggle-switch {
    position: relative;
    width: 44px;
    height: 24px;
    border-radius: 999px;
    border: none;
    cursor: pointer;
    transition: background 0.2s ease;
    background: var(--border-light);
    flex-shrink: 0;
  }

  .toggle-switch.toggle-active {
    background: var(--coral);
  }

  .toggle-switch:disabled {
    cursor: not-allowed;
  }

  .toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background: white;
    border-radius: 50%;
    transition: left 0.2s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  }

  .toggle-active .toggle-knob {
    left: 22px;
  }

  .toggle-content {
    flex: 1;
  }

  .toggle-label {
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--ink);
    display: block;
  }

  .toggle-description {
    font-size: 0.8rem;
    color: var(--ink-muted);
    margin: 4px 0 0 0;
  }

  /* Premium upsell */
  .premium-upsell {
    padding: 24px 0;
    margin-bottom: 24px;
    border-bottom: 1px solid var(--border-light);
  }

  .premium-upsell-content {
    max-width: 100%;
  }

  .premium-upsell-title {
    font-family: 'Instrument Serif', Georgia, serif;
    font-size: 1.25rem;
    font-weight: 400;
    color: var(--ink);
    margin: 0 0 8px 0;
  }

  .premium-upsell-text {
    font-size: 0.9rem;
    color: var(--ink-light);
    margin: 0 0 20px 0;
    line-height: 1.6;
  }

  .premium-upsell-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 24px;
    font-size: 0.9rem;
    font-weight: 600;
    border-radius: 999px;
    background: var(--coral);
    color: white;
    text-decoration: none;
    transition: all 0.2s ease;
    border: none;
    cursor: pointer;
    font-family: 'DM Sans', system-ui, sans-serif;
  }

  .premium-upsell-btn:hover {
    background: var(--coral-dark);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(255, 111, 97, 0.3);
  }

  /* Form navigation */
  .form-navigation {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 40px;
    margin-top: auto;
    border-top: 1px solid var(--border-light);
  }

  .nav-btn-secondary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 14px 28px;
    font-size: 0.95rem;
    font-weight: 500;
    border-radius: 999px;
    border: 1px solid var(--border-light);
    background: transparent;
    color: var(--ink-light);
    cursor: pointer;
    transition: all 0.2s ease;
    font-family: 'DM Sans', system-ui, sans-serif;
  }

  .nav-btn-secondary:hover {
    border-color: var(--ink);
    color: var(--ink);
  }

  .nav-btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 14px 32px;
    font-size: 0.95rem;
    font-weight: 600;
    border-radius: 999px;
    border: none;
    background: var(--coral);
    color: white;
    cursor: pointer;
    transition: all 0.2s ease;
    font-family: 'DM Sans', system-ui, sans-serif;
  }

  .nav-btn-primary:hover:not(:disabled) {
    background: var(--coral-dark);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(255, 111, 97, 0.3);
  }

  .nav-btn-primary:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .nav-btn-loading {
    pointer-events: none;
  }

  .btn-spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  /* ========================================
     ORIGINAL STYLES (preserved)
     ======================================== */
  .pipeline-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    z-index: 5;
  }

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
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-primary) 50%, transparent);
    }
    70% {
      box-shadow: 0 0 0 10px color-mix(in srgb, var(--color-primary) 0%, transparent);
    }
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-primary) 0%, transparent);
    }
  }

  .attention-pulse {
    animation: pulse-red 1.5s ease-out infinite;
  }

  /* Loading spinner */
  .loading-spinner {
    width: 48px;
    height: 48px;
    border: 3px solid color-mix(in srgb, var(--color-primary) 20%, transparent);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 1s linear infinite;
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
    color: var(--color-primary);
  }

  .select-link-btn-light.select-all-light:hover {
    color: var(--color-primary-hover);
  }

  .select-link-btn-light.clear-selection-light {
    color: var(--color-text-secondary);
  }

  .select-link-btn-light.clear-selection-light:hover {
    color: var(--color-text-secondary);
  }

  /* Select All hint popup */
  .select-all-hint {
    position: absolute;
    top: calc(100% + 12px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 100;
    animation: hint-pulse 2s ease-in-out infinite;
  }

  @keyframes hint-pulse {
    0%, 100% { transform: translateX(-50%) scale(1); }
    50% { transform: translateX(-50%) scale(1.02); }
  }

  .hint-arrow {
    position: absolute;
    top: -8px;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 10px solid transparent;
    border-right: 10px solid transparent;
    border-bottom: 10px solid var(--color-primary);
  }

  .hint-content {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: var(--color-primary);
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    white-space: nowrap;
  }

  .hint-icon {
    font-size: 18px;
  }

  .hint-text {
    font-size: 14px;
    font-weight: 500;
    color: white;
  }

  .hint-dismiss {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: rgba(255, 255, 255, 0.2);
    border: none;
    border-radius: 50%;
    color: white;
    cursor: pointer;
    transition: background 0.2s;
  }

  .hint-dismiss:hover {
    background: rgba(255, 255, 255, 0.3);
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
    background: linear-gradient(135deg, var(--color-error), color-mix(in srgb, var(--color-error) 80%, #000));
    color: white;
    padding: 10px 16px;
    border-radius: 12px;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    box-shadow: 0 4px 16px color-mix(in srgb, var(--color-error) 30%, transparent);
    z-index: 40;
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
    border-color: color-mix(in srgb, var(--color-error) 80%, #000) transparent transparent transparent;
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
    background: color-mix(in srgb, var(--color-bg-elevated) 40%, transparent);
    border: 1.5px dashed var(--color-border);
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
      color-mix(in srgb, var(--color-bg-elevated) 30%, transparent) 50%,
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
      color-mix(in srgb, var(--color-primary) 10%, transparent),
      color-mix(in srgb, var(--color-primary) 5%, transparent)
    );
    -webkit-mask: linear-gradient(var(--color-text-inverse) 0 0) content-box, linear-gradient(var(--color-text-inverse) 0 0);
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

  /* ========================================
     RESPONSIVE STYLES
     ======================================== */
  @media (max-width: 768px) {
    .sliding-panel {
      width: 100%;
      max-width: 100%;
    }

    .panel-content-wrapper {
      padding: 32px 24px;
    }

    .panel-close-btn {
      top: 16px;
      right: 16px;
    }

    .step-number-large {
      font-size: 3rem;
    }

    .step-title {
      font-size: 1.5rem;
    }

    .field-row {
      grid-template-columns: 1fr;
    }

    .form-navigation {
      flex-direction: column;
      gap: 12px;
    }

    .nav-btn-secondary,
    .nav-btn-primary {
      width: 100%;
      justify-content: center;
    }

    .nav-btn-secondary {
      order: 2;
    }

    .nav-btn-primary {
      order: 1;
    }
  }
</style>
