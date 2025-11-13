<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { fade, fly } from 'svelte/transition';
	import Button from '$lib/components/Button.svelte';
	import type { PageData } from './$types';
	import { firebaseFirestore, firebaseAuth } from '$lib/firebase/client';
	import { doc, onSnapshot } from 'firebase/firestore';
	import { browser } from '$app/environment';
	import { onAuthStateChanged } from 'firebase/auth';
	import type { SerializedCampaign } from '$lib/server/campaigns';

	type MessageSource = {
		title?: string;
		url: string;
		query?: string;
	};

	type ApiMessage = {
		id: string;
		role: 'assistant' | 'user';
		content: string;
		type?: 'intro' | 'text' | 'summary';
		createdAt: string;
		sources?: MessageSource[];
	};

	type ConversationResponse = {
		conversation: {
			id: string;
			status: 'collecting' | 'ready' | 'searching' | 'complete' | 'needs_config' | 'error';
			collected: Record<string, string | undefined>;
			missing: string[];
			search?: {
				status: 'idle' | 'pending' | 'complete' | 'error' | 'needs_config';
				results?: unknown;
				lastError?: string | null;
			};
			messages: ApiMessage[];
			keywords: string[];
			followerRange: { min: number | null; max: number | null };
		};
	};

	let { data }: { data: PageData } = $props();
	const campaign = $derived(data.campaign);
	const routeCampaignId = $derived($page.params.id);

	function createCampaignFallback(id: string | null): SerializedCampaign {
		return {
			id,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			title: null,
			website: null,
			influencerTypes: null,
			locations: null,
			followers: null,
			business_location: null,
			followersMin: null,
			followersMax: null,
			keywords: [],
			businessSummary: null,
			influencerSearchQuery: null,
			lastUpdatedTurnId: null,
			pipeline_id: null,
			status: 'searching'
		};
	}
	
	// Local campaign state that can be updated immediately after search
	let localCampaign = $state<SerializedCampaign | null>(null);
	const effectiveCampaign = $derived((localCampaign ?? campaign) ?? createCampaignFallback(routeCampaignId));

	let activeTab = $state<'chat' | 'outreach'>('chat');
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
	let search = $state<{ status: 'idle' | 'pending' | 'complete' | 'error' | 'needs_config'; lastError?: string | null; results?: unknown }>({ status: 'idle' });
	let keywords = $state<string[]>([]);
	let followerRange = $state<{ min: number | null; max: number | null }>({ min: null, max: null });
	let isInitializing = $state(true);
	let isSending = $state(false);
	let initError = $state<string | null>(null);
	let openSourcesMessageId = $state<string | null>(null);
	const textDecoder = new TextDecoder();
	let messagesContainer: HTMLDivElement | null = $state(null);
	
	// Outreach tab state
	let searchUsage = $state<{ count: number; limit: number; remaining: number; resetDate: number } | null>(null);
	let searchQuery = $state('');
	let searchTopN = $state(30);
	let searchMinFollowers = $state<number | null>(null);
	let searchMaxFollowers = $state<number | null>(null);
	let isSearching = $state(false);
	let searchError = $state<string | null>(null);
	let searchResult = $state<{ job_id: string; profiles_count: number; profiles_storage_url: string | null } | null>(null);
	
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

	function toggleSources(messageId: string) {
		openSourcesMessageId = openSourcesMessageId === messageId ? null : messageId;
	}

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
				search = { status: 'idle' };
				keywords = [];
				followerRange = { min: null, max: null };
				isInitializing = true;
				initError = null;
				openSourcesMessageId = null;
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
		
		// Initial load is handled by $effect above, but keep this as fallback
		if (activeTab === 'chat' && campaign?.id && !campaignId) {
			void loadConversation(campaign.id);
		}
		// Load search usage when component mounts
		void loadSearchUsage();
		
		// Load pipeline status if pipeline_id exists
		if (effectiveCampaign?.pipeline_id) {
			void loadPipelineStatus(effectiveCampaign.pipeline_id);
		}
		
		// Set up real-time listener for campaign document to sync pipeline_id updates
		let unsubscribeCampaign: (() => void) | null = null;
		const setupCampaignListener = () => {
			const currentUser = firebaseAuth.currentUser;
			const campaignId = routeCampaignId();
			
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
					
					// Update localCampaign with the latest pipeline_id from Firestore
					// Only update if pipeline_id changed or wasn't set before
					const currentPipelineId = localCampaign?.pipeline_id ?? campaign?.pipeline_id ?? null;
					
					if (updatedPipelineId !== currentPipelineId && updatedPipelineId) {
						// Preserve existing localCampaign state, only update pipeline_id
						localCampaign = {
							...(localCampaign ?? campaign),
							pipeline_id: updatedPipelineId
						};
						
						console.log('[campaign] Pipeline ID synced from Firestore:', updatedPipelineId);
						
						// If we're on the outreach tab and pipeline_id was just set, load status and start polling
						if (activeTab === 'outreach' && updatedPipelineId) {
							void loadPipelineStatus(updatedPipelineId);
							startPipelinePolling(updatedPipelineId);
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
	
	// Update search form when campaign data loads
	$effect(() => {
		if (campaign?.influencerSearchQuery) {
			searchQuery = campaign.influencerSearchQuery;
		}
		if (campaign?.followersMin !== null && campaign.followersMin !== undefined) {
			searchMinFollowers = campaign.followersMin;
		}
		if (campaign?.followersMax !== null && campaign.followersMax !== undefined) {
			searchMaxFollowers = campaign.followersMax;
		}
	});
	
	// Update max influencers based on remaining searches
	const maxInfluencers = $derived(() => {
		if (!searchUsage) return 100; // Default max if usage not loaded
		return Math.min(searchUsage.remaining, 100); // Cap at 100 or remaining, whichever is lower
	});
	
	async function handleSearchSubmit(event: Event) {
		event.preventDefault();
		if (isSearching || !searchQuery.trim()) return;
		
		isSearching = true;
		searchError = null;
		searchResult = null;
		
		try {
			const response = await fetch('/api/search/influencers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					business_description: searchQuery.trim(),
					top_n: searchTopN,
					min_followers: searchMinFollowers,
					max_followers: searchMaxFollowers,
					campaign_id: campaign?.id ?? routeCampaignId ?? null
				})
			});
			
			if (!response.ok) {
				const errorData = await response.json().catch(() => ({ message: 'Search failed' }));
				throw new Error(errorData.message || `Search failed: ${response.status}`);
			}
			
			const responseData = await response.json();
			// Handle potential wrapper - check if response is wrapped in 'data' property
			const data = responseData.data ?? responseData;
			
			console.log('[campaign] Search response received:', { 
				job_id: data.job_id, 
				hasCampaign: !!campaign,
				campaignId: campaign?.id 
			});
			
			searchResult = {
				job_id: data.job_id,
				profiles_count: data.profiles_count ?? 0,
				profiles_storage_url: data.profiles_storage_url ?? null
			};
			
			// Update search usage
			if (data.usage) {
				searchUsage = data.usage;
			}
			
			// Update local campaign with pipeline_id immediately
			if (data.job_id) {
				const baseCampaign = campaign ?? localCampaign ?? createCampaignFallback(routeCampaignId);
				localCampaign = {
					...baseCampaign,
					pipeline_id: data.job_id,
					updatedAt: Date.now()
				};
				console.log('[campaign] Updated localCampaign with pipeline_id:', data.job_id);
				
				// Load pipeline status and start polling immediately
				await loadPipelineStatus(data.job_id);
				startPipelinePolling(data.job_id);
			} else {
				console.error('[campaign] No job_id in search response:', data);
			}
		} catch (error) {
			searchError = error instanceof Error ? error.message : 'An unexpected error occurred';
		} finally {
			isSearching = false;
		}
	}
	
	// Generate a unique ID for a profile based on its properties
	function getProfileId(profile: { profile_url?: string; display_name?: string; platform?: string; followers?: number; _id?: string }): string {
		// Use existing _id if available
		if (profile._id) {
			return profile._id;
		}
		// Use profile_url if available, otherwise create a composite key
		if (profile.profile_url) {
			return profile.profile_url;
		}
		return `${profile.platform ?? 'unknown'}_${profile.display_name ?? 'unknown'}_${profile.followers ?? 0}`;
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
		
		// Poll every 3 seconds - continue polling even if completed to catch any late updates
		pipelinePollInterval = setInterval(async () => {
			// Only poll if we're still on the outreach tab
			if (activeTab === 'outreach') {
				await loadPipelineStatus(pipelineId);
				
				// Stop polling if pipeline is completed, error, or cancelled (but allow a few polls after completion to catch final updates)
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
		
		// Clear existing polling when effect runs
		if (pipelinePollInterval) {
			clearInterval(pipelinePollInterval);
			pipelinePollInterval = null;
		}
		
		// Start loading and polling if on outreach tab and pipeline exists
		if (pipelineId && activeTab === 'outreach') {
			// Load immediately when switching to outreach tab
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
	$effect(() => {
		if (campaign && !localCampaign) {
			localCampaign = campaign;
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
		search = data.conversation.search ?? { status: 'idle' };
		keywords = data.conversation.keywords ?? [];
		followerRange = data.conversation.followerRange ?? { min: null, max: null };
		openSourcesMessageId = null;
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!campaignId || isSending) return;
		const value = draft.trim();
		if (!value) return;

		isSending = true;
		const optimisticId = crypto.randomUUID();
		messages = [
			...messages,
			{
				id: optimisticId,
				role: 'user',
				content: value,
				type: 'text',
				createdAt: new Date().toISOString()
			}
		];
		draft = '';

		try {
			await sendStreamingMessage(value);
		} catch (error) {
			console.error('[campaign] message submit failed', error);
			messages = messages.filter((message) => message.id !== optimisticId);
			messages = [
				...messages,
				{
					id: crypto.randomUUID(),
					role: 'assistant',
					content: 'I hit a snag sending that. Please try again.',
					type: 'text',
					createdAt: new Date().toISOString()
				}
			];
		} finally {
			isSending = false;
		}
	}

	async function sendStreamingMessage(value: string) {
		if (!campaignId) throw new Error('Campaign not initialized');
		const response = await fetch(`/api/chat/${campaignId}/stream`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ message: value })
		});

		if (!response.ok || !response.body) {
			const errorText = await response.text();
			throw new Error(errorText || `Assistant error (${response.status})`);
		}

		const reader = response.body.getReader();
		const placeholderId = crypto.randomUUID();
		let buffer = '';
		let assistantBuffer = '';
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
				// Remove placeholder before applying snapshot to avoid duplicates
				if (hasPlaceholder) {
					removeMessageById(placeholderId);
					hasPlaceholder = false;
				}
				applyConversationSnapshot({ conversation: payload.conversation } as ConversationResponse);
				// Scroll after applying snapshot
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

		try {
			while (true) {
				const { value: chunk, done } = await reader.read();
				if (done) break;
				buffer += textDecoder.decode(chunk, { stream: true });
				parseBuffer();
			}
			buffer += textDecoder.decode();
			parseBuffer();
	} finally {
		reader.releaseLock();
	}

	// Clean up placeholder if it still exists (shouldn't happen if final event was processed)
	if (hasPlaceholder) {
		removeMessageById(placeholderId);
	}
}

	const numberFormatter = new Intl.NumberFormat('en-US');

	function formatFollowerRange(range: { min: number | null; max: number | null }) {
		if (!range) return '—';
		const { min, max } = range;
		const formatValue = (value: number) => numberFormatter.format(Math.round(value));
		if (typeof min === 'number' && typeof max === 'number') {
			return `${formatValue(min)} – ${formatValue(max)}`;
		}
		if (typeof min === 'number') {
			return `${formatValue(min)}+`;
		}
		if (typeof max === 'number') {
			return `Up to ${formatValue(max)}`;
		}
		return '—';
	}

	// Calculate progress based on collected campaign data
	// Matches the logic in chat-assistant.ts getConversation() missing field determination:
	// - A field is collected if it's not null (including "N/A" which counts as collected)
	// - locations is missing if: influencer_location === null && influencerTypes === null
	// - influencerTypes is missing if: influencerTypes === null && influencer_location === null
	const progress = $derived(() => {
		const requiredFields = ['website', 'business_location', 'business_about', 'locations', 'influencerTypes', 'followers'];
		let collectedCount = 0;
		
		// Check website - collected if not null (including "N/A")
		if (collected.website !== null && collected.website !== undefined) collectedCount++;
		
		// Check business_location - collected if not null (including "N/A")
		if (collected.business_location !== null && collected.business_location !== undefined) collectedCount++;
		
		// Check business_about - collected if not null (including "N/A")
		if (collected.business_about !== null && collected.business_about !== undefined) collectedCount++;
		
		// Check locations - satisfied if influencer_location OR influencerTypes is not null
		// (collected.locations maps to influencer_location from Firestore)
		if ((collected.locations !== null && collected.locations !== undefined) || 
		    (collected.influencerTypes !== null && collected.influencerTypes !== undefined)) {
			collectedCount++;
		}
		
		// Check influencerTypes - satisfied if influencerTypes OR influencer_location is not null
		if ((collected.influencerTypes !== null && collected.influencerTypes !== undefined) || 
		    (collected.locations !== null && collected.locations !== undefined)) {
			collectedCount++;
		}
		
		// Check followers - from ChatCollectedData.min_followers/max_followers
		if (followerRange.min !== null || followerRange.max !== null) collectedCount++;
		
		return Math.round((collectedCount / requiredFields.length) * 100);
	});
</script>

<svelte:head>
	<title>{campaign?.title ?? 'Campaign'} – Penni AI</title>
</svelte:head>

<div class="flex h-full flex-col">
	<!-- Tab Navigation -->
	<div class="border-b border-gray-200 bg-white px-8 pt-6">
		<div class="flex gap-1">
			<button
				type="button"
				onclick={() => {
					activeTab = 'chat';
					// Always load conversation when clicking chat tab
					if (campaign?.id) {
						if (!campaignId || isInitializing) {
							void loadConversation(campaign.id);
						}
					}
				}}
				class={`px-4 py-2 text-sm font-medium transition ${
					activeTab === 'chat'
						? 'border-b-2 border-[#FF6F61] text-gray-900'
						: 'text-gray-500 hover:text-gray-700'
				}`}
			>
				Chat
			</button>
			{#if hasUserMessages()}
				<button
					type="button"
					onclick={() => {
						activeTab = 'outreach';
						// Ensure pipeline status loads when clicking outreach tab
						if (effectiveCampaign?.pipeline_id) {
							void loadPipelineStatus(effectiveCampaign.pipeline_id);
							startPipelinePolling(effectiveCampaign.pipeline_id);
						}
					}}
					class={`px-4 py-2 text-sm font-medium transition ${
						activeTab === 'outreach'
							? 'border-b-2 border-[#FF6F61] text-gray-900'
							: 'text-gray-500 hover:text-gray-700'
					}`}
				>
					Outreach
				</button>
			{/if}
		</div>
	</div>

	<!-- Tab Content -->
	<div class="flex-1 overflow-hidden">
			{#if activeTab === 'chat'}
			<!-- Chat Tab -->
			<div class="flex h-full flex-col">
				<div class="flex-1 overflow-y-auto px-8 py-10" bind:this={messagesContainer}>
					<div class="mx-auto flex w-full max-w-3xl flex-col gap-6">
						{#if isInitializing}
							<div class="flex justify-center py-12 text-gray-500">Loading conversation…</div>
						{:else if initError}
							<div class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
								<p class="font-semibold">We couldn't load the conversation.</p>
								<p class="text-sm">{initError}</p>
								<button
									class="mt-4 text-sm font-medium text-red-700 underline"
									onclick={() => campaign?.id && void loadConversation(campaign.id)}
								>
									Try again
								</button>
							</div>
						{:else}
							{#each messages as message}
								{#if message.type === 'intro'}
									<div class="mx-auto mt-12 flex flex-col items-center text-center gap-4">
										<span class="flex h-12 w-12 items-center justify-center rounded-full bg-[#FFF1ED] text-2xl">👋</span>
										<p class="max-w-xl text-lg leading-relaxed text-gray-800">{message.content}</p>
									</div>
								{:else if message.role === 'assistant'}
									<div class="flex flex-col gap-1">
										<p class="text-xs font-medium text-gray-500 ml-14">Penni AI</p>
										<div class="flex items-start gap-3">
											<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full overflow-hidden">
												<img
													src="/images/branding/white%20icon%20with%20pink%20SVG.svg"
													alt="Penny assistant"
													class="h-full w-full object-contain"
												/>
											</div>
											<div class="max-w-xl rounded-3xl bg-white px-5 py-4 text-sm text-gray-800 shadow-sm">
												<p class="whitespace-pre-line leading-relaxed">{message.content}</p>
												{#if message.sources && message.sources.length}
													<div class="mt-3 space-y-2">
														<button
															type="button"
															class="flex items-center gap-2 text-xs font-medium text-gray-400 hover:text-gray-600"
															onclick={() => toggleSources(message.id)}
															aria-expanded={openSourcesMessageId === message.id}
															aria-controls={`sources-${message.id}`}
														>
															<span aria-hidden="true">❝</span>
															<span>View sources</span>
														</button>
														{#if openSourcesMessageId === message.id}
															<div id={`sources-${message.id}`} class="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 shadow-sm">
																<p class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Referenced pages</p>
																<ul class="mt-2 space-y-1">
																	{#each message.sources.slice(0, 3) as source}
																		<li>
																			<a href={source.url} target="_blank" rel="noreferrer" class="text-gray-900 hover:text-[#FF6F61]">
																				{source.title ?? source.url}
																			</a>
																			{#if source.query}
																				<span class="ml-1 text-gray-400">({source.query})</span>
																			{/if}
																		</li>
																	{/each}
																</ul>
															</div>
														{/if}
													</div>
												{/if}
											</div>
										</div>
									</div>
								{:else}
									<div class="flex flex-col items-end gap-1">
										<p class="text-xs font-medium text-gray-500 mr-4">You</p>
										<div class="flex justify-end">
											<div class="max-w-xl rounded-3xl bg-gray-900 px-5 py-4 text-sm text-white">
												<p class="leading-relaxed">{message.content}</p>
											</div>
										</div>
									</div>
								{/if}
							{/each}

							{#if isSending}
								<div class="flex flex-col gap-1">
									<p class="text-xs font-medium text-gray-500 ml-14">Penni AI</p>
									<div class="flex items-start gap-3">
										<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full overflow-hidden">
											<img
												src="/images/branding/white%20icon%20with%20pink%20SVG.svg"
												alt="Penny assistant"
												class="h-full w-full object-contain"
											/>
										</div>
										<div class="rounded-3xl bg-white px-4 py-2 shadow-sm">
											<span class="flex items-center gap-1">
												<span class="h-2 w-2 animate-pulse rounded-full bg-gray-400"></span>
												<span class="h-2 w-2 animate-pulse rounded-full bg-gray-300" style="animation-delay: 120ms;"></span>
												<span class="h-2 w-2 animate-pulse rounded-full bg-gray-200" style="animation-delay: 240ms;"></span>
											</span>
										</div>
									</div>
								</div>
							{/if}
						{/if}
					</div>
				</div>

				<!-- Progress Bar -->
				{#if activeTab === 'chat' && !isInitializing && campaignId}
					<div class="border-t border-gray-200 bg-white px-6 py-3">
						<div class="mx-auto w-full max-w-3xl">
							<div class="mb-1 flex items-center justify-between text-xs">
								<span class="font-medium text-gray-600">Campaign Setup Progress</span>
								<span class="text-gray-500">{progress()}%</span>
							</div>
							<div class="h-2 w-full overflow-hidden rounded-full bg-gray-100">
								<div
									class="h-full bg-[#FF6F61] transition-all duration-300 ease-out"
									style="width: {progress()}%"
								></div>
							</div>
						</div>
					</div>
				{/if}

				<div class="border-t border-gray-200 bg-white px-6 py-5">
					<form class="mx-auto flex w-full max-w-3xl items-center gap-3" onsubmit={handleSubmit}>
						<input
							type="text"
							class="flex-1 rounded-full border border-gray-300 px-5 py-3 text-sm shadow-sm focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10"
							placeholder="Type your reply..."
							bind:value={draft}
							autocomplete="off"
							disabled={isInitializing || !campaignId}
						/>
						<Button type="submit" variant="primary" size="md" disabled={draft.trim().length === 0 || isInitializing || !campaignId}>
							Send
						</Button>
					</form>
				</div>
			</div>
		{:else}
			<!-- Outreach Tab -->
			<div class="flex h-full flex-col overflow-y-auto px-8 py-6">
				{#if effectiveCampaign?.pipeline_id && pipelineStatus}
					<!-- Pipeline Status View -->
					<div class="mx-auto w-full max-w-6xl space-y-6">
						<div>
							<h2 class="text-2xl font-semibold text-gray-900">Influencer Search</h2>
							<p class="mt-1 text-sm text-gray-500">
								Pipeline Status: <span class="font-medium capitalize text-gray-900">{pipelineStatus.status}</span>
								{#if pipelineStatus.status === 'running'}
									<span class="ml-2 inline-flex items-center gap-1">
										<span class="h-2 w-2 animate-pulse rounded-full bg-green-500"></span>
										<span class="text-xs text-gray-500">Processing...</span>
									</span>
								{/if}
							</p>
						</div>
						
						<!-- Pipeline Progress -->
						<div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
							<div class="mb-4">
								<div class="mb-2 flex items-center justify-between text-sm">
									<span class="font-medium text-gray-700">Overall Progress</span>
									<span class="text-gray-500">{pipelineStatus.overall_progress}%</span>
								</div>
								<div class="h-3 w-full overflow-hidden rounded-full bg-gray-100">
									<div
										class="h-full bg-[#FF6F61] transition-all duration-300"
										style="width: {pipelineStatus.overall_progress}%"
									></div>
								</div>
							</div>
							
							<!-- Stage Status -->
							<div class="grid grid-cols-2 gap-4 text-sm">
								<div class="rounded-lg border border-gray-200 p-3">
									<div class="flex items-center justify-between">
										<span class="text-gray-600">Query Expansion</span>
										<span class="font-medium capitalize text-gray-900">{pipelineStatus.stages.query_expansion?.status ?? 'pending'}</span>
									</div>
									{#if pipelineStatus.stages.query_expansion?.queries}
										<p class="mt-1 text-xs text-gray-500">{pipelineStatus.stages.query_expansion.queries.length} queries generated</p>
									{/if}
								</div>
								<div class="rounded-lg border border-gray-200 p-3">
									<div class="flex items-center justify-between">
										<span class="text-gray-600">Weaviate Search</span>
										<span class="font-medium capitalize text-gray-900">{pipelineStatus.stages.weaviate_search?.status ?? 'pending'}</span>
									</div>
									{#if pipelineStatus.stages.weaviate_search?.deduplicated_results}
										<p class="mt-1 text-xs text-gray-500">{pipelineStatus.stages.weaviate_search.deduplicated_results} unique profiles</p>
									{/if}
								</div>
								<div class="rounded-lg border border-gray-200 p-3">
									<div class="flex items-center justify-between">
										<span class="text-gray-600">BrightData Collection</span>
										<span class="font-medium capitalize text-gray-900">{pipelineStatus.stages.brightdata_collection?.status ?? 'pending'}</span>
									</div>
									{#if pipelineStatus.stages.brightdata_collection}
										<p class="mt-1 text-xs text-gray-500">
											{pipelineStatus.stages.brightdata_collection.profiles_collected ?? 0} collected
											{#if pipelineStatus.stages.brightdata_collection.total_batches}
												({pipelineStatus.stages.brightdata_collection.batches_completed ?? 0}/{pipelineStatus.stages.brightdata_collection.total_batches} batches)
											{/if}
										</p>
									{/if}
								</div>
								<div class="rounded-lg border border-gray-200 p-3">
									<div class="flex items-center justify-between">
										<span class="text-gray-600">LLM Analysis</span>
										<span class="font-medium capitalize text-gray-900">{pipelineStatus.stages.llm_analysis?.status ?? 'pending'}</span>
									</div>
									{#if pipelineStatus.stages.llm_analysis?.profiles_analyzed}
										<p class="mt-1 text-xs text-gray-500">{pipelineStatus.stages.llm_analysis.profiles_analyzed} analyzed</p>
									{/if}
								</div>
							</div>
							
							{#if pipelineStatus.error_message}
								<div class="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
									<strong>Error:</strong> {pipelineStatus.error_message}
								</div>
							{/if}
						</div>
						
						<!-- Influencers Table -->
						{#if pipelineStatus.status === 'running' || pipelineStatus.status === 'completed' || pipelineStatus.status === 'pending'}
							<div class="rounded-2xl border border-gray-200 bg-white shadow-sm">
								<div class="border-b border-gray-200 px-6 py-4">
									<h3 class="text-lg font-semibold text-gray-900">
										Influencers
										{#if pipelineStatus.profiles && pipelineStatus.profiles.length > 0}
											<span class="text-base font-normal text-gray-500">({pipelineStatus.profiles.length})</span>
										{:else if pipelineStatus.profiles_count}
											<span class="text-base font-normal text-gray-500">({pipelineStatus.profiles_count} expected)</span>
										{/if}
									</h3>
								</div>
								
								{#if pipelineStatus.profiles && pipelineStatus.profiles.length > 0}
									<div class="overflow-x-auto">
										<table class="w-full">
											<thead class="border-b border-gray-200 bg-gray-50">
												<tr>
													<th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
													<th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Platform</th>
													<th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Followers</th>
													<th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Fit Score</th>
													<th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Rationale</th>
												</tr>
											</thead>
											<tbody class="divide-y divide-gray-200 bg-white">
												{#each pipelineStatus.profiles as profile (profile._id || getProfileId(profile))}
													{@const profileId = profile._id || getProfileId(profile)}
													{@const isNewProfile = !previousProfileIds.has(profileId)}
													<tr 
														class="hover:bg-gray-50 transition-colors"
														in:fly={{ y: -20, duration: 400, opacity: 0 }}
													>
														<td class="whitespace-nowrap px-6 py-4">
															<div class="flex items-center">
																{#if profile.profile_url}
																	<a href={profile.profile_url} target="_blank" rel="noopener noreferrer" class="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline">
																		{profile.display_name ?? 'N/A'}
																	</a>
																{:else}
																	<div class="text-sm font-medium text-gray-900">
																		{profile.display_name ?? 'N/A'}
																	</div>
																{/if}
															</div>
														</td>
														<td class="whitespace-nowrap px-6 py-4 text-sm text-gray-500 capitalize">
															{profile.platform ?? 'N/A'}
														</td>
														<td class="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
															{profile.followers ? profile.followers.toLocaleString() : 'N/A'}
														</td>
														<td class="whitespace-nowrap px-6 py-4">
															{#if profile.fit_score !== undefined && profile.fit_score !== null}
																<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {
																	profile.fit_score >= 8 ? 'bg-green-100 text-green-800' :
																	profile.fit_score >= 6 ? 'bg-yellow-100 text-yellow-800' :
																	'bg-red-100 text-red-800'
																}">
																	{profile.fit_score}/10
																</span>
															{:else}
																<span class="text-sm text-gray-400">—</span>
															{/if}
														</td>
														<td class="px-6 py-4 text-sm text-gray-500 max-w-md">
															<div class="line-clamp-2">{profile.fit_rationale ?? '—'}</div>
														</td>
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
								{:else}
									<div class="px-6 py-12 text-center">
										{#if pipelineStatus.status === 'running' || pipelineStatus.status === 'pending'}
											<div class="flex flex-col items-center gap-3">
												<div class="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#FF6F61]"></div>
												<p class="text-sm font-medium text-gray-900">Processing influencers...</p>
												<p class="text-xs text-gray-500">
													{#if pipelineStatus.stages.brightdata_collection?.profiles_collected}
														{pipelineStatus.stages.brightdata_collection.profiles_collected} profiles collected so far
													{:else}
														Influencers will appear here as they are processed
													{/if}
												</p>
											</div>
										{:else if pipelineStatus.status === 'completed'}
											<p class="text-sm text-gray-500">No influencers found. Try adjusting your search criteria.</p>
										{:else}
											<p class="text-sm text-gray-500">No influencers available yet.</p>
										{/if}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{:else}
					<!-- Search Form View (No Pipeline Started) -->
					<div class="mx-auto w-full max-w-3xl space-y-6">
						<div>
							<h2 class="text-2xl font-semibold text-gray-900">Find Influencers</h2>
							<p class="mt-1 text-sm text-gray-500">
								Search for influencers matching your campaign criteria.
								{#if searchUsage}
									You have <span class="font-medium text-gray-900">{searchUsage.remaining}</span> searches remaining this month (out of {searchUsage.limit}).
								{/if}
							</p>
						</div>
						
						<form onsubmit={handleSearchSubmit} class="space-y-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
							<!-- Search Query -->
							<div>
								<label for="search-query" class="block text-sm font-medium text-gray-700 mb-2">
									Business & Influencer Description
								</label>
								<textarea
									id="search-query"
									bind:value={searchQuery}
									rows="4"
									class="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm shadow-sm focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10"
									placeholder="Describe your business and what types of influencers you're looking for..."
									required
									disabled={isSearching}
								></textarea>
								<p class="mt-1 text-xs text-gray-500">This will be used to search for matching influencers.</p>
							</div>
							
							<!-- Number of Influencers -->
							<div>
								<label for="search-top-n" class="block text-sm font-medium text-gray-700 mb-2">
									Number of Influencers
								</label>
								<input
									type="number"
									id="search-top-n"
									bind:value={searchTopN}
									min="30"
									max={maxInfluencers()}
									class="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm shadow-sm focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10"
									required
									disabled={isSearching}
								/>
								<p class="mt-1 text-xs text-gray-500">
									Minimum: 30, Maximum: {maxInfluencers()} (based on your remaining searches)
								</p>
							</div>
							
							<!-- Follower Range -->
							<div class="grid grid-cols-2 gap-4">
								<div>
									<label for="search-min-followers" class="block text-sm font-medium text-gray-700 mb-2">
										Min Followers
									</label>
									<input
										type="number"
										id="search-min-followers"
										bind:value={searchMinFollowers}
										min="0"
										step="1000"
										class="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm shadow-sm focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10"
										placeholder="e.g., 10000"
										disabled={isSearching}
									/>
								</div>
								<div>
									<label for="search-max-followers" class="block text-sm font-medium text-gray-700 mb-2">
										Max Followers
									</label>
									<input
										type="number"
										id="search-max-followers"
										bind:value={searchMaxFollowers}
										min="0"
										step="1000"
										class="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm shadow-sm focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10"
										placeholder="e.g., 1000000"
										disabled={isSearching}
									/>
								</div>
							</div>
							
							<!-- Error Message -->
							{#if searchError}
								<div class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
									{searchError}
								</div>
							{/if}
							
							<!-- Success Message -->
							{#if searchResult}
								<div class="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
									<p class="font-medium">Search completed successfully!</p>
									<p class="mt-1">Found {searchResult.profiles_count} influencers. Job ID: {searchResult.job_id}</p>
									{#if searchResult.profiles_storage_url}
										<a href={searchResult.profiles_storage_url} target="_blank" rel="noopener noreferrer" class="mt-2 inline-block text-sm underline">
											View results
										</a>
									{/if}
								</div>
							{/if}
							
							<!-- Submit Button -->
							<Button
								type="submit"
								variant="primary"
								size="md"
								disabled={isSearching || !searchQuery.trim() || searchTopN < 30 || searchTopN > maxInfluencers()}
								class="w-full justify-center"
							>
								{#if isSearching}
									Searching...
								{:else}
									Search for Influencers
								{/if}
							</Button>
						</form>
				</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
