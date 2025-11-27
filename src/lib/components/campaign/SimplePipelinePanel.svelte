<script lang="ts">
import { browser } from '$app/environment';
import { fly, fade } from 'svelte/transition';
import Button from '$lib/components/Button.svelte';
import PipelineStatusComponent from './PipelineStatus.svelte';
import InfluencersTable from './InfluencersTable.svelte';
import SendOutreachPopupPanel from '$lib/components/outreach/SendOutreachPopupPanel.svelte';
import EmailDraftPrompt from './EmailDraftPrompt.svelte';
import EmailEditor from '$lib/components/EmailEditor.svelte';
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
    onSubmit: (params: SearchParams) => void;
    onRerun?: () => void;
    onFindMore?: (excludeProfileUrls: string[]) => void; // For "Find More Influencers" functionality
    onGoAdvanced: () => void;
    onSendAll?: () => void;
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
    onSubmit,
    onRerun,
    onFindMore,
    onGoAdvanced,
    onSendAll
  }: Props = $props();

  let brand = $state('');
  let website = $state('');
  let about = $state('');
  let influencerType = $state('');
  let platforms = $state('instagram, tiktok');
  let selectedPlatforms = $state<string[]>(['instagram', 'tiktok']);
  let location = $state('');

  let minFollowersLocal = $state<number | null>(10000);
  let maxFollowersLocal = $state<number | null>(500000);
  let topNLocal = $state(searchFormTopN || 10);
  let notes = $state(influencerSummary || '');

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

  let emailTemplate = $state('');
  let templateLastSavedAt: number | null = $state(null);
  let templateSaveTimeout: ReturnType<typeof setTimeout> | null = null;
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
    'Influencer targets',
    'Audience & reach',
    'Extras'
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

  // Preview profiles for preliminary (ghosty) display - show random 10, rotating every 5s
  const previewDisplayProfiles = $derived((): InfluencerProfile[] => {
    const candidates = previewProfiles();
    if (candidates.length <= 10) return candidates;
    // Use campaign ID + rotation seed for shuffling
    const baseSeed = (campaignId ?? effectiveCampaign?.id ?? 'default').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const seed = baseSeed + previewRotationSeed * 12345; // Multiply to get more variation
    return shuffleArray(candidates, seed).slice(0, 10);
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
        : ['instagram', 'tiktok'];
    const list = normalized.filter(Boolean);
    selectedPlatforms = Array.from(new Set(list));
    platforms = selectedPlatforms.join(', ');
  }

  const hasPipeline = $derived(!!(effectiveCampaign?.pipeline_id || pipelineStatus));

  // Keep selectedPlatforms in sync with freeform platforms string (initial load)
  $effect(() => {
    if (!platforms) {
      selectedPlatforms = ['instagram', 'tiktok'];
      platforms = 'instagram, tiktok';
      return;
    }
    const fromString = platforms.split(',').map((p) => p.trim()).filter(Boolean);
    selectedPlatforms = Array.from(new Set(fromString));
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
    if (influencerSummary && !notes) {
      notes = influencerSummary;
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
    if (notes) parts.push(notes);
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
      campaign_id: effectiveCampaign?.id ?? null
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

  function scheduleTemplateSave() {
    if (templateSaveTimeout) clearTimeout(templateSaveTimeout);
    templateSaveTimeout = setTimeout(() => void saveTemplate(), 400);
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
      
      // Show "Saved!" feedback briefly
      templateJustSaved = true;
      setTimeout(() => {
        templateJustSaved = false;
      }, 2000);
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

<div class="flex h-full flex-col bg-white border-l border-gray-200">
  {#if !hasPipeline && !isSearchFormSubmitting}
    <!-- Form mode: Centered card layout -->
    <div class="flex-1 overflow-y-auto flex items-center justify-center px-4 py-6 sm:px-6 sm:py-10">
      <div class="w-full max-w-2xl">
        <div class="relative rounded-3xl bg-white shadow-lg border border-rose-100 px-5 py-6 sm:px-7 sm:py-8 space-y-6">
          {#if searchUsage}
            <div class="flex justify-end">
              <span class="text-[11px] text-gray-500 bg-gray-50 px-2.5 py-1 rounded-full border border-gray-100">
                {searchUsage.remaining}/{searchUsage.limit} left
              </span>
            </div>
          {/if}

          <div class="space-y-1 text-center">
            <h1 class="text-2xl sm:text-3xl font-bold text-gray-900">Campaign search</h1>
            <p class="text-sm text-gray-600">Quickly capture the essentials to launch an influencer search.</p>
          </div>

          <div class="flex items-center justify-center gap-2 text-xs text-gray-500">
            {#each steps as label, index}
              <div class={`h-2 w-8 rounded-full transition ${index === step ? 'bg-rose-400' : 'bg-gray-200'}`} title={label}></div>
            {/each}
          </div>

          <form class="rounded-2xl border border-gray-100 bg-gray-50/60 p-5 shadow-inner" onsubmit={submitMinimal}>
            {#if step === 0}
              <div class="grid gap-4">
                <div class="space-y-2">
                  <label for="simple-brand" class="text-xs font-semibold text-gray-700">Brand / Company</label>
                  <input id="simple-brand" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-rose-300 focus:ring-2 focus:ring-rose-100" bind:value={brand} oninput={scheduleAutosave} placeholder="e.g., Dune Skincare" />
                </div>
                <div class="space-y-2">
                  <label for="simple-about" class="text-xs font-semibold text-gray-700">Product / About</label>
                  <textarea id="simple-about" rows="2" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-rose-300 focus:ring-2 focus:ring-rose-100" bind:value={about} oninput={scheduleAutosave} placeholder="What you sell and why people love it"></textarea>
                </div>
                <div class="space-y-2">
                  <label for="simple-website" class="text-xs font-semibold text-gray-700">Website (optional)</label>
                  <input id="simple-website" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-rose-300 focus:ring-2 focus:ring-rose-100" bind:value={website} oninput={scheduleAutosave} placeholder="https://" />
                </div>
              </div>
            {:else if step === 1}
              <div class="grid gap-4">
                <div class="space-y-2">
                  <label for="simple-type" class="text-xs font-semibold text-gray-700">Influencer type</label>
                  <input id="simple-type" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-rose-300 focus:ring-2 focus:ring-rose-100" bind:value={influencerType} oninput={scheduleAutosave} placeholder="e.g., beauty reviewers" />
                </div>
                <div class="space-y-2">
                  <label for="simple-platforms" class="text-xs font-semibold text-gray-700">Platforms</label>
                  <div class="flex flex-wrap gap-2">
                    {#each platformOptions as option}
                      <button
                        type="button"
                        class={`px-3 py-1.5 text-xs font-medium rounded-full border transition ${selectedPlatforms.includes(option) ? 'bg-rose-500 text-white border-rose-500' : 'bg-white text-gray-700 border-gray-200 hover:border-rose-200'}`}
                        onclick={() => togglePlatform(option)}
                      >
                        {option}
                      </button>
                    {/each}
                  </div>
                </div>
              </div>
            {:else if step === 2}
              <div class="grid gap-4">
                <div class="space-y-2">
                  <label for="simple-location" class="text-xs font-semibold text-gray-700">Audience location</label>
                  <input id="simple-location" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-rose-300 focus:ring-2 focus:ring-rose-100" bind:value={location} oninput={scheduleAutosave} placeholder="e.g., US & Canada" />
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div class="space-y-2">
                    <label for="simple-min" class="text-xs font-semibold text-gray-700">Min followers</label>
                    <input id="simple-min" type="number" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-rose-300 focus:ring-2 focus:ring-rose-100" bind:value={minFollowersLocal} oninput={scheduleAutosave} min="0" step="1000" placeholder="10,000" />
                  </div>
                  <div class="space-y-2">
                    <label for="simple-max" class="text-xs font-semibold text-gray-700">Max followers</label>
                    <input id="simple-max" type="number" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-rose-300 focus:ring-2 focus:ring-rose-100" bind:value={maxFollowersLocal} oninput={scheduleAutosave} min="0" step="1000" placeholder="500,000" />
                  </div>
                </div>
              </div>
            {:else}
              <div class="grid gap-4">
                <div class="space-y-2">
                  <label for="simple-topn" class="text-xs font-semibold text-gray-700">Number of influencers</label>
                  <input
                    id="simple-topn"
                    type="number"
                    min="10"
                    max={maxInfluencers}
                    class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
                    bind:value={topNLocal}
                    oninput={scheduleAutosave}
                  />
                  <p class="text-[11px] text-gray-500">Min 10. Max {maxInfluencers}.</p>
                </div>
                <div class="space-y-2">
                  <label for="simple-notes" class="text-xs font-semibold text-gray-700">Extra notes (optional)</label>
                  <textarea id="simple-notes" rows="2" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-rose-300 focus:ring-2 focus:ring-rose-100" bind:value={notes} oninput={scheduleAutosave} placeholder="Tone, exclusions, hashtags, niches"></textarea>
                </div>
              </div>
            {/if}

            <div class="mt-5 flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" type="button" disabled={isFirstStep} onclick={prevStep}>Back</Button>
              {#if isLastStep}
                <Button variant="primary" size="sm" type="submit" disabled={isSearchFormSubmitting}>
                  {#if isSearchFormSubmitting}
                    Launching…
                  {:else}
                    Start search
                  {/if}
                </Button>
              {:else}
                <Button variant="primary" size="sm" type="button" onclick={nextStep}>Next</Button>
              {/if}
            </div>
          </form>
        </div>
      </div>
    </div>
  {:else}
    <!-- Pipeline mode: Full-width layout -->
    <div class="flex h-full flex-col overflow-hidden">
      <div class="flex-1 overflow-y-auto px-8 py-6 min-h-0">
          <div class="space-y-4 pt-2">
            {#if pipelineError}
              <div class="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {pipelineError.message}
              </div>
            {/if}
            {#if pipelineStatus}
              <PipelineStatusComponent status={pipelineStatus} />
              {@const isPreliminary = isPreliminaryPreview()}
              {@const completed = isCompleted()}
              
              {#if completed}
                <!-- Completed: Show full InfluencersTable -->
                <InfluencersTable
                  profiles={allProfiles()}
                  selectedIds={selectedInfluencerIds}
                  contactedIds={contactedInfluencerIds}
                  {showContacted}
                  status={pipelineStatus.status}
                  isPreliminary={false}
                  {previousProfileIds}
                  isSearching={isSearchFormSubmitting}
                  onToggleSelection={toggleInfluencerSelection}
                  onToggleContacted={() => showContacted = !showContacted}
                  onFindMore={handleFindMore}
                />
              {:else}
                <!-- Running/Preliminary: Show ghosty preview with cycling animation -->
                {@const list = previewDisplayProfiles()}
                {#if list.length > 0}
                  <div class="space-y-3">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <p class="text-sm font-semibold text-gray-800">Preview</p>
                        <span class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 border border-gray-200">
                          <span class="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                          Searching...
                        </span>
                      </div>
                      <span class="text-[10px] text-gray-400">
                        Showing {list.length} of {previewProfiles().length} candidates
                      </span>
                    </div>
                    <!-- Use keyed block to trigger full re-render on rotation -->
                    {#key previewRotationSeed}
                      <div class="space-y-2 select-none pointer-events-none opacity-60">
                        {#each list as profile, i (profile?._id ?? profile?.profile_url ?? profile?.display_name ?? `preview-${i}`)}
                          <div 
                            class="flex items-start justify-between gap-3 rounded-xl px-3 py-2 text-sm border border-dashed border-gray-200 bg-linear-to-r from-gray-50/80 to-white/60 text-gray-400"
                            in:fly={{ y: 15, duration: 400, delay: i * 40, opacity: 0 }}
                            out:fade={{ duration: 200 }}
                          >
                            <div class="flex-1 min-w-0 space-y-1">
                              <div class="flex items-center gap-2 min-w-0">
                                <span class="font-semibold truncate text-gray-400">{profile?.display_name ?? profile?.profile_url ?? 'Profile'}</span>
                                {#if profile?.platform}
                                  <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border border-gray-200 text-gray-400">
                                    {profile.platform === 'TikTok' ? '🎵' : '📸'} {profile.platform}
                                  </span>
                                {/if}
                              </div>
                              {#if profile?.biography || profile?.bio}
                                <p class="text-xs line-clamp-2 text-gray-300">{profile.biography ?? profile.bio}</p>
                              {/if}
                            </div>
                            <div class="shrink-0 text-right text-xs text-gray-300">
                              {#if profile?.followers}
                                <div>{profile.followers.toLocaleString()} followers</div>
                              {/if}
                            </div>
                          </div>
                        {/each}
                      </div>
                    {/key}
                    <p class="text-[11px] text-center text-gray-400 italic">
                      These are preliminary matches. Final results may differ after analysis.
                    </p>
                  </div>
                {/if}
              {/if}
            {:else}
              <p class="text-sm text-gray-600">Fetching pipeline status…</p>
            {/if}
          </div>
        </div>
      
        <!-- Bottom Action Bar (sticky outside scroll) -->
        {#if isCompleted()}
          <div class="border-t border-gray-200 bg-white shrink-0">
            <!-- Selection row -->
            <div class="px-8 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
              <div class="flex items-center gap-4">
                <span class="text-sm font-medium text-gray-900">
                  {selectedCount} {selectedCount === 1 ? 'influencer' : 'influencers'} selected
                </span>
                {#if selectedCount === 0}
                  <button
                    type="button"
                    class="text-xs font-medium text-[#FF6F61] hover:text-[#FF5A4A] transition-colors"
                    onclick={selectAllInfluencers}
                  >
                    Select all
                  </button>
                {:else}
                  <button
                    type="button"
                    class="text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
                    onclick={deselectAllInfluencers}
                  >
                    Clear selection
                  </button>
                {/if}
              </div>
            </div>
            
            <!-- Status indicators & Action row -->
            <div class="px-8 py-4 flex items-center gap-3">
              <!-- Step 1: Gmail status indicator -->
              <div 
                class="flex items-center gap-2 px-4 py-2.5 rounded-lg cursor-pointer transition-colors {gmailConnected ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}"
                onclick={goToMailboxSettings}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && goToMailboxSettings()}
              >
                <div class="flex items-center justify-center w-5 h-5 rounded-full {gmailConnected ? 'bg-green-500' : 'bg-red-500'} text-white text-xs font-bold">
                  {#if gmailConnected}
                    ✓
                  {:else}
                    1
                  {/if}
                </div>
                <div class="flex flex-col">
                  <span class="text-xs font-medium {gmailConnected ? 'text-green-800' : 'text-red-800'}">
                    {gmailConnected ? 'Email Selected' : 'Select Email'}
                  </span>
                  <span class="text-[10px] {gmailConnected ? 'text-green-600' : 'text-red-600'}">
                    {gmailConnected ? `${gmailConnections.length} inbox${gmailConnections.length !== 1 ? 'es' : ''} connected` : 'Click to connect'}
                  </span>
                </div>
              </div>
              
              <!-- Step 2: Template status indicator -->
              <div 
                class="flex items-center gap-2 px-4 py-2.5 rounded-lg cursor-pointer transition-colors {templateSaved ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200 attention-pulse'}"
                onclick={() => showEmailPopup = true}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && (showEmailPopup = true)}
              >
                <div class="flex items-center justify-center w-5 h-5 rounded-full {templateSaved ? 'bg-green-500' : 'bg-red-500'} text-white text-xs font-bold">
                  {#if templateSaved}
                    ✓
                  {:else}
                    2
                  {/if}
                </div>
                <div class="flex flex-col">
                  <span class="text-xs font-medium {templateSaved ? 'text-green-800' : 'text-red-800'}">
                    {templateSaved ? 'Draft Complete' : 'Draft Incomplete'}
                  </span>
                  <span class="text-[10px] {templateSaved ? 'text-green-600' : 'text-red-600'}">
                    {templateSaved ? 'Ready to send' : 'Click to write email'}
                  </span>
                </div>
              </div>
              
              <div class="flex-1"></div>
              
              <!-- Status messages -->
              {#if draftStatus}
                <span class="text-xs text-green-700">{draftStatus}</span>
              {/if}
              {#if draftError}
                <span class="text-xs text-red-700">{draftError}</span>
              {/if}
              
              <!-- Action button -->
              <button
                type="button"
                onclick={createGmailDrafts}
                disabled={selectedCount === 0 || draftInFlight || !gmailConnected || !templateSaved}
                class={`px-6 py-2.5 bg-[#FF6F61] text-white font-medium rounded-lg hover:bg-[#FF5A4A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${needsAttention() ? 'attention-pulse' : ''}`}
              >
                {#if draftInFlight}
                  Creating drafts…
                {:else if !gmailConnected}
                  Connect Gmail first
                {:else if !templateSaved}
                  Write draft first
                {:else if selectedCount === 0}
                  Select influencers
                {:else}
                  Create {selectedCount} Gmail {selectedCount === 1 ? 'draft' : 'drafts'}
                {/if}
              </button>
            </div>
          </div>
        {:else if pipelineStatus?.status === 'running'}
          <!-- During search: show simplified prompt bar -->
          <div class="border-t border-gray-200 bg-white px-8 py-4 shrink-0">
            <div class="flex items-center gap-4">
              <!-- Gmail status -->
              <button
                type="button"
                class={`flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 hover:bg-gray-100 transition-colors ${!gmailConnected ? 'attention-pulse' : ''}`}
                onclick={goToMailboxSettings}
              >
                {#if gmailConnected}
                  <span class="h-2 w-2 rounded-full bg-green-500"></span>
                  <span class="text-sm text-gray-700">{gmailConnections.length} inbox{gmailConnections.length !== 1 ? 'es' : ''} connected</span>
                {:else}
                  <span class="h-2 w-2 rounded-full bg-gray-300"></span>
                  <span class="text-sm text-[#FF6F61] font-medium">Connect Gmail</span>
                {/if}
              </button>
              
              <!-- Template status -->
              <button
                type="button"
                class={`flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 hover:bg-gray-100 transition-colors ${!templateSaved ? 'attention-pulse' : ''}`}
                onclick={() => showEmailPopup = true}
              >
                {#if templateSaved}
                  <span class="h-2 w-2 rounded-full bg-green-500"></span>
                {:else}
                  <span class="h-2 w-2 rounded-full bg-amber-400"></span>
                {/if}
                <span class="text-sm text-gray-700">{templateStatusText()}</span>
                <svg class="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
              
              <div class="flex-1"></div>
              
              <span class="text-sm text-gray-500">Draft your email while you wait...</span>
            </div>
          </div>
        {/if}
      </div>
    {/if}
</div>

<!-- Email setup popup -->
<SendOutreachPopupPanel
  open={showEmailPopup}
  onClose={() => showEmailPopup = false}
  title="Set up email outreach"
  subtitle="Draft your email and get it ready to send"
>
  <div class="h-full flex flex-col">
    <div class="flex-1 min-h-0 flex flex-col p-6 gap-3">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div class="space-y-1">
          <p class="text-sm font-semibold text-gray-900">Email template</p>
          <p class="text-xs text-gray-600">Use Penni Quick Draft or edit manually.</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onclick={quickDraftEmail}
            disabled={isQuickDrafting}
          >
            {isQuickDrafting ? 'Drafting…' : 'Penni Quick Draft'}
          </Button>
        </div>
      </div>
      {#if quickDraftError}
        <p class="text-xs text-red-700">{quickDraftError}</p>
      {/if}
      <div class="flex-1 min-h-[260px] rounded-xl border border-gray-200 bg-white overflow-hidden">
        <EmailEditor
          content={emailTemplate || defaultTemplate()}
          onUpdate={(content) => {
            emailTemplate = content;
            scheduleTemplateSave();
          }}
        />
      </div>
      <div class="flex items-center justify-between mt-2 text-xs text-gray-600">
        <span>Status: {templateStatusText()}</span>
        <div class="flex items-center gap-3">
          {#if templateWarning}
            <span class="text-amber-600">⚠️ {templateWarning}</span>
          {/if}
          {#if templateError}
            <span class="text-red-600">{templateError}</span>
          {/if}
        </div>
      </div>
    </div>
    <div class="border-t border-gray-200 px-6 py-4 flex justify-end">
      <Button variant="secondary" size="sm" onclick={() => void saveTemplate()} disabled={templateSaving}>Save template</Button>
    </div>
  </div>
</SendOutreachPopupPanel>

<!-- Preview popup -->
<SendOutreachPopupPanel
  open={previewPopupOpen}
  onClose={() => previewPopupOpen = false}
  title="Preview Gmail draft"
  subtitle={previewRecipient() ? `For ${previewRecipient()?.display_name ?? 'influencer'}` : 'Add a template to preview'}
>
  <div class="h-full flex flex-col max-w-lg">
    <div class="flex-1 overflow-y-auto px-4 py-3">
      {#if previewRecipient()}
        <div class="prose prose-sm max-w-none border border-gray-200 rounded-xl bg-white p-4 shadow-sm">
          {@html previewHtml()}
        </div>
      {:else}
        <p class="text-sm text-gray-600">No recipients yet. Start a search to preview.</p>
      {/if}
    </div>
    <div class="border-t border-gray-200 px-4 py-3 flex justify-end">
      <Button variant="primary" size="sm" onclick={() => previewPopupOpen = false}>Close</Button>
    </div>
  </div>
</SendOutreachPopupPanel>

<!-- Email draft prompt (shown after category analysis completes) -->
<EmailDraftPrompt
  open={showDraftPrompt}
  onConfirm={() => {
    showDraftPrompt = false;
    showEmailPopup = true;
  }}
  onDismiss={() => {
    showDraftPrompt = false;
  }}
/>

<!-- Connect Gmail prompt (when pipeline kicks off) -->
<SendOutreachPopupPanel
  open={showConnectGmailPrompt && !gmailConnected}
  onClose={() => showConnectGmailPrompt = false}
  title="Connect Gmail to send outreach"
  subtitle="Pick account type and link quickly without leaving this page."
  size="compact"
>
  <div class="p-4 flex flex-col gap-3 max-w-md">
    <div class="space-y-2">
      <p class="text-sm text-gray-700">Choose how you want to connect:</p>
      <div class="space-y-2">
        <label class="flex items-start gap-2 p-2 rounded-lg border text-sm cursor-pointer {connectAccountType === 'draft' ? 'border-rose-300 bg-rose-50' : 'border-gray-200 hover:border-gray-300'}">
          <input type="radio" name="connectType" value="draft" bind:group={connectAccountType} class="mt-1 h-4 w-4 text-rose-500 focus:ring-rose-500" />
          <div>
            <div class="font-medium text-gray-900">Draft only</div>
            <div class="text-xs text-gray-600">Creates drafts for review before sending.</div>
          </div>
        </label>
        <label class="flex items-start gap-2 p-2 rounded-lg border text-sm cursor-pointer {connectAccountType === 'send' ? 'border-rose-300 bg-rose-50' : 'border-gray-200 hover:border-gray-300'}">
          <input type="radio" name="connectType" value="send" bind:group={connectAccountType} class="mt-1 h-4 w-4 text-rose-500 focus:ring-rose-500" />
          <div>
            <div class="font-medium text-gray-900">Send & Draft</div>
            <div class="text-xs text-gray-600">Allows creating drafts and sending automatically.</div>
          </div>
        </label>
      </div>
    </div>
    {#if gmailError}
      <p class="text-xs text-red-600">{gmailError}</p>
    {/if}
    <div class="flex justify-end gap-2 pt-1">
      <Button variant="secondary" size="sm" onclick={() => showConnectGmailPrompt = false}>Later</Button>
      <Button variant="primary" size="sm" onclick={() => {
        const type = connectAccountType || 'draft';
        window.location.href = `/api/auth/gmail/connect?accountType=${type}`;
      }}>Connect Gmail</Button>
    </div>
  </div>
</SendOutreachPopupPanel>

<style>
  @keyframes fadeInUp {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 0.5;
      transform: translateY(0);
    }
  }

  @keyframes pulse-red {
    0% {
      box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.6);
    }
    70% {
      box-shadow: 0 0 0 12px rgba(239, 68, 68, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
    }
  }

  .attention-pulse {
    animation: pulse-red 1s ease-out infinite;
  }
</style>
