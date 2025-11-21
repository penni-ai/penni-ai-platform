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
	import { getProfileId, getPlatformLogo, getPlatformColor, normalizePlatforms } from '$lib/utils/campaign';

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
	let hasLoadedConversation = $state(false);
	
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
	let conversationStatus = $state<'collecting' | 'ready' | 'searching' | 'complete' | 'needs_config' | 'error'>('collecting');
	let isInitializing = $state(true);
	let isSending = $state(false);
	let initError = $state<string | null>(null);
	let chatError = $state<string | null>(null);
	// Removed openSourcesMessageId - now using hover tooltips instead
	const textDecoder = new TextDecoder();
	let messagesContainer: HTMLDivElement | null = $state(null);
	let scrollTimeoutId: ReturnType<typeof setTimeout> | null = null;
	
	// Influencer search form state (for embedded message)
	let influencerSummary = $state('');
	let searchFormTopN = $state(30);
	let searchFormMinFollowers = $state<number | null>(null);
	let searchFormMaxFollowers = $state<number | null>(null);
	let isSearchFormSubmitting = $state(false);
	
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
		preliminary_candidates?: Array<{
			profile_url?: string;
			display_name?: string;
			followers?: number;
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
	let currentPollingPipelineId = $state<string | null>(null); // Track which pipeline ID we're currently polling
	let manualRefreshInterval: ReturnType<typeof setInterval> | null = null; // Manual refresh interval for outreach tab
	let previousProfileIds = $state<Set<string>>(new Set());
	let selectedInfluencerIds = $state<Set<string>>(new Set());
	let contactedInfluencerIds = $state<Set<string>>(new Set());
	let showContacted = $state(false); // When false, show uncontacted; when true, show contacted
	let outreachPanelOpen = $state(false);
	let upgradePanelOpen = $state(false);
	let searchLimitExceededOpen = $state(false);
	let searchLimitError = $state<{ remaining?: number; requested?: number; limit?: number } | null>(null);
	// Track when pipeline_id is set from API response to prevent Firestore listener from overwriting it
	let lastApiSetPipelineId = $state<{ pipelineId: string; timestamp: number } | null>(null);
	let unsubscribePipelineJob: (() => void) | null = null; // Firestore listener for pipeline job updates
	
	// Track temporary pipeline ID from search API response (before Firestore sync)
	let temporaryPipelineId = $state<string | null>(null);
	
	// Derived pipeline ID that falls back to temporaryPipelineId when campaign pipeline_id is not yet available
	const effectivePipelineId = $derived(() => {
		const campaignPipelineId = effectiveCampaign?.pipeline_id;
		if (campaignPipelineId) return campaignPipelineId;
		return temporaryPipelineId;
	});
	
	// Track pipeline creation timestamp and attempt count for grace period handling
	let pipelineCreationTimestamps = $state<Map<string, { createdAt: number; attemptCount: number }>>(new Map());
	
	// Track last seen pipeline ID in the effect to detect changes
	let lastSeenPipelineId = $state<string | null>(null);
	
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

	// Removed toggleSources - now using hover tooltips instead

	function scrollToBottom() {
		// Clear any pending scroll
		if (scrollTimeoutId) {
			clearTimeout(scrollTimeoutId);
			scrollTimeoutId = null;
		}
		
		// Debounce scroll to coalesce rapid updates
		scrollTimeoutId = setTimeout(() => {
		if (messagesContainer) {
				// Custom smooth scroll animation with slower, more animated behavior
				const startScrollTop = messagesContainer.scrollTop;
				const targetScrollTop = messagesContainer.scrollHeight;
				const distance = targetScrollTop - startScrollTop;
				const duration = Math.min(800, Math.max(300, Math.abs(distance) * 0.5)); // 300-800ms based on distance
				const startTime = performance.now();
				
				// Easing function for smooth animation (ease-out cubic)
				const easeOutCubic = (t: number): number => {
					return 1 - Math.pow(1 - t, 3);
				};
				
				const animateScroll = (currentTime: number) => {
					const elapsed = currentTime - startTime;
					const progress = Math.min(elapsed / duration, 1);
					const easedProgress = easeOutCubic(progress);
					
					messagesContainer!.scrollTop = startScrollTop + (distance * easedProgress);
					
					if (progress < 1) {
						requestAnimationFrame(animateScroll);
					}
				};
				
				requestAnimationFrame(animateScroll);
		}
			scrollTimeoutId = null;
		}, 50);
	}
	
	// Auto-scroll when messages change and we're on chat tab
	$effect(() => {
		if (messages.length > 0 && activeTab === 'chat') {
			scrollToBottom();
		}
	});

	// Auto-scroll when switching to chat tab
	$effect(() => {
		if (activeTab === 'chat' && messagesContainer && messages.length > 0) {
			scrollToBottom();
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
				hasLoadedConversation = false;
				// Reset localCampaign when switching campaigns to ensure reactivity
				localCampaign = null;
				// Clear temporary pipeline ID when switching campaigns
				temporaryPipelineId = null;
				// Clear pipeline creation timestamps
				pipelineCreationTimestamps.clear();
				// Load conversation for the new campaign
				void loadConversation(currentCampaignId);
			} else if (!hasLoadedConversation && campaign?.id) {
				// Load if we're on chat tab but haven't loaded yet
				void loadConversation(campaign.id);
			}
		}
	});

	onMount(() => {
		if (!browser) return;
		
		// Load search usage when component mounts
		void loadSearchUsage();
		
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
					// But don't overwrite if we just set it from an API response (within 5 seconds)
					const currentPipelineId = baseCampaign.pipeline_id ?? null;
					const recentlySetFromApi = lastApiSetPipelineId && 
						(Date.now() - lastApiSetPipelineId.timestamp < 5000) &&
						currentPipelineId === lastApiSetPipelineId.pipelineId;
					
					if (updatedPipelineId !== currentPipelineId) {
						// If Firestore has a different pipeline_id but we just set one from API, 
						// prefer the API-set one (it's newer)
						if (recentlySetFromApi && lastApiSetPipelineId && updatedPipelineId !== lastApiSetPipelineId.pipelineId) {
							console.warn('[campaign] Firestore has old pipeline_id, but we just set a new one from API. Keeping API-set pipeline_id:', {
								firestorePipelineId: updatedPipelineId,
								apiSetPipelineId: lastApiSetPipelineId.pipelineId,
								campaignId: campaignId
							});
							// Don't update - keep the API-set pipeline_id
							return;
						}
						
					// Update localCampaign with new pipeline_id
					localCampaign = {
						...baseCampaign,
						pipeline_id: updatedPipelineId
					};
					
					// Clear temporary pipeline ID since Firestore has synced
					if (temporaryPipelineId === updatedPipelineId) {
						temporaryPipelineId = null;
					}
					
					// Clear the API-set tracking since Firestore has synced
					lastApiSetPipelineId = null;
					
					console.log('[campaign] Pipeline ID synced from Firestore:', {
						event: 'firestore_pipeline_id_update',
						pipelineId: updatedPipelineId,
						previous: currentPipelineId,
						campaignId: campaignId,
						activeTab,
						effectivePipelineId: effectivePipelineId(),
						currentPollingPipelineId
					});
					
					// Pipeline loading/polling is handled by the $effect watching effectivePipelineId and activeTab
					} else if (updatedPipelineId === null && currentPipelineId !== null) {
						// Handle case where pipeline_id is cleared (shouldn't happen normally, but handle it)
						// But don't clear if we just set it from API
						if (!recentlySetFromApi) {
						localCampaign = {
							...baseCampaign,
							pipeline_id: null
						};
							lastApiSetPipelineId = null;
						}
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
		
		// Set up pipeline job listener when pipeline_id is available
		// Use $effect to manage listener lifecycle properly
		$effect(() => {
			const pipelineId = effectiveCampaign?.pipeline_id;
			const currentUser = firebaseAuth.currentUser;
			
			// Clean up existing listener first
			if (unsubscribePipelineJob) {
				try {
					unsubscribePipelineJob();
				} catch (error) {
					console.warn('[pipeline] Error cleaning up listener:', error);
				}
				unsubscribePipelineJob = null;
			}
			
			// Only set up listener if we have both pipelineId and user
			if (!pipelineId || !currentUser) {
				return;
			}
			
			// Set up new listener
			const pipelineJobDocRef = doc(firebaseFirestore, 'pipeline_jobs', pipelineId);
			
			unsubscribePipelineJob = onSnapshot(
				pipelineJobDocRef,
				(snapshot) => {
					try {
						// Only process if this is still the current pipeline
						if (currentPollingPipelineId && currentPollingPipelineId !== pipelineId) {
							console.log(`[pipeline] Skipping Firestore update for old pipeline ID: ${pipelineId} (current: ${currentPollingPipelineId})`);
							return;
						}
						
						if (!snapshot.exists()) {
							console.log('[pipeline] Pipeline job document does not exist:', pipelineId);
							return;
						}
						
						// Get data - wrap in try-catch to handle any Firestore access errors
						let data: any;
						try {
							data = snapshot.data();
						} catch (error) {
							console.error('[pipeline] Error getting snapshot data:', error);
							return;
						}
						
						if (!data || typeof data !== 'object') {
							console.warn('[pipeline] Invalid snapshot data:', pipelineId);
							return;
						}
						
						// Helper to safely get nested property
						const safeGet = (obj: any, path: string[]): any => {
							try {
								let current = obj;
								for (const key of path) {
									if (current == null || typeof current !== 'object') {
										return undefined;
									}
									current = current[key];
								}
								return current;
							} catch {
								return undefined;
							}
						};
						
						// Map Firestore fields to PipelineStatus shape with safe property access
						const firestoreStatus = {
							status: (data.status || 'pending') as 'pending' | 'running' | 'completed' | 'error' | 'cancelled',
							current_stage: data.current_stage || null,
							completed_stages: Array.isArray(data.completed_stages) ? data.completed_stages : [],
							overall_progress: typeof data.overall_progress === 'number' ? data.overall_progress : 0,
							profiles_count: typeof data.profiles_count === 'number' ? data.profiles_count : 0,
							profiles: pipelineStatus?.profiles || [], // Keep existing profiles until API loads them
							stages: {
								query_expansion: (() => {
									const qe = safeGet(data, ['query_expansion']);
									if (!qe || typeof qe !== 'object') return null;
									return {
										status: qe.status || 'pending',
										queries: Array.isArray(qe.queries) ? qe.queries : []
									};
								})(),
								weaviate_search: (() => {
									const ws = safeGet(data, ['weaviate_search']);
									if (!ws || typeof ws !== 'object') return null;
									return {
										status: ws.status || 'pending',
										deduplicated_results: typeof ws.deduplicated_results === 'number' ? ws.deduplicated_results : undefined
									};
								})(),
								brightdata_collection: (() => {
									const bd = safeGet(data, ['brightdata_collection']);
									if (!bd || typeof bd !== 'object') return null;
									return {
										status: bd.status || 'pending',
										profiles_collected: typeof bd.profiles_collected === 'number' ? bd.profiles_collected : undefined,
										batches_completed: typeof bd.batches_completed === 'number' ? bd.batches_completed : undefined,
										total_batches: typeof bd.total_batches === 'number' ? bd.total_batches : undefined
									};
								})(),
								llm_analysis: (() => {
									const llm = safeGet(data, ['llm_analysis']);
									if (!llm || typeof llm !== 'object') return null;
									return {
										status: llm.status || 'pending',
										profiles_analyzed: typeof llm.profiles_analyzed === 'number' ? llm.profiles_analyzed : undefined
									};
								})()
							},
							error_message: data.error_message || null
						};
						
						// Update pipelineStatus with Firestore data
						// Preserve profiles and preliminary_candidates from previous state or API response
						pipelineStatus = {
							...firestoreStatus,
							profiles: pipelineStatus?.profiles || [],
							preliminary_candidates: pipelineStatus?.preliminary_candidates || []
						};
						
						console.log('[pipeline] Pipeline status synced from Firestore:', {
							event: 'pipeline_status_firestore_sync',
							pipelineId,
							status: firestoreStatus.status,
							current_stage: firestoreStatus.current_stage,
							overall_progress: firestoreStatus.overall_progress,
							currentPollingPipelineId,
							activeTab
						});
						
						// If pipeline is completed, error, or cancelled, stop polling
						if (firestoreStatus.status === 'completed' || firestoreStatus.status === 'error' || firestoreStatus.status === 'cancelled') {
							if (pipelinePollInterval) {
								clearInterval(pipelinePollInterval);
								pipelinePollInterval = null;
							}
						}
					} catch (error) {
						console.error('[pipeline] Error processing Firestore snapshot:', error);
						// Don't throw - just log the error and continue
					}
				},
				(error) => {
					console.error('[pipeline] Failed to listen to pipeline job updates', error);
				}
			);
			
			// Cleanup function for this effect
			return () => {
				if (unsubscribePipelineJob) {
					try {
						unsubscribePipelineJob();
					} catch (error) {
						console.warn('[pipeline] Error cleaning up listener in effect cleanup:', error);
					}
					unsubscribePipelineJob = null;
				}
			};
		});
		
		return () => {
			// Cleanup polling interval
			if (pipelinePollInterval) {
				clearInterval(pipelinePollInterval);
				pipelinePollInterval = null;
			}
			// Cleanup manual refresh interval
			if (manualRefreshInterval) {
				clearInterval(manualRefreshInterval);
				manualRefreshInterval = null;
			}
			// Cleanup campaign listener
			if (unsubscribeCampaign) {
				try {
				unsubscribeCampaign();
				} catch (error) {
					console.warn('[campaign] Error cleaning up campaign listener:', error);
				}
				unsubscribeCampaign = null;
			}
			// Note: pipeline job listener cleanup is handled by $effect cleanup
			// But we also clean it up here as a safety measure
			if (unsubscribePipelineJob) {
				try {
					unsubscribePipelineJob();
				} catch (error) {
					console.warn('[pipeline] Error cleaning up pipeline job listener:', error);
				}
				unsubscribePipelineJob = null;
			}
			// Cleanup auth listener
			unsubscribeAuth();
			// Cleanup scroll timeout
			if (scrollTimeoutId) {
				clearTimeout(scrollTimeoutId);
				scrollTimeoutId = null;
			}
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
					// Build profileIds set from all profile sources (final profiles and preliminary candidates)
					const profileIds = new Set<string>();
					
					// Include final profiles
					if (pipelineStatus?.profiles && Array.isArray(pipelineStatus.profiles)) {
						pipelineStatus.profiles.forEach((p) => {
							const id = p._id || getProfileId(p);
							if (id) profileIds.add(id);
						});
					}
					
					// Include preliminary candidates (if status is running and no final profiles yet)
					if (pipelineStatus?.status === 'running' && 
						(!pipelineStatus.profiles || pipelineStatus.profiles.length === 0) &&
						pipelineStatus?.preliminary_candidates && Array.isArray(pipelineStatus.preliminary_candidates)) {
						pipelineStatus.preliminary_candidates.forEach((c) => {
							const id = c._id || getProfileId(c);
							if (id) profileIds.add(id);
						});
					}
					
					// Validate that the saved IDs still exist in current profiles or preliminary candidates
					const validIds = new Set<string>();
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
	
	let pipelineError = $state<{ code: string; message: string; pipelineId: string } | null>(null);
	
	async function loadPipelineStatus(pipelineId: string) {
		// Only load if this is still the current pipeline we're tracking
		// This prevents loading old pipeline IDs after rerunning
		if (currentPollingPipelineId && currentPollingPipelineId !== pipelineId) {
			console.log('[pipeline] Skipping loadPipelineStatus for old pipeline ID:', {
				event: 'pipeline_load_skipped',
				pipelineId,
				currentPollingPipelineId,
				reason: 'pipeline_id_mismatch'
			});
			return;
		}
		
		// Increment attempt count for grace period tracking
		const creationInfo = pipelineCreationTimestamps.get(pipelineId);
		if (creationInfo) {
			creationInfo.attemptCount += 1;
		}
		
		try {
			const response = await fetch(`/api/pipeline/${pipelineId}`);
			if (response.ok) {
				// Clear any previous errors on success
				pipelineError = null;
				
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
				
				// Add unique IDs to preliminary candidates if they don't have them
				if (data.preliminary_candidates && Array.isArray(data.preliminary_candidates)) {
					data.preliminary_candidates = data.preliminary_candidates.map((candidate: any) => ({
						...candidate,
						_id: candidate._id || getProfileId(candidate)
					}));
				}
				
				const previousCount = pipelineStatus?.profiles?.length ?? 0;
				const newCount = data.profiles?.length ?? 0;
				
				console.log('[pipeline] Loaded pipeline status:', {
					event: 'pipeline_status_loaded',
					pipelineId,
					status: data.status,
					profilesCount: newCount,
					previousCount,
					newProfiles: newCount - previousCount,
					profilesStoragePath: data.profiles_storage_path,
					currentPollingPipelineId,
					activeTab
				});
				
				// Merge completed profiles back into preliminary_candidates to update rows in place
				if (data.preliminary_candidates && data.preliminary_candidates.length > 0 && data.profiles && data.profiles.length > 0) {
					// Create a map of completed profiles by ID for quick lookup
					const completedProfilesMap = new Map<string, typeof data.profiles[0]>();
					data.profiles.forEach((profile: any) => {
						const profileId = profile._id || getProfileId(profile);
						completedProfilesMap.set(profileId, profile);
					});
					
					// Update preliminary candidates with real data where available
					data.preliminary_candidates = data.preliminary_candidates.map((candidate: any) => {
						const candidateId = candidate._id || getProfileId(candidate);
						const completedProfile = completedProfilesMap.get(candidateId);
						
						if (completedProfile) {
							// Merge completed profile data into candidate, preserving candidate's position
							return {
								...candidate,
								...completedProfile,
								// Ensure we keep the candidate's _id to maintain position
								_id: candidateId
							};
						}
						
						return candidate;
					});
					
					console.log('[pipeline] Merged completed profiles into preliminary candidates:', {
						event: 'preliminary_candidates_updated',
						pipelineId,
						preliminaryCount: data.preliminary_candidates.length,
						completedCount: data.profiles.length,
						updatedCount: Array.from(completedProfilesMap.keys()).length
					});
				}
				
				// Update previous profile IDs set for animation tracking
				if (pipelineStatus?.profiles) {
					previousProfileIds = new Set(pipelineStatus.profiles.map(p => p._id || getProfileId(p)));
				}
				
				pipelineStatus = data;
				
				// Clear creation tracking on success
				pipelineCreationTimestamps.delete(pipelineId);
				
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
				const errorCode = errorData?.error?.code || errorData?.code || 'UNKNOWN_ERROR';
				const errorMessage = errorData?.error?.message || errorData?.message || 'Failed to load pipeline status';
				
				console.error('[pipeline] Failed to load pipeline status:', {
					event: 'pipeline_load_failed',
					pipelineId,
					status: response.status,
					code: errorCode,
					message: errorMessage,
					currentPollingPipelineId,
					activeTab,
					errorData
				});
				
				// Handle terminal error conditions
				if (errorCode === 'PIPELINE_NOT_FOUND' || errorCode === 'PIPELINE_FORBIDDEN') {
					const now = Date.now();
					const creationInfo = pipelineCreationTimestamps.get(pipelineId);
					const timeSinceCreation = creationInfo ? now - creationInfo.createdAt : Infinity;
					const attemptCount = creationInfo?.attemptCount ?? 0;
					
					// Grace period: first 2 attempts OR within 5 seconds of creation
					const isWithinGracePeriod = attemptCount <= 2 || timeSinceCreation < 5000;
					
					// Enhanced logging for PIPELINE_FORBIDDEN
					if (errorCode === 'PIPELINE_FORBIDDEN') {
						const currentUser = firebaseAuth.currentUser;
						console.warn('[pipeline] PIPELINE_FORBIDDEN error:', {
							event: 'pipeline_forbidden',
							pipelineId,
							userId: currentUser?.uid || 'unknown',
							campaignId: effectiveCampaign?.id || 'unknown',
							attemptCount,
							timeSinceCreation,
							isWithinGracePeriod,
							reason: isWithinGracePeriod 
								? 'likely_replication_delay' 
								: 'possible_structural_mismatch',
							currentPollingPipelineId,
							activeTab
						});
					}
					
					// Only fake pending state during grace period
					if (isWithinGracePeriod && !pipelineStatus && currentPollingPipelineId === pipelineId) {
						console.log('[pipeline] Creating fake pending state during grace period:', {
							event: 'pipeline_fake_pending',
							pipelineId,
							attemptCount,
							timeSinceCreation,
							reason: 'grace_period'
						});
						
						pipelineStatus = {
							status: 'pending',
							current_stage: null,
							completed_stages: [],
							overall_progress: 0,
							profiles_count: 0,
							profiles: [],
							preliminary_candidates: [],
							stages: {
								query_expansion: null,
								weaviate_search: null,
								brightdata_collection: null,
								llm_analysis: null
							},
							error_message: null
						};
						// Don't set error if we initialized status - document might just be creating
						pipelineError = null;
					} else {
						// Grace period expired or not applicable - show actual error
						console.error('[pipeline] Grace period expired, showing error:', {
							event: 'pipeline_error_shown',
							pipelineId,
							errorCode,
							attemptCount,
							timeSinceCreation,
							isWithinGracePeriod,
							hasExistingStatus: !!pipelineStatus
						});
						
						pipelineError = {
							code: errorCode,
							message: errorCode === 'PIPELINE_FORBIDDEN' 
								? 'You do not have permission to access this pipeline.'
								: 'Pipeline not found.',
							pipelineId
						};
						
						// Stop polling for this pipeline
						if (currentPollingPipelineId === pipelineId) {
							if (pipelinePollInterval) {
								clearInterval(pipelinePollInterval);
								pipelinePollInterval = null;
							}
							currentPollingPipelineId = null;
						}
						
						// Clear creation tracking since we're giving up
						pipelineCreationTimestamps.delete(pipelineId);
					}
					// Don't clear pipelineStatus - keep last successful state to avoid UI flicker
					// The error will be displayed while preserving any existing data
				} else {
					// Non-terminal error - set error state but continue polling
					pipelineError = {
						code: errorCode,
						message: errorMessage,
						pipelineId
					};
				}
			}
		} catch (error) {
			console.error('[pipeline] Network error loading pipeline status:', {
				event: 'pipeline_load_network_error',
				pipelineId,
				error: error instanceof Error ? error.message : String(error),
				currentPollingPipelineId,
				activeTab
			});
			pipelineError = {
				code: 'NETWORK_ERROR',
				message: error instanceof Error ? error.message : 'Failed to load pipeline status',
				pipelineId
			};
		}
	}
	
	function startPipelinePolling(pipelineId: string) {
		// Always clear existing interval at the top to ensure only one active interval
		if (pipelinePollInterval) {
			console.log('[pipeline] Clearing existing polling interval:', {
				event: 'pipeline_polling_cleared',
				previousPipelineId: currentPollingPipelineId,
				newPipelineId: pipelineId,
				reason: 'starting_new_polling'
			});
			clearInterval(pipelinePollInterval);
			pipelinePollInterval = null;
		}
		
		// Update the current polling pipeline ID
		currentPollingPipelineId = pipelineId;
		
		// Clear any previous errors when starting polling
		pipelineError = null;
		
		// Reduce polling frequency when Firestore listener is active (poll every 10 seconds instead of 3)
		// The Firestore listener will handle real-time updates, polling is just a fallback
		const pollInterval = unsubscribePipelineJob ? 10000 : 3000;
		
		console.log('[pipeline] Starting pipeline polling:', {
			event: 'pipeline_polling_started',
			pipelineId,
			pollInterval,
			hasFirestoreListener: !!unsubscribePipelineJob,
			activeTab,
			effectivePipelineId: effectivePipelineId()
		});
		
		// Poll at reduced frequency (or stop entirely if Firestore listener is active and working)
		pipelinePollInterval = setInterval(async () => {
			// Only poll if we're still on the outreach tab and this is still the current pipeline
			if (activeTab === 'outreach' && currentPollingPipelineId === pipelineId) {
				// If Firestore listener is active, skip polling for status updates (only poll for profiles)
				// Profiles are loaded from Storage via API, not Firestore
				if (!unsubscribePipelineJob) {
					await loadPipelineStatus(pipelineId);
				} else {
					// Firestore listener handles status, but we still need to poll for profile updates
					// Only load profiles if status indicates we should have profiles
					if (pipelineStatus?.status === 'running' || pipelineStatus?.status === 'completed') {
						await loadPipelineStatus(pipelineId);
					}
				}
				
				// Stop polling if pipeline is completed, error, cancelled, or if we have a terminal error
				// Also check that we're still polling the same pipeline ID
				if (currentPollingPipelineId !== pipelineId) {
					// Pipeline ID changed, stop polling
					console.log('[pipeline] Pipeline ID changed during polling, stopping:', {
						event: 'pipeline_polling_stopped',
						previousPipelineId: pipelineId,
						newPipelineId: currentPollingPipelineId,
						reason: 'pipeline_id_changed'
					});
					if (pipelinePollInterval) {
						clearInterval(pipelinePollInterval);
						pipelinePollInterval = null;
					}
					return;
				}
				
				if (pipelineStatus?.status === 'completed' || pipelineStatus?.status === 'error' || pipelineStatus?.status === 'cancelled' || 
					(pipelineError && (pipelineError.code === 'PIPELINE_NOT_FOUND' || pipelineError.code === 'PIPELINE_FORBIDDEN'))) {
					// Give it one more poll cycle to ensure we have the final data, then stop
					setTimeout(() => {
						if (pipelinePollInterval && currentPollingPipelineId === pipelineId && 
							(pipelineStatus?.status === 'completed' || pipelineStatus?.status === 'error' || pipelineStatus?.status === 'cancelled' ||
							(pipelineError && (pipelineError.code === 'PIPELINE_NOT_FOUND' || pipelineError.code === 'PIPELINE_FORBIDDEN')))) {
							console.log('[pipeline] Pipeline reached terminal state, stopping polling:', {
								event: 'pipeline_polling_stopped',
								pipelineId,
								status: pipelineStatus?.status,
								errorCode: pipelineError?.code,
								reason: 'terminal_state'
							});
							clearInterval(pipelinePollInterval);
							pipelinePollInterval = null;
							if (currentPollingPipelineId === pipelineId) {
								currentPollingPipelineId = null;
							}
						}
					}, pollInterval);
				}
			} else {
				// Stop polling if user switched away from outreach tab or pipeline ID changed
				console.log('[pipeline] Stopping polling due to tab change or pipeline ID mismatch:', {
					event: 'pipeline_polling_stopped',
					pipelineId,
					activeTab,
					currentPollingPipelineId,
					reason: activeTab !== 'outreach' ? 'tab_changed' : 'pipeline_id_mismatch'
				});
				if (pipelinePollInterval) {
					clearInterval(pipelinePollInterval);
					pipelinePollInterval = null;
				}
				if (currentPollingPipelineId === pipelineId) {
					currentPollingPipelineId = null;
				}
			}
		}, pollInterval);
	}
	
	// Watch for pipeline ID changes and activeTab changes
	// This is the single owner for pipeline loading and polling
	$effect(() => {
		const pipelineId = effectivePipelineId();
		const currentTab = activeTab;
		const previousPipelineId = lastSeenPipelineId;
		
		// Update last seen pipeline ID
		lastSeenPipelineId = pipelineId;
		
		// Determine if pipeline ID changed
		const pipelineIdChanged = pipelineId !== previousPipelineId;
		
		console.log('[campaign] Pipeline loading effect triggered:', {
			event: 'pipeline_loading_effect',
			pipelineId,
			previousPipelineId,
			pipelineIdChanged,
			activeTab: currentTab,
			currentPollingPipelineId,
			effectiveCampaignPipelineId: effectiveCampaign?.pipeline_id,
			temporaryPipelineId
		});
		
		// Clear existing polling when pipeline ID changes or tab changes away from outreach
		if (pipelinePollInterval && (pipelineIdChanged || currentTab !== 'outreach')) {
			console.log('[campaign] Stopping pipeline polling:', {
				event: 'pipeline_polling_stopped',
				reason: pipelineIdChanged ? 'pipeline_id_changed' : 'tab_changed',
				previousPipelineId,
				newPipelineId: pipelineId,
				activeTab: currentTab
			});
			clearInterval(pipelinePollInterval);
			pipelinePollInterval = null;
			if (currentPollingPipelineId && currentPollingPipelineId !== pipelineId) {
				currentPollingPipelineId = null;
			}
		}
		
		// Start loading and polling if on outreach tab and pipeline exists
		if (pipelineId && currentTab === 'outreach') {
			const shouldStartPolling = !currentPollingPipelineId || currentPollingPipelineId !== pipelineId;
			
			console.log('[campaign] Starting pipeline loading/polling:', {
				event: 'pipeline_loading_started',
				pipelineId,
				shouldStartPolling,
				currentPollingPipelineId,
				pipelineIdChanged
			});
			
			// Load pipeline status once when pipeline ID becomes available or changes
			void loadPipelineStatus(pipelineId);
			
			// Start polling if not already polling this pipeline
			if (shouldStartPolling) {
				startPipelinePolling(pipelineId);
			}
		} else if (!pipelineId && currentTab === 'outreach') {
			console.log('[campaign] Pipeline ID not available on outreach tab:', {
				event: 'pipeline_id_missing',
				activeTab: currentTab,
				effectiveCampaignPipelineId: effectiveCampaign?.pipeline_id,
				temporaryPipelineId
			});
		}
		
		return () => {
			// Cleanup polling when effect cleanup runs
			if (pipelinePollInterval) {
				console.log('[campaign] Pipeline loading effect cleanup:', {
					event: 'pipeline_loading_effect_cleanup',
					pipelineId,
					activeTab: currentTab
				});
				clearInterval(pipelinePollInterval);
				pipelinePollInterval = null;
			}
		};
	});
	
	// Manual refresh interval for outreach tab - refreshes data every 5 seconds
	// Stops when pipeline is completed, error, or cancelled
	$effect(() => {
		const pipelineId = effectivePipelineId();
		const currentTab = activeTab;
		const pipelineStatusValue = pipelineStatus?.status;
		
		// Clear existing manual refresh interval
		if (manualRefreshInterval) {
			clearInterval(manualRefreshInterval);
			manualRefreshInterval = null;
		}
		
		// Check if pipeline is in a terminal state (completed, error, or cancelled)
		const isTerminalState = pipelineStatusValue === 'completed' || 
		                        pipelineStatusValue === 'error' || 
		                        pipelineStatusValue === 'cancelled';
		
		// Start manual refresh if on outreach tab, pipeline exists, and not in terminal state
		if (pipelineId && currentTab === 'outreach' && !isTerminalState) {
			console.log('[campaign] Starting manual refresh interval:', {
				event: 'manual_refresh_started',
				pipelineId,
				interval: 5000,
				pipelineStatus: pipelineStatusValue
			});
			
			manualRefreshInterval = setInterval(() => {
				// Check if pipeline reached terminal state
				const currentStatus = pipelineStatus?.status;
				const isTerminal = currentStatus === 'completed' || 
				                  currentStatus === 'error' || 
				                  currentStatus === 'cancelled';
				
				// Stop refreshing if pipeline is complete or user switched tabs
				if (isTerminal || activeTab !== 'outreach' || effectivePipelineId() !== pipelineId) {
					if (manualRefreshInterval) {
						console.log('[campaign] Stopping manual refresh interval:', {
							event: 'manual_refresh_stopped',
							pipelineId,
							reason: isTerminal ? 'pipeline_complete' : activeTab !== 'outreach' ? 'tab_changed' : 'pipeline_id_changed',
							pipelineStatus: currentStatus
						});
						clearInterval(manualRefreshInterval);
						manualRefreshInterval = null;
					}
					return;
				}
				
				console.log('[campaign] Manual refresh triggered:', {
					event: 'manual_refresh',
					pipelineId,
					pipelineStatus: currentStatus
				});
				void loadPipelineStatus(pipelineId);
			}, 5000); // 5 seconds
		}
		
		return () => {
			// Cleanup manual refresh interval
			if (manualRefreshInterval) {
				console.log('[campaign] Stopping manual refresh interval:', {
					event: 'manual_refresh_stopped',
					pipelineId,
					activeTab: currentTab,
					pipelineStatus: pipelineStatusValue
				});
				clearInterval(manualRefreshInterval);
				manualRefreshInterval = null;
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
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
		
		try {
			const response = await fetch(`/api/chat/${campId}`, {
				signal: controller.signal
			});
			
			clearTimeout(timeoutId);
			
			if (!response.ok) {
				throw new Error(`Failed to load conversation (${response.status})`);
			}
			const data = (await response.json()) as ConversationResponse;
			applyConversationSnapshot(data);
			hasLoadedConversation = true;
		} catch (error) {
			clearTimeout(timeoutId);
			console.error('[campaign] conversation load failed', error);
			if (error instanceof Error && error.name === 'AbortError') {
				initError = 'Request timed out. Please try again.';
			} else {
			initError = error instanceof Error ? error.message : 'Failed to load conversation';
			}
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
		
		// Extract or generate influencer summary when status is ready or complete
		if (data.conversation.status === 'ready' || data.conversation.status === 'complete') {
			// Try to extract summary from last assistant message first
			if (messages.length > 0) {
				const lastMessage = messages[messages.length - 1];
				if (lastMessage.role === 'assistant' && lastMessage.content) {
					const content = lastMessage.content;
					const summaryMatch = content.match(/All required slots filled[^\n]*\n\n([\s\S]*)/);
					if (summaryMatch && summaryMatch[1]) {
						influencerSummary = summaryMatch[1].trim();
					}
				}
			}
			
			// Always generate a summary from collected data when status is ready
			// This ensures we have something to show even if message extraction fails
			if (collected) {
				const parts: string[] = [];
				
				// Business information
				if (collected.business_name) {
					parts.push(collected.business_name);
				}
				if (collected.business_about) {
					parts.push(collected.business_about);
				}
				if (collected.website) {
					parts.push(`Website: ${collected.website}`);
				}
				
				// Influencer criteria
				const influencerParts: string[] = [];
				if (collected.type_of_influencer) {
					influencerParts.push(collected.type_of_influencer);
				}
				const platforms = normalizePlatforms(collected.platform);
				if (platforms.length > 0) {
					const platformText = platforms.length === 1 
						? platforms[0] 
						: platforms.join(' and ');
					influencerParts.push(`on ${platformText}`);
				}
				if (collected.influencer_location) {
					influencerParts.push(`in ${collected.influencer_location}`);
				}
				if (followerRange.min !== null || followerRange.max !== null) {
					const followerStr = followerRange.min !== null && followerRange.max !== null
						? `${followerRange.min}-${followerRange.max}`
						: followerRange.min !== null
						? `${followerRange.min}+`
						: `up to ${followerRange.max}`;
					influencerParts.push(`with ${followerStr} followers`);
				}
				
				if (influencerParts.length > 0) {
					parts.push(`Looking for ${influencerParts.join(' ')}`);
				}
				
				// Use generated summary if we don't have one from message, or combine them
				if (parts.length > 0) {
					const generatedSummary = parts.join('. ');
					if (!influencerSummary) {
						influencerSummary = generatedSummary;
					} else if (!influencerSummary.includes(generatedSummary)) {
						// Combine if they're different
						influencerSummary = `${influencerSummary}. ${generatedSummary}`;
					}
				}
			}
			
			// Fallback: if still no summary, create a basic one
			if (!influencerSummary) {
				influencerSummary = 'Ready to search for influencers matching your campaign criteria.';
			}
			
			// Initialize form fields from collected data
			if (followerRange.min !== null) searchFormMinFollowers = followerRange.min;
			if (followerRange.max !== null) searchFormMaxFollowers = followerRange.max;
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
			} else if (eventType === 'error') {
				const payload = JSON.parse(data) as { message?: string };
				const errorMessage = payload.message ?? 'Assistant stream failed';
				chatError = errorMessage;
				throw new Error(errorMessage);
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

	// Handle search form submission
	async function handleSearchFormSubmit(event?: SubmitEvent, params?: SearchParams) {
		if (event) {
			event.preventDefault();
		}
		if (isSearchFormSubmitting || !influencerSummary.trim()) return;
		
		isSearchFormSubmitting = true;
		try {
			// Use campaign_id from params if provided, otherwise fall back to page-level logic
			const campaignId = params?.campaign_id ?? campaign?.id ?? routeCampaignId ?? null;
			
			const response = await fetch('/api/search/influencers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					business_description: params?.business_description ?? influencerSummary.trim(),
					top_n: params?.top_n ?? searchFormTopN,
					min_followers: params?.min_followers ?? searchFormMinFollowers,
					max_followers: params?.max_followers ?? searchFormMaxFollowers,
					campaign_id: campaignId
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
			
			// Log campaign binding status if present
			if (data.campaign_binding_status) {
				if (data.campaign_binding_status !== 'updated' && data.campaign_binding_status !== 'noop_same') {
					console.warn('[Frontend] Campaign pipeline binding issue:', {
						status: data.campaign_binding_status,
						existingPipelineId: data.existingPipelineId || null,
						job_id: data.job_id || null
					});
					
					// When noop_other is returned, the campaign document still has the old pipeline_id
					// We need to use the new job_id, but the Firestore listener might overwrite it
					// So we track that we just set it from the API to prevent the listener from overwriting
					if (data.campaign_binding_status === 'noop_other' && data.job_id) {
						console.warn('[Frontend] Campaign has existing pipeline_id, but new job was created. Using new job_id:', {
							oldPipelineId: data.existingPipelineId,
							newPipelineId: data.job_id
						});
					}
				} else {
					console.log('[Frontend] Campaign pipeline binding:', {
						status: data.campaign_binding_status,
						existingPipelineId: data.existingPipelineId || null
					});
				}
			}
			
			// Update local campaign with pipeline_id
			if (data.job_id) {
				const baseCampaign = localCampaign ?? campaign;
				if (baseCampaign) {
					localCampaign = {
						...baseCampaign,
						pipeline_id: data.job_id,
						updatedAt: Date.now()
					};
					// Track that we just set this pipeline_id from API response
					// This prevents the Firestore listener from overwriting it for 5 seconds
					lastApiSetPipelineId = {
						pipelineId: data.job_id,
						timestamp: Date.now()
					};
				}
				
				// Set temporary pipeline ID for immediate availability in effectivePipelineId
				temporaryPipelineId = data.job_id;
				
				// Track creation timestamp for grace period handling
				pipelineCreationTimestamps.set(data.job_id, {
					createdAt: Date.now(),
					attemptCount: 0
				});
				
				// Switch to outreach tab
				activeTab = 'outreach';
				
				console.log('[campaign] Search form submitted successfully:', {
					event: 'search_form_submit_success',
					pipelineId: data.job_id,
					campaignId: baseCampaign?.id,
					activeTab: 'outreach',
					effectivePipelineId: effectivePipelineId(),
					currentPollingPipelineId
				});
				
				// Pipeline loading/polling is handled by the $effect watching effectivePipelineId and activeTab
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
	// This should return true as soon as campaign is loaded and initial route hydration is complete,
	// without waiting on chat or pipeline data
	const isPageLoaded = $derived(() => {
		// During SSR, always return true to prevent hydration mismatches
		if (!browser) return true;
		
		// Page is loaded when campaign data exists
		// Chat and pipeline data will show their own loading states within their tabs
		return campaign !== null;
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
				// Only load if we haven't loaded yet or campaign changed
				if (!hasLoadedConversation || campaignId !== campaign.id) {
							void loadConversation(campaign.id);
						}
						}
			// Pipeline loading/polling is handled by the $effect watching pipeline_id and activeTab
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
				{chatError}
				{conversationStatus}
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
				onMessagesContainerReady={(el) => { messagesContainer = el; }}
				onRetry={() => campaign?.id && void loadConversation(campaign.id)}
				onSubmit={async (message) => {
					draft = '';
					chatError = null;
					try {
						await sendStreamingMessage(message);
					} catch (error) {
						console.error('[chat] Failed to send message', error);
						if (!chatError) {
							chatError = error instanceof Error ? error.message : 'Failed to send message. Please try again.';
						}
					}
				}}
				onDraftChange={(value) => { draft = value; }}
				onSearchSubmit={(params) => {
					// Update form values from params
					influencerSummary = params.business_description;
					searchFormTopN = params.top_n;
					searchFormMinFollowers = params.min_followers;
					searchFormMaxFollowers = params.max_followers;
					// Call the actual submit handler with params to honor campaign_id
					void handleSearchFormSubmit(undefined, params);
														}}
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
			pipelineError={pipelineError}
			onToggleInfluencer={toggleInfluencerSelection}
			onToggleContacted={() => showContacted = !showContacted}
			onSendOutreach={handleSendOutreach}
			onRefresh={async () => {
				const pipelineId = effectivePipelineId();
				if (pipelineId) {
					await loadPipelineStatus(pipelineId);
				}
			}}
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
