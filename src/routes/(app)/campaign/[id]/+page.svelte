<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { fade, fly, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	
	// Custom transition combining fade and slide
	function slideFade(node: Element, { axis = 'x', duration = 300 } = {}) {
		// Guard against SSR - only run on client
		if (!browser) {
			return {
				duration: 0,
				css: () => ''
			};
		}
		
		const style = getComputedStyle(node);
		const opacity = +style.opacity;
		const dimension = axis === 'y' ? 'height' : 'width';
		const size = dimension === 'height' ? (node as HTMLElement).offsetHeight : (node as HTMLElement).offsetWidth;
		
		return {
			duration,
			easing: cubicOut,
			css: (t: number) => {
				const eased = cubicOut(t);
				return `
					opacity: ${eased * opacity};
					transform: translate${axis.toUpperCase()}(${(1 - eased) * size}px);
				`;
			}
		};
	}
	import Button from '$lib/components/Button.svelte';
	import CampaignOutreachPanel from '$lib/components/CampaignOutreachPanel.svelte';
	import OutreachUpgradePanel from '$lib/components/OutreachUpgradePanel.svelte';
	import SearchLimitExceededPanel from '$lib/components/SearchLimitExceededPanel.svelte';
	import CampaignLoadingCover from '$lib/components/campaign/CampaignLoadingCover.svelte';
	import CampaignTabs from '$lib/components/campaign/CampaignTabs.svelte';
	import ChatTab from '$lib/components/campaign/ChatTab.svelte';
	import OutreachTab from '$lib/components/campaign/OutreachTab.svelte';
	import RerunPipelineWarning from '$lib/components/campaign/RerunPipelineWarning.svelte';
	import type { PageData } from './$types';
	import { firebaseFirestore, firebaseAuth } from '$lib/firebase/client';
	import { doc, onSnapshot } from 'firebase/firestore';
	import { browser } from '$app/environment';
	import { onAuthStateChanged } from 'firebase/auth';
	import type { SerializedCampaign } from '$lib/server/campaigns';
	import type { ApiMessage, ConversationResponse, PipelineStatus, SearchParams, SearchUsage } from '$lib/types/campaign';
	import { getProfileId, calculateProgress } from '$lib/utils/campaign';

	let { data }: { data: PageData } = $props();
	const campaign = $derived(data.campaign);
	const routeCampaignId = $derived($page.params.id);

// Local campaign state that can be updated immediately after search
let localCampaign = $state<SerializedCampaign | null>(null);
const effectiveCampaign = $derived(localCampaign ?? campaign ?? null);

	// Initialize activeTab from query parameter, default to 'chat'
	const tabFromQuery = $page.url.searchParams.get('tab');
	const initialTab = (tabFromQuery === 'chat' || tabFromQuery === 'outreach') ? tabFromQuery : 'chat';
	let activeTab = $state<'chat' | 'outreach'>(initialTab);
	let campaignId = $state<string | null>(null);
	let messages = $state<ApiMessage[]>([]);
	
	// Check if user has sent any messages (show outreach tab after first message)
	const hasUserMessages = $derived(() => {
		return messages.some(msg => msg.role === 'user');
	});
	
	// If outreach tab is active but gets hidden, switch back to chat
	$effect(() => {
		if (activeTab === 'outreach' && !hasUserMessages()) {
			activeTab = 'chat';
		}
	});
	let draft = $state('');
	let collected = $state<Record<string, string | undefined>>({});
	let followerRange = $state<{ min: number | null; max: number | null }>({ min: null, max: null });
	let isInitializing = $state(true);
	let isSending = $state(false);
	let initError = $state<string | null>(null);
	// Removed openSourcesMessageId - now using hover tooltips instead
	const textDecoder = new TextDecoder();
	let messagesContainer: HTMLDivElement | null = $state(null);
	
	// Influencer search form state (for embedded message)
	let influencerSummary = $state('');
	let searchFormTopN = $state(30);
	let searchFormMinFollowers = $state<number | null>(null);
	let searchFormMaxFollowers = $state<number | null>(null);
	let isSearchFormSubmitting = $state(false);
	let debugMode = $state(false);
	
	// Outreach tab state
let searchUsage = $state<{ count: number; limit: number; remaining: number; resetDate: number } | null>(null);
	
	// Pipeline status state
	let pipelineStatus = $state<{
		status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
		current_stage: string | null;
		completed_stages: string[];
		overall_progress: number;
		profiles_count: number;
		profiles: Array<{
			profile_url?: string;
			display_name?: string;
			followers?: number;
			fit_score?: number;
			fit_rationale?: string;
			platform?: string;
			biography?: string;
			bio?: string;
			email_address?: string;
			business_email?: string;
			_id?: string; // Unique identifier for tracking
		}>;
		stages: {
			query_expansion?: { status: string; queries?: string[] } | null;
			weaviate_search?: { status: string; deduplicated_results?: number } | null;
			brightdata_collection?: { status: string; profiles_collected?: number; batches_completed?: number; total_batches?: number } | null;
			llm_analysis?: { status: string; profiles_analyzed?: number } | null;
		};
		error_message?: string | null;
	} | null>(null);
	let pipelinePollInterval: ReturnType<typeof setInterval> | null = null;
	let previousProfileIds = $state<Set<string>>(new Set());
	let selectedInfluencerIds = $state<Set<string>>(new Set());
	let contactedInfluencerIds = $state<Set<string>>(new Set());
	let showContacted = $state(false); // When false, show uncontacted; when true, show contacted
	let outreachPanelOpen = $state(false);
	let upgradePanelOpen = $state(false);
	let searchLimitExceededOpen = $state(false);
	let searchLimitError = $state<{ remaining?: number; requested?: number; limit?: number } | null>(null);
	
	// Get user's current plan from layout data
	const currentPlanKey = $derived(data.user?.currentPlan?.planKey ?? null);
	const isFreePlan = $derived(currentPlanKey === 'free' || currentPlanKey === null);

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
		setTimeout(() => scrollToBottom(), 0);
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
		// Scroll during streaming updates
		setTimeout(() => scrollToBottom(), 0);
	}

	function removeMessageById(id: string) {
		messages = messages.filter((message) => message.id !== id);
	}

	// Removed toggleSources - now using hover tooltips instead

	function scrollToBottom() {
		if (messagesContainer) {
			messagesContainer.scrollTop = messagesContainer.scrollHeight;
		}
	}

	// Auto-scroll when messages change
	$effect(() => {
		if (messages.length > 0) {
			// Use setTimeout to ensure DOM has updated
			setTimeout(() => scrollToBottom(), 0);
		}
	});
	
	// Auto-scroll to bottom when switching to chat tab
	$effect(() => {
		if (activeTab === 'chat' && messagesContainer) {
			// Use setTimeout to ensure DOM has updated after tab switch
			setTimeout(() => scrollToBottom(), 100);
		}
	});

	// Reload conversation when campaign ID changes (e.g., when switching between campaigns)
	$effect(() => {
		const currentCampaignId = routeCampaignId;
		if (currentCampaignId && activeTab === 'chat') {
			// Only reload if campaign ID changed or we haven't loaded yet
			if (campaignId !== currentCampaignId) {
				// Reset state when campaign changes
				campaignId = null;
				messages = [];
				collected = {};
				followerRange = { min: null, max: null };
				isInitializing = true;
				initError = null;
				// Reset localCampaign when switching campaigns to ensure reactivity
				localCampaign = null;
				// Load conversation for the new campaign
				void loadConversation(currentCampaignId);
			} else if (!campaignId && !isInitializing && campaign?.id) {
				// Load if we're on chat tab but haven't loaded yet
				void loadConversation(campaign.id);
			}
		}
	});

	onMount(() => {
		if (!browser) return;
		
		// Load search usage when component mounts
		void loadSearchUsage();
		
		// Load pipeline status if pipeline_id exists and we're on outreach tab
		if (effectiveCampaign?.pipeline_id && activeTab === 'outreach') {
			void loadPipelineStatus(effectiveCampaign.pipeline_id);
			startPipelinePolling(effectiveCampaign.pipeline_id);
		}
		
		// Set up real-time listener for campaign document to sync pipeline_id updates
		let unsubscribeCampaign: (() => void) | null = null;
		const setupCampaignListener = () => {
			const currentUser = firebaseAuth.currentUser;
			const campaignId = routeCampaignId;
			
			if (!currentUser || !campaignId) return;
			
			// Clean up existing listener if any
			if (unsubscribeCampaign) {
				unsubscribeCampaign();
				unsubscribeCampaign = null;
			}
			
			const campaignDocRef = doc(firebaseFirestore, 'users', currentUser.uid, 'campaigns', campaignId);
			
				unsubscribeCampaign = onSnapshot(
				campaignDocRef,
				(snapshot) => {
					if (!snapshot.exists()) return;
					
					const data = snapshot.data();
					const updatedPipelineId = typeof data?.pipeline_id === 'string' ? data.pipeline_id : null;
					
					// Ensure localCampaign exists and matches current campaign
					const baseCampaign = localCampaign ?? campaign;
					if (!baseCampaign || baseCampaign.id !== campaignId) {
						// Campaign doesn't match, skip update
						return;
					}
					
					// Update localCampaign with the latest pipeline_id from Firestore
					// Always update if pipeline_id differs to ensure reactivity
					const currentPipelineId = baseCampaign.pipeline_id ?? null;
					
					if (updatedPipelineId !== currentPipelineId) {
						// Update localCampaign with new pipeline_id
						localCampaign = {
							...baseCampaign,
							pipeline_id: updatedPipelineId
						};
						
						console.log('[campaign] Pipeline ID synced from Firestore:', updatedPipelineId, {
							previous: currentPipelineId,
							new: updatedPipelineId,
							campaignId: campaignId
						});
						
						// If we're on the outreach tab and pipeline_id was just set, load status and start polling
						if (activeTab === 'outreach' && updatedPipelineId) {
							void loadPipelineStatus(updatedPipelineId);
							startPipelinePolling(updatedPipelineId);
						}
					} else if (updatedPipelineId === null && currentPipelineId !== null) {
						// Handle case where pipeline_id is cleared (shouldn't happen normally, but handle it)
						localCampaign = {
							...baseCampaign,
							pipeline_id: null
						};
					}
				},
				(error) => {
					console.error('[campaign] Failed to listen to campaign updates', error);
				}
			);
		};
		
		// Set up listener when auth state is available
		const unsubscribeAuth = onAuthStateChanged(firebaseAuth, (user) => {
			if (user) {
				setupCampaignListener();
			}
		});
		
		// Also try to set up immediately if user is already authenticated
		if (firebaseAuth.currentUser) {
			setupCampaignListener();
		}
		
		return () => {
			// Cleanup polling interval
			if (pipelinePollInterval) {
				clearInterval(pipelinePollInterval);
				pipelinePollInterval = null;
			}
			// Cleanup campaign listener
			if (unsubscribeCampaign) {
				unsubscribeCampaign();
				unsubscribeCampaign = null;
			}
			// Cleanup auth listener
			unsubscribeAuth();
		};
	});
	
	async function loadSearchUsage() {
		try {
			const response = await fetch('/api/search/influencers');
			if (response.ok) {
				const data = await response.json();
				searchUsage = data;
			}
		} catch (error) {
			console.error('Failed to load search usage:', error);
		}
	}
	
	// Update max influencers based on remaining searches
	const maxInfluencers = $derived(() => {
		if (!searchUsage) return 1000; // Default max if usage not loaded
		return Math.min(searchUsage.remaining, 1000); // Cap at 1000 or remaining, whichever is lower
	});
	

	// Toggle influencer selection
	function toggleInfluencerSelection(profileId: string) {
		// Prevent selecting contacted influencers
		if (contactedInfluencerIds.has(profileId)) {
			return;
		}
		
		if (selectedInfluencerIds.has(profileId)) {
			selectedInfluencerIds.delete(profileId);
		} else {
			selectedInfluencerIds.add(profileId);
		}
		selectedInfluencerIds = new Set(selectedInfluencerIds); // Trigger reactivity
		// Save selection to outreach state
		saveOutreachSelection();
	}
	
	// Save selected influencer IDs to outreach state
	async function saveOutreachSelection() {
		if (!routeCampaignId) return;
		
		try {
			const response = await fetch(`/api/outreach/state/${routeCampaignId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					selectedInfluencerIds: Array.from(selectedInfluencerIds)
				})
			});
			// Don't show errors - this is background save
			if (!response.ok) {
				console.error('Failed to save influencer selection');
			}
		} catch (error) {
			console.error('Failed to save influencer selection:', error);
		}
	}
	
	// Load selected influencer IDs from outreach state
	async function loadOutreachSelection() {
		if (!routeCampaignId) return;
		
		try {
			const response = await fetch(`/api/outreach/state/${routeCampaignId}`);
			if (response.ok) {
				const data = await response.json();
				if (data.state?.selectedInfluencerIds && Array.isArray(data.state.selectedInfluencerIds)) {
					// Validate that the saved IDs still exist in current profiles
					const validIds = new Set<string>();
					const profileIds = new Set(
						(pipelineStatus?.profiles || []).map(p => p._id || getProfileId(p))
					);
					
					data.state.selectedInfluencerIds.forEach((id: string) => {
						if (profileIds.has(id)) {
							validIds.add(id);
						}
					});
					
					// Filter out contacted influencers
					// Remove any IDs that are in the contactedInfluencerIds set
					const uncontactedIds = new Set<string>();
					validIds.forEach((id: string) => {
						if (!contactedInfluencerIds.has(id)) {
							uncontactedIds.add(id);
						}
					});
					
					selectedInfluencerIds = uncontactedIds;
					
					// Save the filtered selection back to state
					if (uncontactedIds.size !== validIds.size) {
						await saveOutreachSelection();
					}
				}
			}
		} catch (error) {
			console.error('Failed to load influencer selection:', error);
		}
	}
	
	// Load contacted influencer IDs
	async function loadContactedInfluencers() {
		if (!routeCampaignId) {
			// Reset to empty set if no campaign ID
			contactedInfluencerIds = new Set();
			return;
		}
		
		try {
			const response = await fetch(`/api/outreach/contacts/${routeCampaignId}`);
			if (response.ok) {
				const data = await response.json();
				if (data.contactedInfluencerIds && Array.isArray(data.contactedInfluencerIds)) {
					// Use the IDs as-is - they should match what getProfileId generates
					// The API should return IDs that match profile._id or getProfileId(profile)
					contactedInfluencerIds = new Set(data.contactedInfluencerIds);
				} else {
					// If API returns unexpected format, default to empty set (all uncontacted)
					contactedInfluencerIds = new Set();
				}
			} else {
				// If API call fails, default to empty set (all uncontacted)
				contactedInfluencerIds = new Set();
			}
		} catch (error) {
			console.error('Failed to load contacted influencers:', error);
			// On error, default to empty set (all uncontacted)
			contactedInfluencerIds = new Set();
		}
	}

	// Get count of selected influencers
	const selectedCount = $derived(selectedInfluencerIds.size);

	// Handle send outreach - opens the panel or upgrade panel for free users
	function handleSendOutreach() {
		if (selectedCount === 0) return;
		
		// If user is on free plan, show upgrade panel instead
		if (isFreePlan) {
			openUpgradePanel(
				"You've hit your outreach limit",
				"Outreach capabilities are not available on the free plan. Choose a plan below to start sending outreach messages."
			);
			return;
		}
		
		outreachPanelOpen = true;
	}
	
	// Get selected influencers
	const selectedInfluencers = $derived(() => {
		if (!pipelineStatus?.profiles) return [];
		return pipelineStatus.profiles.filter(profile => {
			const profileId = profile._id || getProfileId(profile);
			return selectedInfluencerIds.has(profileId);
		});
	});
	
	// Close outreach panel
	async function closeOutreachPanel() {
		outreachPanelOpen = false;
		// Refresh contacted influencers list in case drafts were created
		await loadContactedInfluencers();
		// Filter out contacted influencers from selections
		const uncontactedIds = new Set<string>();
		selectedInfluencerIds.forEach((id: string) => {
			if (!contactedInfluencerIds.has(id)) {
				uncontactedIds.add(id);
			}
		});
		if (uncontactedIds.size !== selectedInfluencerIds.size) {
			selectedInfluencerIds = uncontactedIds;
			await saveOutreachSelection();
		}
	}
	
	// Close upgrade panel
	function closeUpgradePanel() {
		upgradePanelOpen = false;
		upgradePanelTitle = undefined;
		upgradePanelDescription = undefined;
	}
	
	async function loadPipelineStatus(pipelineId: string) {
		try {
			const response = await fetch(`/api/pipeline/${pipelineId}`);
			if (response.ok) {
				const result = await response.json();
				// The API returns { data: {...} } structure
				const data = result.data || result;
				
				// Add unique IDs to profiles if they don't have them
				if (data.profiles && Array.isArray(data.profiles)) {
					data.profiles = data.profiles.map((profile: any) => ({
						...profile,
						_id: profile._id || getProfileId(profile)
					}));
				}
				
				const previousCount = pipelineStatus?.profiles?.length ?? 0;
				const newCount = data.profiles?.length ?? 0;
				
				console.log(`[Frontend] Loaded pipeline status:`, {
					status: data.status,
					profilesCount: newCount,
					previousCount,
					newProfiles: newCount - previousCount,
					profilesStoragePath: data.profiles_storage_path
				});
				
				// Update previous profile IDs set for animation tracking
				if (pipelineStatus?.profiles) {
					previousProfileIds = new Set(pipelineStatus.profiles.map(p => p._id || getProfileId(p)));
				}
				
				pipelineStatus = data;
				
				// Load saved influencer selection and contacted influencers after profiles are loaded
				// Always load contacted influencers if we have profiles, regardless of status
				if (data.profiles && data.profiles.length > 0) {
					await Promise.all([
						data.status === 'completed' ? loadOutreachSelection() : Promise.resolve(),
						loadContactedInfluencers()
					]);
				} else {
					// Even if no profiles, ensure contacted influencers is initialized
					await loadContactedInfluencers();
				}
			} else {
				const errorData = await response.json().catch(() => ({ message: 'Failed to load pipeline status' }));
				console.error('Failed to load pipeline status:', errorData);
			}
		} catch (error) {
			console.error('Failed to load pipeline status:', error);
		}
	}
	
	function startPipelinePolling(pipelineId: string) {
		// Clear existing interval
		if (pipelinePollInterval) {
			clearInterval(pipelinePollInterval);
		}
		
		// Poll every 3 seconds
		pipelinePollInterval = setInterval(async () => {
			// Only poll if we're still on the outreach tab
			if (activeTab === 'outreach') {
				await loadPipelineStatus(pipelineId);
				
				// Stop polling if pipeline is completed, error, or cancelled
				if (pipelineStatus?.status === 'completed' || pipelineStatus?.status === 'error' || pipelineStatus?.status === 'cancelled') {
					// Give it one more poll cycle to ensure we have the final data, then stop
					setTimeout(() => {
						if (pipelinePollInterval && (pipelineStatus?.status === 'completed' || pipelineStatus?.status === 'error' || pipelineStatus?.status === 'cancelled')) {
							clearInterval(pipelinePollInterval);
							pipelinePollInterval = null;
						}
					}, 3000);
				}
			} else {
				// Stop polling if user switched away from outreach tab
				if (pipelinePollInterval) {
					clearInterval(pipelinePollInterval);
					pipelinePollInterval = null;
				}
			}
		}, 3000);
	}
	
	// Watch for campaign pipeline_id changes and activeTab changes
	$effect(() => {
		const pipelineId = effectiveCampaign?.pipeline_id;
		const currentTab = activeTab;
		
		// Clear existing polling when effect runs
		if (pipelinePollInterval) {
			clearInterval(pipelinePollInterval);
			pipelinePollInterval = null;
		}
		
		// Start loading and polling if on outreach tab and pipeline exists
		if (pipelineId && currentTab === 'outreach') {
			// Always load pipeline status when switching to outreach tab
			// This ensures data is fresh even if it was previously loaded
			void loadPipelineStatus(pipelineId);
			// Start polling
			startPipelinePolling(pipelineId);
		}
		
		return () => {
			// Cleanup polling when effect cleanup runs
			if (pipelinePollInterval) {
				clearInterval(pipelinePollInterval);
				pipelinePollInterval = null;
			}
		};
	});
	
	// Sync localCampaign with campaign when it changes
	// Reset localCampaign when campaign ID changes to ensure proper reactivity
	$effect(() => {
		const currentCampaignId = routeCampaignId;
		if (campaign) {
			// If campaign ID changed, reset localCampaign to ensure fresh state
			if (localCampaign?.id !== campaign.id) {
				localCampaign = campaign;
			} else if (!localCampaign) {
				// Initialize localCampaign if it doesn't exist
				localCampaign = campaign;
			} else {
				// Sync pipeline_id and other fields from campaign if they differ
				// This ensures we pick up updates from server-side data
				if (campaign.pipeline_id !== localCampaign.pipeline_id) {
					localCampaign = {
						...localCampaign,
						pipeline_id: campaign.pipeline_id
					};
				}
			}
		} else {
			// Reset localCampaign if campaign is null
			localCampaign = null;
		}
	});
	
	async function loadConversation(campId: string) {
		isInitializing = true;
		initError = null;
		try {
			const response = await fetch(`/api/chat/${campId}`);
			if (!response.ok) {
				throw new Error(`Failed to load conversation (${response.status})`);
			}
			const data = (await response.json()) as ConversationResponse;
			applyConversationSnapshot(data);
		} catch (error) {
			console.error('[campaign] conversation load failed', error);
			initError = error instanceof Error ? error.message : 'Failed to load conversation';
		} finally {
			isInitializing = false;
		}
	}

	function applyConversationSnapshot(data: ConversationResponse) {
		campaignId = data.conversation.id;
		messages = data.conversation.messages;
		collected = data.conversation.collected ?? {};
		followerRange = data.conversation.followerRange ?? { min: null, max: null };
		
		// Extract influencer summary from last assistant message when status is ready
		if (data.conversation.status === 'ready' && messages.length > 0) {
			const lastMessage = messages[messages.length - 1];
			if (lastMessage.role === 'assistant' && lastMessage.content) {
				// Extract summary from message content (it's after "All required slots filled...")
				const content = lastMessage.content;
				const summaryMatch = content.match(/All required slots filled[^\n]*\n\n([\s\S]*)/);
				if (summaryMatch && summaryMatch[1]) {
					influencerSummary = summaryMatch[1].trim();
					// Initialize form fields from collected data
					if (followerRange.min !== null) searchFormMinFollowers = followerRange.min;
					if (followerRange.max !== null) searchFormMaxFollowers = followerRange.max;
				}
			}
		}
	}

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
				setTimeout(() => scrollToBottom(), 0);
			} else if (eventType === 'error') {
				const payload = JSON.parse(data) as { message?: string };
				throw new Error(payload.message ?? 'Assistant stream failed');
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
					if (line.startsWith('event:')) {
						eventType = line.slice(6).trim();
					} else if (line.startsWith('data:')) {
						data += line.slice(5).trim();
					}
				}
				if (data) {
					processEvent(eventType, data);
				}
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

			if (hasPlaceholder) {
				removeMessageById(placeholderId);
			}
		} catch (error) {
			if (hasPlaceholder) {
				removeMessageById(placeholderId);
			}
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

	// Calculate progress based on collected campaign data
	const progress = $derived(() => calculateProgress(collected, followerRange));
	
	// Check if progress is 100%
	const isProgressComplete = $derived(progress() === 100);
	
	// Handle search form submission
	async function handleSearchFormSubmit(event?: SubmitEvent) {
		if (event) {
			event.preventDefault();
		}
		if (isSearchFormSubmitting || !influencerSummary.trim()) return;
		
		isSearchFormSubmitting = true;
		try {
			const response = await fetch('/api/search/influencers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					business_description: influencerSummary.trim(),
					top_n: searchFormTopN,
					min_followers: searchFormMinFollowers,
					max_followers: searchFormMaxFollowers,
					campaign_id: campaign?.id ?? routeCampaignId ?? null
				})
			});
			
			// Parse response body first
			let responseData;
			try {
				responseData = await response.json();
			} catch (parseError) {
				// If JSON parsing fails, treat as generic error
				throw new Error(`Search failed: ${response.status} ${response.statusText}`);
			}
			
			if (!response.ok) {
				// Check if it's a search limit exceeded error
				// API returns errors in format: { error: { code, message, details } }
				const errorInfo = responseData.error || responseData;
				if (errorInfo.code === 'SEARCH_LIMIT_EXCEEDED' && errorInfo.details) {
					searchLimitError = {
						remaining: errorInfo.details.remaining ?? 0,
						requested: errorInfo.details.requested ?? searchFormTopN,
						limit: errorInfo.details.limit ?? 0
					};
					searchLimitExceededOpen = true;
					isSearchFormSubmitting = false;
					return;
				}
				
				throw new Error(errorInfo.message || `Search failed: ${response.status}`);
			}
			
			const data = responseData.data ?? responseData;
			
			// Update local campaign with pipeline_id
			if (data.job_id) {
				const baseCampaign = localCampaign ?? campaign;
				if (baseCampaign) {
					localCampaign = {
						...baseCampaign,
						pipeline_id: data.job_id,
						updatedAt: Date.now()
					};
				}
				// Switch to outreach tab
				activeTab = 'outreach';
				await loadPipelineStatus(data.job_id);
				startPipelinePolling(data.job_id);
				if (browser) {
					setTimeout(() => window.location.reload(), 0);
				}
			}
		} catch (error) {
			console.error('Failed to start influencer search:', error);
			// Only show alert if we haven't already shown the limit exceeded panel
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
	
	let upgradePanelTitle = $state<string | undefined>(undefined);
	let upgradePanelDescription = $state<string | undefined>(undefined);
	
	function openUpgradePanel(title?: string, description?: string) {
		upgradePanelTitle = title;
		upgradePanelDescription = description;
		upgradePanelOpen = true;
	}
	
	// Rerun pipeline warning modal state
	let rerunPipelineWarningOpen = $state(false);
	
	function openRerunPipelineWarning() {
		rerunPipelineWarningOpen = true;
	}
	
	function closeRerunPipelineWarning() {
		rerunPipelineWarningOpen = false;
	}
	
	async function handleRerunPipeline() {
		closeRerunPipelineWarning();
		// Call the same search submit handler - it will create a new pipeline
		await handleSearchFormSubmit();
	}
	
	// Track if page is fully loaded
	const isPageLoaded = $derived(() => {
		// During SSR, always return true to prevent hydration mismatches
		if (!browser) return true;
		
		// Page is loaded when:
		// 1. Campaign data exists
		// 2. If on chat tab: conversation is loaded (not initializing and no error)
		// 3. If on outreach tab: either no pipeline_id (show search form) or pipeline status is loaded
		if (!campaign) return false;
		
		if (activeTab === 'chat') {
			// For chat tab, we're loaded if not initializing and no error
			// Allow showing content even if there's an error (user can retry)
			return !isInitializing;
		} else if (activeTab === 'outreach') {
			// If no pipeline_id, we show search form (loaded)
			if (!effectiveCampaign?.pipeline_id) return true;
			// If pipeline_id exists, wait for pipeline status to load
			// But don't wait forever - if it's been a while, show content anyway
			return pipelineStatus !== null;
		}
		
		return true;
	});
</script>

<svelte:head>
	<title>{campaign?.title ?? 'Campaign'} – Penni AI</title>
</svelte:head>

<div class="flex h-full flex-col relative">
	<!-- Blur Loading Cover -->
	<CampaignLoadingCover isLoading={browser && !isPageLoaded()} />
	
	<!-- Main Content -->
	<div 
		class="flex h-full flex-col {browser ? 'transition-opacity duration-200' : ''} {browser && !isPageLoaded() ? 'opacity-0 pointer-events-none' : ''}"
	>
	<!-- Tab Navigation -->
	<CampaignTabs
		activeTab={activeTab}
		hasUserMessages={hasUserMessages()}
		onTabChange={(tab) => {
			activeTab = tab;
			if (tab === 'chat' && campaign?.id) {
						if (!campaignId || isInitializing) {
							void loadConversation(campaign.id);
						}
			} else if (tab === 'outreach' && effectiveCampaign?.pipeline_id) {
							void loadPipelineStatus(effectiveCampaign.pipeline_id);
							startPipelinePolling(effectiveCampaign.pipeline_id);
						}
					}}
	/>

	<!-- Tab Content -->
	<div class="flex-1 overflow-hidden relative">
		<!-- Sliding Window Container -->
		<div 
			class="flex h-full transition-transform duration-300 ease-in-out"
			style="width: 200%; transform: translateX({activeTab === 'chat' ? '0' : '-50'}%);"
		>
			<!-- Chat Tab Panel -->
			<ChatTab
				{campaignId}
				{messages}
				{isInitializing}
				{initError}
				draft={draft}
				{isSending}
				{collected}
				{followerRange}
				influencerSummary={influencerSummary}
				searchFormTopN={searchFormTopN}
				searchFormMinFollowers={searchFormMinFollowers}
				searchFormMaxFollowers={searchFormMaxFollowers}
				{isSearchFormSubmitting}
				{effectiveCampaign}
				maxInfluencers={maxInfluencers()}
				{debugMode}
				messagesContainer={messagesContainer}
				onRetry={() => campaign?.id && void loadConversation(campaign.id)}
				onSubmit={async (message) => {
					draft = '';
					await sendStreamingMessage(message);
				}}
				onDraftChange={(value) => { draft = value; }}
				onSearchSubmit={(params) => {
					// Update form values from params
					influencerSummary = params.business_description;
					searchFormTopN = params.top_n;
					searchFormMinFollowers = params.min_followers;
					searchFormMaxFollowers = params.max_followers;
					// Call the actual submit handler
																void handleSearchFormSubmit();
														}}
				onToggleDebug={() => debugMode = !debugMode}
				onScrollToBottom={scrollToBottom}
				onRerunPipeline={openRerunPipelineWarning}
			/>
			
		<!-- Outreach Tab Panel -->
		<OutreachTab
			{effectiveCampaign}
			{pipelineStatus}
			{selectedInfluencerIds}
			{contactedInfluencerIds}
			{showContacted}
			{previousProfileIds}
			campaignId={routeCampaignId ?? null}
			onToggleInfluencer={toggleInfluencerSelection}
			onToggleContacted={() => showContacted = !showContacted}
			onSendOutreach={handleSendOutreach}
		/>
						</div>
							</div>
							</div>
						</div>
						
<!-- Modals and Panels -->
<!-- Outreach Panel -->
<CampaignOutreachPanel 
	open={outreachPanelOpen} 
	influencers={selectedInfluencers()} 
	campaignId={routeCampaignId}
	onClose={closeOutreachPanel}
/>

<!-- Upgrade Panel (shown for free plan users) -->
<OutreachUpgradePanel 
	open={upgradePanelOpen} 
	onClose={closeUpgradePanel}
	returnUrl={`/campaign/${routeCampaignId}?tab=${activeTab}`}
	title={upgradePanelTitle}
	description={upgradePanelDescription}
/>

<!-- Search Limit Exceeded Panel -->
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

<!-- Rerun Pipeline Warning -->
<RerunPipelineWarning
	open={rerunPipelineWarningOpen}
	onClose={closeRerunPipelineWarning}
	onConfirm={handleRerunPipeline}
	topN={searchFormTopN}
/>
