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
  let strictLocationMatching = $state(false);

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
    'Targets & reach'
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

<div style="display: flex; flex-direction: column; width: 100%; height: 100%; background: linear-gradient(145deg, #faf9f7 0%, #f5f3f0 50%, #f0eeeb 100%); position: relative; overflow: hidden;">
  <!-- Subtle grid pattern -->
  <div style="position: absolute; inset: 0; background-image: linear-gradient(rgba(0,0,0,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.02) 1px, transparent 1px); background-size: 40px 40px; pointer-events: none;"></div>
  
  <!-- Soft gradient orbs for depth -->
  <div style="position: absolute; top: -15%; right: -5%; width: 500px; height: 500px; background: radial-gradient(circle, rgba(255,111,97,0.08) 0%, transparent 70%); pointer-events: none; filter: blur(80px);"></div>
  <div style="position: absolute; bottom: -20%; left: -10%; width: 600px; height: 600px; background: radial-gradient(circle, rgba(147,112,219,0.06) 0%, transparent 70%); pointer-events: none; filter: blur(100px);"></div>
  
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
        {#if searchUsage}
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
          {:else}
            <div style="display: flex; flex-direction: column; gap: 32px; flex: 1;">
              <div style="margin-bottom: 16px;">
                <h1 style="font-size: 38px; font-weight: 700; color: #1a1a1a; margin: 0 0 8px 0; letter-spacing: -0.02em;">Who are you looking for?</h1>
                <p style="font-size: 16px; color: rgba(0,0,0,0.5); margin: 0;">Define the type of creators and the reach you need.</p>
              </div>
              
              <div style="display: flex; flex-direction: column; gap: 24px;">
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  <label for="simple-type" style="font-size: 13px; font-weight: 500; color: rgba(0,0,0,0.7);">Creator niche or type</label>
                  <input id="simple-type" class="light-input" bind:value={influencerType} oninput={scheduleAutosave} placeholder="e.g., beauty reviewers, fitness coaches, food bloggers" />
                </div>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                  <div id="platforms-label" style="font-size: 13px; font-weight: 500; color: rgba(0,0,0,0.7);">Platforms</div>
                  <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                    {#each platformOptions as option}
                      <button
                        type="button"
                        class="platform-btn"
                        style="padding: 14px 28px; font-size: 14px; font-weight: 500; border-radius: 10px; border: 1px solid {selectedPlatforms.includes(option) ? 'rgba(255,111,97,0.4)' : 'rgba(0,0,0,0.1)'}; background: {selectedPlatforms.includes(option) ? 'linear-gradient(135deg, rgba(255,111,97,0.12), rgba(255,138,128,0.08))' : 'rgba(255,255,255,0.7)'}; backdrop-filter: blur(10px); color: {selectedPlatforms.includes(option) ? '#e85a4f' : 'rgba(0,0,0,0.6)'}; cursor: pointer; transition: all 0.2s; box-shadow: {selectedPlatforms.includes(option) ? '0 2px 12px rgba(255,111,97,0.15)' : '0 2px 8px rgba(0,0,0,0.04)'};"
                        onclick={() => togglePlatform(option)}
                        aria-labelledby="platforms-label"
                      >
                        {option === 'TikTok' ? '🎵' : '📸'} {option}
                      </button>
                    {/each}
                  </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 8px;">
                  <label for="simple-location" style="font-size: 13px; font-weight: 500; color: rgba(0,0,0,0.7);">Target location</label>
                  <input id="simple-location" class="light-input" bind:value={location} oninput={scheduleAutosave} placeholder="e.g., US, Canada, UK" />
                </div>

                <div style="display: flex; align-items: center; gap: 16px; padding: 16px 20px; background: rgba(255,255,255,0.6); backdrop-filter: blur(10px); border: 1px solid rgba(0,0,0,0.06); border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
                  <button
                    type="button"
                    onclick={() => strictLocationMatching = !strictLocationMatching}
                    id="simple-strict-location"
                    style="position: relative; width: 48px; height: 26px; border-radius: 999px; border: none; cursor: pointer; transition: background 0.2s; background: {strictLocationMatching ? 'linear-gradient(90deg, #FF6F61, #FF8A80)' : 'rgba(0,0,0,0.15)'};"
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

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                  <div style="display: flex; flex-direction: column; gap: 8px;">
                    <label for="simple-min" style="font-size: 13px; font-weight: 500; color: rgba(0,0,0,0.7);">Min followers</label>
                    <input id="simple-min" type="number" class="light-input" bind:value={minFollowersLocal} oninput={scheduleAutosave} min="0" step="1000" placeholder="10,000" />
                  </div>
                  <div style="display: flex; flex-direction: column; gap: 8px;">
                    <label for="simple-max" style="font-size: 13px; font-weight: 500; color: rgba(0,0,0,0.7);">Max followers</label>
                    <input id="simple-max" type="number" class="light-input" bind:value={maxFollowersLocal} oninput={scheduleAutosave} min="0" step="1000" placeholder="500,000" />
                  </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 8px;">
                  <label for="simple-topn" style="font-size: 13px; font-weight: 500; color: rgba(0,0,0,0.7);">How many creators do you want?</label>
                  <input
                    id="simple-topn"
                    type="number"
                    min="10"
                    max={maxInfluencers}
                    class="light-input"
                    bind:value={topNLocal}
                    oninput={scheduleAutosave}
                  />
                  <p style="font-size: 12px; color: rgba(0,0,0,0.4); margin: 4px 0 0 0;">Min 10, max {maxInfluencers} based on your plan</p>
                </div>
              </div>
            </div>
          {/if}

          <!-- Navigation buttons - sticky at bottom -->
          <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 32px; margin-top: auto; border-top: 1px solid rgba(0,0,0,0.06);">
            <button
              type="button"
              disabled={isFirstStep}
              onclick={prevStep}
              class="nav-btn-back-light"
              style="padding: 14px 28px; font-size: 14px; font-weight: 500; border-radius: 10px; border: 1px solid rgba(0,0,0,0.1); background: rgba(255,255,255,0.7); backdrop-filter: blur(10px); color: {isFirstStep ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.6)'}; cursor: {isFirstStep ? 'not-allowed' : 'pointer'}; transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.04);"
            >
              ← Back
            </button>
            
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
      <div style="flex: 1; overflow-y: auto; padding: 32px; min-height: 0;">
          <div style="display: flex; flex-direction: column; gap: 24px;">
            {#if pipelineError}
              <div style="padding: 16px 20px; background: rgba(239,68,68,0.08); backdrop-filter: blur(10px); border: 1px solid rgba(239,68,68,0.2); border-radius: 12px; color: #dc2626; font-size: 14px;">
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
                      <div style="display: flex; flex-direction: column; gap: 8px; user-select: none; pointer-events: none; opacity: 0.65;">
                        {#each list as profile, i (profile?._id ?? profile?.profile_url ?? profile?.display_name ?? `preview-${i}`)}
                          <div 
                            style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 16px 20px; border: 1px dashed rgba(0,0,0,0.1); border-radius: 12px; background: rgba(255,255,255,0.5); backdrop-filter: blur(10px);"
                            in:fly={{ y: 15, duration: 400, delay: i * 40, opacity: 0 }}
                            out:fade={{ duration: 200 }}
                          >
                            <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px;">
                              <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                                <span style="font-weight: 600; color: rgba(0,0,0,0.5); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{profile?.display_name ?? profile?.profile_url ?? 'Profile'}</span>
                                {#if profile?.platform}
                                  <span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border: 1px solid rgba(0,0,0,0.08); border-radius: 999px; font-size: 11px; color: rgba(0,0,0,0.4); background: rgba(255,255,255,0.5);">
                                    {profile.platform === 'TikTok' ? '🎵' : '📸'} {profile.platform}
                                  </span>
                                {/if}
                              </div>
                              {#if profile?.biography || profile?.bio}
                                <p style="font-size: 13px; color: rgba(0,0,0,0.35); margin: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">{profile.biography ?? profile.bio}</p>
                              {/if}
                            </div>
                            <div style="flex-shrink: 0; text-align: right; font-size: 13px; color: rgba(0,0,0,0.35);">
                              {#if profile?.followers}
                                <div>{profile.followers.toLocaleString()} followers</div>
                              {/if}
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
        </div>
      
        <!-- Bottom Action Bar (sticky outside scroll) -->
        {#if isCompleted()}
          <div style="border-top: 1px solid rgba(0,0,0,0.06); background: rgba(255,255,255,0.8); flex-shrink: 0; backdrop-filter: blur(20px);">
            <!-- Selection row -->
            <div style="padding: 16px 32px; border-bottom: 1px solid rgba(0,0,0,0.04); display: flex; align-items: center; justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 20px;">
                <span style="font-size: 14px; font-weight: 500; color: rgba(0,0,0,0.8);">
                  {selectedCount} {selectedCount === 1 ? 'creator' : 'creators'} selected
                </span>
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
            <div style="padding: 20px 32px; display: flex; align-items: center; gap: 16px;">
              <!-- Step 1: Gmail status indicator -->
              <div 
                style="display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-radius: 10px; cursor: pointer; transition: all 0.2s; background: {gmailConnected ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'}; border: 1px solid {gmailConnected ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'};"
                onclick={goToMailboxSettings}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && goToMailboxSettings()}
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
              
              <!-- Step 2: Template status indicator -->
              <div 
                style="display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-radius: 10px; cursor: pointer; transition: all 0.2s; background: {templateSaved ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'}; border: 1px solid {templateSaved ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'};"
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
              
              <div style="flex: 1;"></div>
              
              <!-- Status messages -->
              {#if draftStatus}
                <span style="font-size: 13px; color: #16a34a;">{draftStatus}</span>
              {/if}
              {#if draftError}
                <span style="font-size: 13px; color: #dc2626;">{draftError}</span>
              {/if}
              
              <!-- Action button -->
              <button
                type="button"
                onclick={createGmailDrafts}
                disabled={selectedCount === 0 || draftInFlight || !gmailConnected || !templateSaved}
                style="padding: 14px 32px; background: linear-gradient(135deg, #FF6F61 0%, #FF8A80 100%); color: white; font-size: 14px; font-weight: 600; border: none; border-radius: 10px; cursor: {selectedCount === 0 || draftInFlight || !gmailConnected || !templateSaved ? 'not-allowed' : 'pointer'}; opacity: {selectedCount === 0 || draftInFlight || !gmailConnected || !templateSaved ? '0.5' : '1'}; transition: all 0.2s; box-shadow: 0 4px 15px rgba(255,111,97,0.25);"
                class={needsAttention() ? 'attention-pulse' : ''}
              >
                {#if draftInFlight}
                  Creating drafts…
                {:else if !gmailConnected}
                  Connect Gmail first
                {:else if !templateSaved}
                  Write draft first
                {:else if selectedCount === 0}
                  Select creators
                {:else}
                  Create {selectedCount} Gmail {selectedCount === 1 ? 'draft' : 'drafts'}
                {/if}
              </button>
            </div>
          </div>
        {:else if pipelineStatus?.status === 'running'}
          <!-- During search: show simplified prompt bar -->
          <div style="border-top: 1px solid rgba(0,0,0,0.06); background: rgba(255,255,255,0.8); padding: 20px 32px; flex-shrink: 0; backdrop-filter: blur(20px);">
            <div style="display: flex; align-items: center; gap: 16px;">
              <!-- Gmail status -->
              <button
                type="button"
                style="display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: rgba(255,255,255,0.7); border: 1px solid rgba(0,0,0,0.08); border-radius: 8px; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 6px rgba(0,0,0,0.04);"
                onclick={goToMailboxSettings}
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
              
              <!-- Template status -->
              <button
                type="button"
                style="display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: rgba(255,255,255,0.7); border: 1px solid rgba(0,0,0,0.08); border-radius: 8px; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 6px rgba(0,0,0,0.04);"
                onclick={() => showEmailPopup = true}
                class={!templateSaved ? 'attention-pulse' : ''}
              >
                {#if templateSaved}
                  <span style="width: 8px; height: 8px; background: #22c55e; border-radius: 50%;"></span>
                {:else}
                  <span style="width: 8px; height: 8px; background: #f59e0b; border-radius: 50%;"></span>
                {/if}
                <span style="font-size: 13px; color: rgba(0,0,0,0.6);">{templateStatusText()}</span>
                <svg style="width: 14px; height: 14px; color: rgba(0,0,0,0.35);" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
              
              <div style="flex: 1;"></div>
              
              <span style="font-size: 13px; color: rgba(0,0,0,0.4);">Draft your email while you wait...</span>
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
  <div class="p-6 flex flex-col gap-4 w-full">
    <div class="space-y-3 w-full">
      <p class="text-sm text-gray-700">Choose how you want to connect:</p>
      <div class="space-y-2 w-full">
        <label class="flex items-start gap-3 p-3 rounded-lg border text-sm cursor-pointer w-full {connectAccountType === 'draft' ? 'border-rose-300 bg-rose-50' : 'border-gray-200 hover:border-gray-300'}">
          <input type="radio" name="connectType" value="draft" bind:group={connectAccountType} class="mt-0.5 h-4 w-4 text-rose-500 focus:ring-rose-500" />
          <div class="flex-1">
            <div class="font-medium text-gray-900">Draft only</div>
            <div class="text-xs text-gray-600">Creates drafts for review before sending.</div>
          </div>
        </label>
        <label class="flex items-start gap-3 p-3 rounded-lg border text-sm cursor-pointer w-full {connectAccountType === 'send' ? 'border-rose-300 bg-rose-50' : 'border-gray-200 hover:border-gray-300'}">
          <input type="radio" name="connectType" value="send" bind:group={connectAccountType} class="mt-0.5 h-4 w-4 text-rose-500 focus:ring-rose-500" />
          <div class="flex-1">
            <div class="font-medium text-gray-900">Send & Draft</div>
            <div class="text-xs text-gray-600">Allows creating drafts and sending automatically.</div>
          </div>
        </label>
      </div>
    </div>
    {#if gmailError}
      <p class="text-xs text-red-600">{gmailError}</p>
    {/if}
    <div class="flex justify-end gap-2 pt-2 border-t border-gray-100">
      <Button variant="secondary" size="sm" onclick={() => showConnectGmailPrompt = false}>Later</Button>
      <Button variant="primary" size="sm" onclick={() => {
        const type = connectAccountType || 'draft';
        window.location.href = `/api/auth/gmail/connect?accountType=${type}`;
      }}>Connect Gmail</Button>
    </div>
  </div>
</SendOutreachPopupPanel>

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
</style>
