<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	
	import EmailEditor from './EmailEditor.svelte';
	import EmailPreview from './EmailPreview.svelte';
	import MessagePreview from './MessagePreview.svelte';
	import Button from './Button.svelte';
	import SendOutreachSequenceRenderer from './outreach/SendOutreachSequenceRenderer.svelte';
	import SendOutreachPopupPanel from './outreach/SendOutreachPopupPanel.svelte';
	import type { SendOutreachSequenceProps } from './outreach/types';
	
	// Template variable replacement (client-side)
	function replaceTemplateVariables(content: string, variables: { influencer_name?: string }): string {
		let processed = content;
		processed = processed.replace(/\{\{influencer_name\}\}/g, variables.influencer_name || 'there');
		return processed;
	}
	
	// Check for square bracket placeholders in content (NOT template variables like {{influencer_name}})
	function checkPlaceholders(content: string): { hasUnfilled: boolean; placeholders: string[] } {
		if (!content || content.trim() === '' || content === '<p></p>') {
			return { hasUnfilled: false, placeholders: [] };
		}
		
		// Extract square bracket placeholders (pattern: [Your Name], [Your Position], etc.)
		// Common ChatGPT-generated placeholders that need to be filled in
		// Template variables like {{influencer_name}} are allowed and should NOT be blocked
		const bracketPattern = /\[([^\]]+)\]/g;
		const bracketMatches = Array.from(content.matchAll(bracketPattern));
		const placeholders = bracketMatches.map(match => `[${match[1]}]`).filter((v, i, arr) => arr.indexOf(v) === i);
		
		return {
			hasUnfilled: placeholders.length > 0,
			placeholders
		};
	}
	
	// Helper function to update message content (always saves, no blocking)
	function updateMessageContent(platform: ContactMethod, content: string) {
		messageContents[platform] = content;
		
		// Update validation errors in real-time for button error icons
		// Check if this platform is being used (has selected methods)
		const isPlatformUsed = Array.from(selectedMethods.values()).some(methods => methods.has(platform));
		if (isPlatformUsed && content && content.trim() && content !== '<p></p>') {
			const check = checkPlaceholders(content);
			navigationValidationErrors[platform] = check.placeholders;
		} else {
			navigationValidationErrors[platform] = [];
		}
		
		// Always save - validation happens on navigation, not on every keystroke
		saveOutreachState(false);
	}
	
	// Track validation errors when trying to navigate
	let navigationValidationErrors = $state<Record<ContactMethod, string[]>>({
		email: [],
		instagram: [],
		tiktok: []
	});
	
	interface Influencer {
		_id?: string;
		display_name?: string;
		platform?: string;
		email_address?: string;
		business_email?: string;
		profile_url?: string;
		biography?: string;
		bio?: string;
	}
	
	interface Props {
		open: boolean;
		influencers: Influencer[];
		campaignId?: string | null;
		onClose: () => void;
		embedded?: boolean; // If true, render as embedded component instead of modal
		showNotReadyMessage?: boolean; // If true, show message that campaign isn't ready
	}
	
	let { open, influencers, campaignId, onClose, embedded = false, showNotReadyMessage = false }: Props = $props();
	
	type ContactMethod = 'email' | 'instagram' | 'tiktok';
	type Stage = 'select-methods' | 'draft-messages' | 'review-info' | 'review';
	
	let currentStage = $state<Stage>('select-methods');
	
	// Track selected contact methods for each influencer
	// Map: influencerKey -> Set of selected methods
	let selectedMethods = $state<Map<string, Set<ContactMethod>>>(new Map());
	
	// Message content for each platform
	let messageContents = $state<Record<ContactMethod, string>>({
		email: '',
		instagram: '',
		tiktok: ''
	});
	
	// Currently editing platform in draft stage
	let editingPlatform = $state<ContactMethod | null>(null);
	
	// Draft with ChatGPT modal state
	let draftModalOpen = $state(false);
	let draftTone = $state<'friendly' | 'business'>('business');
	let isDrafting = $state(false);
	let draftError = $state<string | null>(null);
	let isQuickDrafting = $state(false);
	let quickDraftError = $state<string | null>(null);
	let campaignData = $state<{
		title?: string | null;
		website?: string | null;
		businessSummary?: string | null;
		business_location?: string | null;
		type_of_influencer?: string | null;
		locations?: string | null;
		platform?: string | null;
		followersMin?: number | null;
		followersMax?: number | null;
	} | null>(null);
	let isLoadingCampaignData = $state(false);
	
	// Footer customization modal state
	let footerModalOpen = $state(false);
	let emailFooter = $state<string>('');
	let isFooterLoading = $state(false);
	let isFooterSaving = $state(false);
	let footerError = $state<string | null>(null);
	
	// Email preview state
	let previewEmailContent = $state<string | null>(null);
	let previewRecipient = $state<{ name?: string; email?: string } | null>(null);
	
	// Instagram/TikTok preview state
	let previewMessageContent = $state<string | null>(null);
	let previewMessagePlatform = $state<'instagram' | 'tiktok' | null>(null);
	let previewMessageRecipient = $state<{ name?: string } | null>(null);
	
	// Gmail connection warning popup state
	let showGmailWarningPopup = $state(false);
	
	interface GmailConnectionView {
		id: string;
		email: string;
		primary: boolean;
		connectedAt: number | null;
		lastRefreshedAt: number | null;
		accountType?: 'draft' | 'send';
	}

	let gmailConnections = $state<GmailConnectionView[]>([]);
	let selectedGmailConnectionId = $state<string | null>(null);
	// Track selected email account per influencer: influencerKey -> connectionId
	let selectedEmailAccounts = $state<Map<string, string>>(new Map());
	let isLoadingGmailStatus = $state(false);
	const gmailConnected = $derived(gmailConnections.length > 0);
	
	// Track if we've initialized defaults to prevent infinite loops
	let hasInitializedDefaults = $state(false);
	let hasLoadedState = $state(false);
	
	// State persistence
	let isSaving = $state(false);
	let isSavingDebounced = $state(false);
	let saveSuccess = $state(false);
	let saveError = $state<string | null>(null);
	let stateRestored = $state(false);
	
	// Debounce timer for auto-save
	let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	
	// Conversion utilities: Map<key, Set<method>> ↔ Record<key, method[]>
	function mapToRecord(map: Map<string, Set<ContactMethod>>): Record<string, string[]> {
		const record: Record<string, string[]> = {};
		map.forEach((methods, key) => {
			record[key] = Array.from(methods);
		});
		return record;
	}
	
	function recordToMap(record: Record<string, string[]>): Map<string, Set<ContactMethod>> {
		const map = new Map<string, Set<ContactMethod>>();
		Object.entries(record).forEach(([key, methods]) => {
			map.set(key, new Set(methods as ContactMethod[]));
		});
		return map;
	}
	
	// Load contacted influencers to filter selections
	let contactedInfluencerIds = $state<Set<string>>(new Set());
	
	async function loadContactedInfluencers() {
		if (!campaignId) return;
		
		try {
			const response = await fetch(`/api/outreach/contacts/${campaignId}`);
			if (response.ok) {
				const data = await response.json();
				if (data.contactedInfluencerIds && Array.isArray(data.contactedInfluencerIds)) {
					contactedInfluencerIds = new Set(data.contactedInfluencerIds);
				}
			}
		} catch (error) {
			console.error('Failed to load contacted influencers:', error);
		}
	}
	
	// Load outreach state from Firestore
	async function loadOutreachState() {
		if (!campaignId || hasLoadedState) return;
		
		// Load contacted influencers first to filter selections
		await loadContactedInfluencers();
		
		try {
			const response = await fetch(`/api/outreach/state/${campaignId}`);
			if (!response.ok) {
				// No saved state or error - that's okay
				return;
			}
			
			const data = await response.json();
			if (data.state) {
				const state = data.state;
				
				// Restore selected methods (filter out non-existent influencers and contacted ones)
				const restoredMethods = recordToMap(state.selectedMethods);
				const validMethods = new Map<string, Set<ContactMethod>>();
				restoredMethods.forEach((methods, key) => {
					// Only restore if influencer still exists and hasn't been contacted
					if (influencers.some(inf => getInfluencerKey(inf) === key) && !contactedInfluencerIds.has(key)) {
						validMethods.set(key, methods);
					}
				});
				selectedMethods = validMethods;
				
				// Restore message contents
				if (state.messageContents) {
					messageContents = {
						email: state.messageContents.email || '',
						instagram: state.messageContents.instagram || '',
						tiktok: state.messageContents.tiktok || ''
					};
				}
				
				// Restore stage
				if (state.currentStage) {
					currentStage = state.currentStage;
				}
				
				// Restore editing platform
				if (state.editingPlatform !== undefined) {
					editingPlatform = state.editingPlatform;
				}
				
				// Restore Gmail connection (validate it still exists)
				if (state.selectedGmailConnectionId) {
					// Will be validated when Gmail connections load
					selectedGmailConnectionId = state.selectedGmailConnectionId;
				}
				
				// Restore selected email accounts per influencer
				if (state.selectedEmailAccounts) {
					const restoredAccounts = new Map<string, string>();
					Object.entries(state.selectedEmailAccounts).forEach(([key, accountId]) => {
						// Only restore if influencer still exists
						if (influencers.some(inf => getInfluencerKey(inf) === key)) {
							restoredAccounts.set(key, accountId as string);
						}
					});
					selectedEmailAccounts = restoredAccounts;
				}
				
				stateRestored = true;
				hasLoadedState = true;
			}
		} catch (error) {
			console.error('Failed to load outreach state:', error);
			// Don't show error to user - just continue without saved state
		}
	}
	
	// Memoize influencer IDs to avoid reactive reads in saveOutreachState
	const influencerIds = $derived(influencers.map(inf => inf._id || getInfluencerKey(inf)));
	
	// Save outreach state to Firestore
	async function saveOutreachState(immediate = false) {
		if (!campaignId) return;
		
		// Clear existing debounce timer
		if (saveDebounceTimer) {
			clearTimeout(saveDebounceTimer);
			saveDebounceTimer = null;
		}
		
		const performSave = async () => {
			isSaving = true;
			isSavingDebounced = false;
			saveError = null;
			
			try {
				// Convert selectedEmailAccounts Map to Record for storage
				const selectedEmailAccountsRecord: Record<string, string> = {};
				selectedEmailAccounts.forEach((accountId, key) => {
					selectedEmailAccountsRecord[key] = accountId;
				});
				
				const state = {
					campaignId,
					currentStage,
					editingPlatform,
					selectedInfluencerIds: influencerIds, // Use memoized value instead of reading prop directly
					selectedMethods: mapToRecord(selectedMethods),
					messageContents,
					selectedGmailConnectionId,
					selectedEmailAccounts: selectedEmailAccountsRecord
				};
				
				const response = await fetch(`/api/outreach/state/${campaignId}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(state)
				});
				
				if (!response.ok) {
					const data = await response.json();
					throw new Error(data.error || 'Failed to save state');
				}
				
				saveSuccess = true;
				setTimeout(() => {
					saveSuccess = false;
				}, 2000);
			} catch (error) {
				saveError = error instanceof Error ? error.message : 'Failed to save state';
				console.error('Failed to save outreach state:', error);
			} finally {
				isSaving = false;
			}
		};
		
		if (immediate) {
			await performSave();
		} else {
			// Debounce saves for message content changes
			isSavingDebounced = true;
			saveDebounceTimer = setTimeout(performSave, 1500);
		}
	}
	
	// Track previous influencers to detect changes (use string for stable comparison)
	let previousInfluencerKeysString = $state<string>('');
	let isResettingStage = $state(false); // Flag to prevent infinite loops
	let hasInitializedInfluencerTracking = $state(false); // Track if we've done initial setup
	
	// Reset stage when influencers change
	$effect(() => {
		// Early return if panel is closed or we're currently resetting
		if (!open) {
			// Reset everything when panel closes
			isResettingStage = false;
			previousInfluencerKeysString = '';
			hasInitializedInfluencerTracking = false;
			return;
		}
		
		// Skip effect if we're currently resetting to prevent loops
		if (isResettingStage) {
			return;
		}
		
		// Get current influencer keys and create a stable string representation
		const currentKeys = influencers.map(inf => getInfluencerKey(inf)).sort();
		const currentKeysString = currentKeys.join(',');
		
		// Initialize tracking on first run (skip initial load)
		if (!hasInitializedInfluencerTracking) {
			previousInfluencerKeysString = currentKeysString;
			hasInitializedInfluencerTracking = true;
			return;
		}
		
		// Check if influencers have changed by comparing strings
		if (currentKeysString !== previousInfluencerKeysString) {
			// Set flag immediately to prevent re-triggering
			isResettingStage = true;
			
			// Update previous keys string immediately to prevent detecting the same change again
			previousInfluencerKeysString = currentKeysString;
			
			// Influencers changed - reset to first stage
			currentStage = 'select-methods';
			editingPlatform = null;
			
			// Create Set for filtering
			const currentKeysSet = new Set(currentKeys);
			
			// Clear selections for influencers that are no longer in the list
			const filteredMethods = new Map<string, Set<ContactMethod>>();
			selectedMethods.forEach((methods, key) => {
				if (currentKeysSet.has(key)) {
					filteredMethods.set(key, methods);
				}
			});
			selectedMethods = filteredMethods;
			
			// Save state after reset (use setTimeout to break the reactive cycle)
			// Clear the flag after a delay to allow any pending effects to complete
			setTimeout(() => {
				saveOutreachState(true).finally(() => {
					// Clear flag after save completes to allow future changes
					isResettingStage = false;
				});
			}, 0);
		}
	});
	
	// Initialize default selections when panel opens (only once per open)
	$effect(() => {
		// Reset when panel closes
		if (!open) {
			if (hasInitializedDefaults) {
				hasInitializedDefaults = false;
				hasLoadedState = false;
				stateRestored = false;
				// Reset influencer tracking
				previousInfluencerKeysString = '';
				hasInitializedInfluencerTracking = false;
				// Save state before closing
				saveOutreachState(true);
			}
			return;
		}
		
		// Load saved state when panel opens
		if (campaignId && !hasLoadedState) {
			loadOutreachState().then(() => {
				// After loading, initialize defaults if no state was restored
				if (!stateRestored && currentStage === 'select-methods' && !hasInitializedDefaults) {
					// Use a timeout to ensure Gmail status has been checked
					setTimeout(() => {
						if (!hasInitializedDefaults && !isLoadingGmailStatus) {
							const newMap = new Map<string, Set<ContactMethod>>();
							const isGmailConnected = gmailConnections.length > 0;
							
							// Set defaults: email if available, otherwise platform
							influencers.forEach(inf => {
								const key = getInfluencerKey(inf);
								const methods = new Set<ContactMethod>();
								const hasEmail = !!(inf.email_address || inf.business_email);
								const platform = inf.platform?.toLowerCase();
								
								if (hasEmail && isGmailConnected) {
									methods.add('email');
								} else if (platform === 'instagram') {
									methods.add('instagram');
								} else if (platform === 'tiktok') {
									methods.add('tiktok');
								}
								
								if (methods.size > 0) {
									newMap.set(key, methods);
								}
							});
							
							selectedMethods = newMap;
							hasInitializedDefaults = true;
							// Save defaults
							if (campaignId) {
								saveOutreachState(true);
							}
						}
					}, 100);
				}
			});
			return; // Wait for state to load
		}
		
		// Initialize defaults only once when panel opens (if no state was restored)
		if (!stateRestored && currentStage === 'select-methods' && !hasInitializedDefaults) {
			// Use a timeout to ensure Gmail status has been checked
			// This breaks the reactive dependency cycle
			const timeoutId = setTimeout(() => {
				if (!hasInitializedDefaults && !isLoadingGmailStatus) {
					const newMap = new Map<string, Set<ContactMethod>>();
					const isGmailConnected = gmailConnections.length > 0;
					
					// Set defaults: email if available, otherwise platform
					influencers.forEach(inf => {
						const key = getInfluencerKey(inf);
						const methods = new Set<ContactMethod>();
						const hasEmail = !!(inf.email_address || inf.business_email);
						const platform = inf.platform?.toLowerCase();
						
						if (hasEmail && isGmailConnected) {
							methods.add('email');
						} else if (platform === 'instagram') {
							methods.add('instagram');
						} else if (platform === 'tiktok') {
							methods.add('tiktok');
						}
						
						if (methods.size > 0) {
							newMap.set(key, methods);
						}
					});
					
					selectedMethods = newMap;
					hasInitializedDefaults = true;
				}
			}, 100);
			
			return () => clearTimeout(timeoutId);
		}
	});
	
	// Check Gmail connection status when panel opens
	$effect(() => {
		if (open) {
			checkGmailStatus();
		}
	});
	
	// Set default Gmail connection
	$effect(() => {
		if (gmailConnected && !selectedGmailConnectionId) {
			const preferred = gmailConnections.find((c) => c.primary) ?? gmailConnections[0];
			selectedGmailConnectionId = preferred ? preferred.id : null;
		}
	});
	
	async function checkGmailStatus() {
		isLoadingGmailStatus = true;
		try {
			const response = await fetch('/api/auth/gmail/status');
			if (response.ok) {
				const data = await response.json();
				const connections: GmailConnectionView[] = Array.isArray(data.connections)
					? data.connections.map((conn: any) => ({
						id: conn.id,
						email: conn.email,
						primary: Boolean(conn.primary),
						connectedAt: conn.connected_at ?? conn.connectedAt ?? null,
						lastRefreshedAt: conn.last_refreshed_at ?? conn.lastRefreshedAt ?? null,
						accountType: conn.accountType || 'send'
					}))
					: [];
				gmailConnections = connections;
				const preferred = connections.find((c) => c.primary) ?? connections[0];
				if (preferred) {
					selectedGmailConnectionId = preferred.id;
				}
			}
		} catch (error) {
			console.error('Failed to check Gmail status:', error);
			gmailConnections = [];
		} finally {
			isLoadingGmailStatus = false;
		}
	}
	
	function handleConnectGmail() {
		window.location.href = '/api/auth/gmail/connect';
	}

	// Generate a stable key for each influencer
	function getInfluencerKey(influencer: Influencer): string {
		return influencer._id || `${influencer.display_name || 'unknown'}-${influencer.platform || 'none'}-${influencer.email_address || influencer.business_email || ''}`;
	}
	
	// Toggle contact method for an influencer
	function toggleMethod(influencerKey: string, method: ContactMethod) {
		// Check if trying to select email without Gmail connected
		if (method === 'email' && !gmailConnected) {
			const current = selectedMethods.get(influencerKey) || new Set<ContactMethod>();
			// Only show popup if email is not already selected (i.e., user is trying to select it)
			if (!current.has('email')) {
				showGmailWarningPopup = true;
				return;
			}
		}
		
		const current = selectedMethods.get(influencerKey) || new Set<ContactMethod>();
		const updated = new Set(current);
		
		if (updated.has(method)) {
			updated.delete(method);
		} else {
			updated.add(method);
		}
		
		// Create new Map to trigger reactivity without causing infinite loops
		const newMap = new Map(selectedMethods);
		if (updated.size === 0) {
			newMap.delete(influencerKey);
		} else {
			newMap.set(influencerKey, updated);
		}
		selectedMethods = newMap;
	}
	
	// Check if method is selected for influencer
	function isMethodSelected(influencerKey: string, method: ContactMethod): boolean {
		return selectedMethods.get(influencerKey)?.has(method) ?? false;
	}
	
	// Get selected email account for an influencer
	function getSelectedEmailAccount(influencerKey: string): string | null {
		return selectedEmailAccounts.get(influencerKey) || null;
	}
	
	// Set email account for an influencer
	function setEmailAccount(influencerKey: string, connectionId: string) {
		const newMap = new Map(selectedEmailAccounts);
		newMap.set(influencerKey, connectionId);
		selectedEmailAccounts = newMap;
		
		// Also ensure email method is selected
		const current = selectedMethods.get(influencerKey) || new Set<ContactMethod>();
		if (!current.has('email')) {
			const updated = new Set(current);
			updated.add('email');
			const methodsMap = new Map(selectedMethods);
			methodsMap.set(influencerKey, updated);
			selectedMethods = methodsMap;
		}
	}
	
	// Evenly assign email accounts to influencers
	function evenlyAssignEmailAccounts() {
		if (gmailConnections.length === 0) return;
		
		const influencersWithEmail = influencers.filter(inf => hasEmail(inf));
		if (influencersWithEmail.length === 0) return;
		
		const newEmailAccounts = new Map<string, string>();
		const newMethods = new Map(selectedMethods);
		
		influencersWithEmail.forEach((inf, index) => {
			const key = getInfluencerKey(inf);
			// Round-robin assignment
			const connectionIndex = index % gmailConnections.length;
			const connectionId = gmailConnections[connectionIndex].id;
			newEmailAccounts.set(key, connectionId);
			
			// Ensure email method is selected
			const current = newMethods.get(key) || new Set<ContactMethod>();
			const updated = new Set(current);
			updated.add('email');
			newMethods.set(key, updated);
		});
		
		selectedEmailAccounts = newEmailAccounts;
		selectedMethods = newMethods;
	}
	
	// Get selected methods for influencer
	function getSelectedMethods(influencerKey: string): Set<ContactMethod> {
		return selectedMethods.get(influencerKey) || new Set();
	}
	
	// Check if influencer has email
	function hasEmail(influencer: Influencer): boolean {
		return !!(influencer.email_address || influencer.business_email);
	}
	
	// Count influencers with each contact method available
	const availableMethodCounts = $derived.by(() => {
		const counts = {
			email: 0,
			instagram: 0,
			tiktok: 0
		};
		
		influencers.forEach(influencer => {
			if (hasEmail(influencer)) {
				counts.email++;
			}
			const platform = influencer.platform?.toLowerCase();
			if (platform === 'instagram') {
				counts.instagram++;
			}
			if (platform === 'tiktok') {
				counts.tiktok++;
			}
		});
		
		return counts;
	});
	
	// Check if all influencers with a method are already selected
	function areAllSelectedForMethod(method: ContactMethod): boolean {
		let totalWithMethod = 0;
		let selectedWithMethod = 0;
		
		influencers.forEach(influencer => {
			const key = getInfluencerKey(influencer);
			const platform = influencer.platform?.toLowerCase();
			
			let hasMethod = false;
			if (method === 'email' && hasEmail(influencer)) {
				hasMethod = true;
			} else if (method === 'instagram' && platform === 'instagram') {
				hasMethod = true;
			} else if (method === 'tiktok' && platform === 'tiktok') {
				hasMethod = true;
			}
			
			if (hasMethod) {
				totalWithMethod++;
				if (isMethodSelected(key, method)) {
					selectedWithMethod++;
				}
			}
		});
		
		return totalWithMethod > 0 && selectedWithMethod === totalWithMethod;
	}
	
	// Select or deselect all influencers with a specific contact method
	function selectAllForMethod(method: ContactMethod) {
		// Check if trying to select email without Gmail connected
		if (method === 'email' && !gmailConnected) {
			const shouldSelect = !areAllSelectedForMethod(method);
			// Only show popup if trying to select (not deselect)
			if (shouldSelect) {
				showGmailWarningPopup = true;
				return;
			}
		}
		
		const newMap = new Map(selectedMethods);
		const shouldSelect = !areAllSelectedForMethod(method);
		
		influencers.forEach(influencer => {
			const key = getInfluencerKey(influencer);
			const platform = influencer.platform?.toLowerCase();
			
			let hasMethod = false;
			if (method === 'email' && hasEmail(influencer)) {
				hasMethod = true;
			} else if (method === 'instagram' && platform === 'instagram') {
				hasMethod = true;
			} else if (method === 'tiktok' && platform === 'tiktok') {
				hasMethod = true;
			}
			
			if (hasMethod) {
				const current = newMap.get(key) || new Set<ContactMethod>();
				const updated = new Set(current);
				
				if (shouldSelect) {
					updated.add(method);
				} else {
					updated.delete(method);
				}
				
				if (updated.size === 0) {
					newMap.delete(key);
				} else {
					newMap.set(key, updated);
				}
			}
		});
		
		selectedMethods = newMap;
		saveOutreachState(false);
	}
	
	// Get platform logo SVG
	function getPlatformLogo(platform: string | null | undefined): string {
		if (!platform) return '';
		const platformLower = platform.toLowerCase();
		if (platformLower === 'instagram') {
			return `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>`;
		}
		if (platformLower === 'tiktok') {
			return `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/></svg>`;
		}
		return '';
	}
	
	// Get platform color
	function getPlatformColor(platform: string | null | undefined): string {
		if (!platform) return 'text-gray-400';
		const platformLower = platform.toLowerCase();
		if (platformLower === 'instagram') {
			return 'text-[#E4405F]';
		}
		if (platformLower === 'tiktok') {
			return 'text-black';
		}
		return 'text-gray-500';
	}
	
	// Get method icon
	function getMethodIcon(method: ContactMethod): string {
		if (method === 'email') {
			return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>`;
		}
		if (method === 'instagram') {
			return `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>`;
		}
		if (method === 'tiktok') {
			return `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/></svg>`;
		}
		return '';
	}
	
	// Get method label
	function getMethodLabel(method: ContactMethod): string {
		if (method === 'email') return 'Email';
		if (method === 'instagram') return 'Instagram';
		if (method === 'tiktok') return 'TikTok';
		return '';
	}
	
	// Check if can proceed to draft stage
	const canProceedToDraft = $derived(() => {
		return selectedMethods.size > 0 && Array.from(selectedMethods.values()).some(methods => methods.size > 0);
	});
	
	// Get which contact methods are actually selected across all influencers
	const selectedContactMethods = $derived.by(() => {
		const methods = new Set<ContactMethod>();
		selectedMethods.forEach((methodSet) => {
			methodSet.forEach((method) => {
				methods.add(method);
			});
		});
		return methods;
	});
	
	// Helper to check if a contact method is selected
	const hasContactMethodSelected = (method: ContactMethod): boolean => {
		return selectedContactMethods.has(method);
	};
	
	// Get count of recipients for each contact method
	const getRecipientCount = (method: ContactMethod): number => {
		let count = 0;
		selectedMethods.forEach((methodSet) => {
			if (methodSet.has(method)) {
				count++;
			}
		});
		return count;
	};
	
	// Get review data - list of recipients with their selected methods and messages
	// Templates are filled with actual recipient data for preview
	const reviewData = $derived.by(() => {
		const recipients: Array<{
			influencer: Influencer;
			methods: ContactMethod[];
			messages: Record<ContactMethod, string>;
			emailAccountId?: string | null; // Selected email account ID for this influencer
		}> = [];
		
		selectedMethods.forEach((methods, key) => {
			const influencer = influencers.find(inf => getInfluencerKey(inf) === key);
			if (influencer && methods.size > 0) {
				const methodArray = Array.from(methods);
				
				// Fill template variables with actual recipient data
				const templateVars = {
					influencer_name: influencer.display_name || 'there'
				};
				
				const messages: Record<ContactMethod, string> = {
					email: messageContents.email 
						? replaceTemplateVariables(messageContents.email, templateVars)
						: '',
					instagram: messageContents.instagram
						? replaceTemplateVariables(messageContents.instagram, templateVars)
						: '',
					tiktok: messageContents.tiktok
						? replaceTemplateVariables(messageContents.tiktok, templateVars)
						: ''
				};
				
				// Get selected email account for this influencer
				const emailAccountId = methodArray.includes('email') ? getSelectedEmailAccount(key) : null;
				
				recipients.push({ influencer, methods: methodArray, messages, emailAccountId });
			}
		});
		
		return recipients;
	});
	
	// Get counts for each method in review
	const reviewCounts = $derived.by(() => {
		const counts = { email: 0, instagram: 0, tiktok: 0 };
		reviewData.forEach(recipient => {
			recipient.methods.forEach(method => {
				counts[method]++;
			});
		});
		return counts;
	});
	
	// Get current stage index (1, 2, 3, or 4)
	const currentStageIndex = $derived.by(() => {
		if (currentStage === 'select-methods') return 1;
		if (currentStage === 'draft-messages') return 2;
		if (currentStage === 'review-info') return 3;
		if (currentStage === 'review') return 4;
		return 1;
	});
	
	// Wrapper functions for preview callbacks
	function handlePreviewEmail(content: string, recipient: { name?: string; email?: string }) {
		previewEmailContent = content;
		previewRecipient = recipient;
	}
	
	function handlePreviewMessage(content: string, platform: 'instagram' | 'tiktok', recipient: { name?: string }) {
		previewMessageContent = content;
		previewMessagePlatform = platform;
		previewMessageRecipient = recipient;
	}
	
	// Create draft messages
	let isCreatingDrafts = $state(false);
	let createDraftError = $state<string | null>(null);
	let createDraftSuccess = $state<string | null>(null);
	
	async function createDrafts(method: ContactMethod) {
		const recipients = reviewData.filter(r => r.methods.includes(method));
		if (recipients.length === 0) return;
		
		isCreatingDrafts = true;
		createDraftError = null;
		createDraftSuccess = null;
		
		try {
			if (method === 'email') {
				if (!gmailConnected) {
					throw new Error('Gmail is not connected');
				}
				
				// Prepare recipient data with template variables and selected email account for backend processing
				const recipientData = recipients.map(r => {
					const key = getInfluencerKey(r.influencer);
					const selectedAccountId = getSelectedEmailAccount(key);
					if (!selectedAccountId) {
						throw new Error(`No email account selected for ${r.influencer.display_name || 'influencer'}`);
					}
					return {
						influencerId: r.influencer._id || key,
					email: r.influencer.email_address || r.influencer.business_email || '',
					name: r.influencer.display_name,
						platform: r.influencer.platform,
						senderConnectionId: selectedAccountId // Use the selected account for this influencer
					};
				});
				
				// Group recipients by senderConnectionId to batch requests
				const recipientsByAccount = new Map<string, typeof recipientData>();
				recipientData.forEach(recipient => {
					const accountId = recipient.senderConnectionId!;
					if (!recipientsByAccount.has(accountId)) {
						recipientsByAccount.set(accountId, []);
					}
					recipientsByAccount.get(accountId)!.push(recipient);
				});
				
				// Send requests for each account
				let totalCreated = 0;
				const errors: string[] = [];
				
				for (const [accountId, accountRecipients] of recipientsByAccount) {
					try {
				const response = await fetch('/api/outreach/send', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						campaignId: campaignId || undefined,
								recipients: accountRecipients.map(({ senderConnectionId, ...rest }) => rest), // Remove senderConnectionId from individual recipients
						emailContent: messageContents.email, // Template with {{variables}}
						platform: 'gmail',
								senderConnectionId: accountId // Use accountId for the batch
					})
				});
				
				if (!response.ok) {
					const data = await response.json();
							errors.push(`Failed for ${accountId}: ${data.error || 'Unknown error'}`);
							continue;
				}
				
				const data = await response.json();
						totalCreated += data.created || accountRecipients.length;
					} catch (error) {
						errors.push(`Failed for ${accountId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
					}
				}
				
				if (errors.length > 0 && totalCreated === 0) {
					throw new Error(errors.join('; '));
				}
				
				const createdCount = totalCreated || recipients.length;
				if (errors.length > 0) {
					createDraftSuccess = `Successfully created ${createdCount} draft${createdCount > 1 ? 's' : ''} in your Gmail account${errors.length > 0 ? ` (${errors.length} failed)` : ''}`;
				} else {
				createDraftSuccess = `Successfully created ${createdCount} draft${createdCount > 1 ? 's' : ''} in your Gmail account`;
				}
				
				// Reload contacted influencers and filter selections after successful send
				if (createdCount > 0) {
					await loadContactedInfluencers();
					// Filter out contacted influencers from selectedMethods
					const filteredMethods = new Map<string, Set<ContactMethod>>();
					selectedMethods.forEach((methods, key) => {
						if (!contactedInfluencerIds.has(key)) {
							// Also remove email method if it was used
							const remainingMethods = new Set(methods);
							remainingMethods.delete('email');
							if (remainingMethods.size > 0) {
								filteredMethods.set(key, remainingMethods);
							}
						} else {
							// Remove email method from contacted influencers
							const remainingMethods = new Set(methods);
							remainingMethods.delete('email');
							if (remainingMethods.size > 0) {
								filteredMethods.set(key, remainingMethods);
							}
						}
					});
					selectedMethods = filteredMethods;
					saveOutreachState(true); // Save immediately
				}
			} else {
				// Instagram/TikTok - not implemented yet
				throw new Error(`${method} messaging is not yet implemented`);
			}
		} catch (error) {
			createDraftError = error instanceof Error ? error.message : 'Failed to create drafts';
		} finally {
			isCreatingDrafts = false;
		}
	}
	
	// Load campaign data for modal
	async function loadCampaignData() {
		if (!campaignId || isLoadingCampaignData) return;
		
		isLoadingCampaignData = true;
		try {
			const response = await fetch(`/api/campaigns/${campaignId}`);
			if (response.ok) {
				const data = await response.json();
				// API returns the campaign directly, not wrapped
				const campaign = data.campaign || data;
				campaignData = {
					title: campaign?.title ?? null,
					website: campaign?.website ?? null,
					businessSummary: campaign?.businessSummary ?? null,
					business_location: campaign?.business_location ?? null,
					type_of_influencer: campaign?.type_of_influencer ?? null,
					locations: campaign?.locations ?? null,
					platform: campaign?.platform ?? null,
					followersMin: campaign?.followersMin ?? null,
					followersMax: campaign?.followersMax ?? null
				};
			}
		} catch (error) {
			console.error('Failed to load campaign data', error);
		} finally {
			isLoadingCampaignData = false;
		}
	}
	
	// Open draft modal and load campaign data
	function openDraftModal() {
		draftModalOpen = true;
		loadCampaignData();
	}
	
	// Draft message with ChatGPT
	async function draftWithChatGPT() {
		if (!campaignId || !editingPlatform) {
			return;
		}
		
		isDrafting = true;
		draftError = null;
		
		try {
			const response = await fetch('/api/outreach/draft', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					campaignId,
					tone: draftTone,
					platform: editingPlatform
				})
			});
			
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || `Failed to draft ${editingPlatform} message`);
			}
			
			const data = await response.json();
			if (data.message && editingPlatform) {
				// Convert to HTML for email, keep as plain text for Instagram/TikTok
				const finalContent = editingPlatform === 'email'
					? convertTextToHtml(data.message)
					: data.message;
				updateMessageContent(editingPlatform, finalContent);
				draftModalOpen = false;
				campaignData = null; // Clear campaign data
			} else {
				throw new Error(`No ${editingPlatform} message content received`);
			}
		} catch (error) {
			draftError = error instanceof Error ? error.message : `Failed to draft ${editingPlatform} message`;
		} finally {
			isDrafting = false;
		}
	}
	
	// Convert plain text with newlines to HTML for email editor
	function convertTextToHtml(text: string): string {
		if (!text) return '<p></p>';
		
		// Split by double newlines (paragraph breaks)
		const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
		
		if (paragraphs.length === 0) {
			return '<p></p>';
		}
		
		// Convert each paragraph: single newlines become <br>, then wrap in <p>
		const htmlParagraphs = paragraphs.map(para => {
			// Replace single newlines with <br> tags
			const withBreaks = para.split('\n').map(line => line.trim()).filter(line => line).join('<br>');
			return `<p>${withBreaks}</p>`;
		});
		
		return htmlParagraphs.join('');
	}
	
	// Quick Draft with streaming
	async function quickDraft() {
		if (!campaignId || !editingPlatform) {
			return;
		}
		
		const platform = editingPlatform; // Capture for closure
		
		isQuickDrafting = true;
		quickDraftError = null;
		// Clear existing content to start fresh
		messageContents[platform] = platform === 'email' ? '<p></p>' : '';
		
		try {
			const response = await fetch('/api/outreach/draft/stream', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					campaignId,
					tone: draftTone,
					platform: platform
				})
			});
			
			if (!response.ok || !response.body) {
				const errorText = await response.text();
				throw new Error(errorText || `Failed to start streaming draft for ${platform}`);
			}
			
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let accumulatedContent = '';
			
			const processEvent = (eventType: string, data: string) => {
				try {
					const payload = JSON.parse(data);
					
					if (eventType === 'delta' && payload.delta) {
						accumulatedContent += payload.delta;
						// Convert to HTML for email, keep as plain text for Instagram/TikTok
						const finalContent = platform === 'email' 
							? convertTextToHtml(accumulatedContent)
							: accumulatedContent;
						updateMessageContent(platform, finalContent);
					} else if (eventType === 'final' && payload.message) {
						// Final message received - convert to HTML for email, keep as plain text for Instagram/TikTok
						const finalContent = platform === 'email'
							? convertTextToHtml(payload.message)
							: payload.message;
						updateMessageContent(platform, finalContent);
					} else if (eventType === 'error') {
						throw new Error(payload.message || 'Streaming error occurred');
					}
				} catch (parseError) {
					console.error('Failed to parse SSE data', parseError);
				}
			};
			
			const parseBuffer = () => {
				let boundary: number;
				while ((boundary = buffer.indexOf('\n\n')) !== -1) {
					const chunk = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					
					const lines = chunk.split('\n');
					let eventType = '';
					let data = '';
					
					for (const line of lines) {
						if (line.startsWith('event: ')) {
							eventType = line.slice(7).trim();
						} else if (line.startsWith('data: ')) {
							data = line.slice(6).trim();
						}
					}
					
					if (eventType && data) {
						processEvent(eventType, data);
					}
				}
			};
			
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				
				buffer += decoder.decode(value, { stream: true });
				parseBuffer();
			}
			
			// Process any remaining buffer
			if (buffer.trim()) {
				parseBuffer();
			}
			
			// Final save after streaming completes
			saveOutreachState(false);
		} catch (error) {
			quickDraftError = error instanceof Error ? error.message : `Failed to quick draft ${editingPlatform} message`;
			console.error('Quick draft error', error);
		} finally {
			isQuickDrafting = false;
		}
	}
	
	// Load email footer settings
	async function loadEmailFooter() {
		isFooterLoading = true;
		footerError = null;
		
		try {
			const response = await fetch('/api/settings/email');
			if (response.ok) {
				const data = await response.json();
				emailFooter = data.footer?.html || '';
			}
		} catch (error) {
			footerError = error instanceof Error ? error.message : 'Failed to load footer';
		} finally {
			isFooterLoading = false;
		}
	}
	
	// Save email footer settings
	async function saveEmailFooter() {
		isFooterSaving = true;
		footerError = null;
		
		try {
			const response = await fetch('/api/settings/email', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					footer: {
						enabled: emailFooter.trim().length > 0,
						html: emailFooter.trim()
					}
				})
			});
			
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to save footer');
			}
			
			footerModalOpen = false;
		} catch (error) {
			footerError = error instanceof Error ? error.message : 'Failed to save footer';
		} finally {
			isFooterSaving = false;
		}
	}
	
	function getSequenceProps(): SendOutreachSequenceProps {
		return {
			currentStage,
			selectedMethods,
			messageContents,
			editingPlatform,
			navigationValidationErrors,
			gmailConnections,
			selectedEmailAccounts,
			reviewData,
			reviewCounts,
			currentStageIndex,
			availableMethodCounts,
			gmailConnected,
			isCreatingDrafts,
			createDraftSuccess,
			createDraftError,
			isDrafting,
			isQuickDrafting,
			quickDraftError,
			footerModalOpen,
			influencers,
			campaignId,
			onStageChange: (stage: Stage) => { currentStage = stage; },
			onEditingPlatformChange: (platform: ContactMethod | null) => { editingPlatform = platform; },
			onToggleMethod: toggleMethod,
			onSetEmailAccount: setEmailAccount,
			onEvenlyAssignEmailAccounts: evenlyAssignEmailAccounts,
			onSelectAllForMethod: selectAllForMethod,
			onUpdateMessageContent: updateMessageContent,
			onSaveOutreachState: saveOutreachState,
			onCreateDrafts: createDrafts,
			onLoadContactedInfluencers: loadContactedInfluencers,
			onQuickDraft: quickDraft,
			onOpenDraftModal: openDraftModal,
			onOpenFooterModal: () => { footerModalOpen = true; },
			onConnectGmail: handleConnectGmail,
			onPreviewEmail: handlePreviewEmail,
			onPreviewMessage: handlePreviewMessage,
			getInfluencerKey,
			getSelectedMethods,
			isMethodSelected,
			getSelectedEmailAccount,
			hasEmail,
			areAllSelectedForMethod,
			hasContactMethodSelected,
			getRecipientCount,
			getMethodIcon,
			getMethodLabel,
			getPlatformLogo,
			getPlatformColor,
			canProceedToDraft
		};
	}

	// Load footer when modal opens
	$effect(() => {
		if (footerModalOpen) {
			loadEmailFooter();
		}
	});
</script>


{#if open || embedded}
	{#if embedded}
		<div class="h-full flex flex-col bg-white">
			{#if showNotReadyMessage}
				<div class="h-full flex items-center justify-center px-8 py-12">
					<div class="max-w-md text-center">
						<div class="mb-4 flex justify-center">
							<svg class="h-16 w-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
							</svg>
						</div>
						<h3 class="text-xl font-semibold text-gray-900 mb-2">Campaign Setup In Progress</h3>
						<p class="text-sm text-gray-600">
							The chatbot hasn't finished collecting information about your campaign yet.
							Please complete the campaign setup in the Chat tab before sending outreach.
						</p>
					</div>
				</div>
			{:else if influencers.length === 0}
				<div class="h-full flex items-center justify-center px-8 py-12">
					<div class="max-w-md text-center">
						<div class="mb-4 flex justify-center">
							<svg class="h-16 w-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
							</svg>
						</div>
						<h3 class="text-xl font-semibold text-gray-900 mb-2">No Influencers Selected</h3>
						<p class="text-sm text-gray-600">
							Select influencers from the list above to start sending outreach messages.
						</p>
					</div>
				</div>
			{:else}
				<div class="h-full flex flex-col overflow-hidden">
					<div class="border-b border-gray-200 px-8 py-6 shrink-0">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-3">
								<h2 class="text-2xl font-semibold text-gray-900">Send Outreach</h2>
								{#if stateRestored}
									<span class="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">Resumed</span>
								{/if}
								{#if isSaving || isSavingDebounced}
									<span class="text-xs text-gray-500">Saving...</span>
								{:else if saveSuccess}
									<span class="text-xs text-green-600">Saved</span>
								{/if}
							</div>
						</div>
					</div>
					<div class="flex-1 overflow-hidden relative">
						<SendOutreachSequenceRenderer props={getSequenceProps()} />
					</div>
				</div>
			{/if}
		</div>
	{:else}
		{#if showNotReadyMessage}
			<SendOutreachPopupPanel open={open} onClose={onClose} showHeader={false}>
				<div class="h-full flex items-center justify-center px-8 py-12">
					<div class="max-w-md text-center">
						<div class="mb-4 flex justify-center">
							<svg class="h-16 w-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
							</svg>
						</div>
						<h3 class="text-xl font-semibold text-gray-900 mb-2">Campaign Setup In Progress</h3>
						<p class="text-sm text-gray-600">
							The chatbot hasn't finished collecting information about your campaign yet.
							Please complete the campaign setup in the Chat tab before sending outreach.
						</p>
					</div>
				</div>
			</SendOutreachPopupPanel>
		{:else if influencers.length === 0}
			<SendOutreachPopupPanel open={open} onClose={onClose} showHeader={false}>
				<div class="h-full flex items-center justify-center px-8 py-12">
					<div class="max-w-md text-center">
						<div class="mb-4 flex justify-center">
							<svg class="h-16 w-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
							</svg>
						</div>
						<h3 class="text-xl font-semibold text-gray-900 mb-2">No Influencers Selected</h3>
						<p class="text-sm text-gray-600">
							Select influencers from the list above to start sending outreach messages.
						</p>
					</div>
				</div>
			</SendOutreachPopupPanel>
		{:else}
			<SendOutreachPopupPanel
				open={open}
				onClose={onClose}
				stateRestored={stateRestored}
				isSaving={isSaving}
				isSavingDebounced={isSavingDebounced}
				saveSuccess={saveSuccess}
			>
				<SendOutreachSequenceRenderer props={getSequenceProps()} />
			</SendOutreachPopupPanel>
		{/if}
	{/if}
{/if}
<!-- Draft with ChatGPT Modal -->
{#if draftModalOpen}
	<div
		class="fixed inset-0 z-100 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		onclick={() => { draftModalOpen = false; campaignData = null; }}
		onkeydown={(e) => e.key === 'Escape' && (draftModalOpen = false) && (campaignData = null)}
		role="button"
		tabindex="-1"
		aria-label="Close modal"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="bg-white rounded-2xl shadow-2xl p-8 max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && (draftModalOpen = false) && (campaignData = null)}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			transition:fly={{ y: 20, duration: 300 }}
		>
			<!-- Header with X button -->
			<div class="flex items-start justify-between mb-6 shrink-0">
				<div class="flex-1">
					<h3 class="text-xl font-semibold text-gray-900">Draft with ChatGPT</h3>
					{#if editingPlatform}
						<p class="text-sm text-gray-600 mt-1">Drafting a {editingPlatform === 'email' ? 'email' : editingPlatform === 'instagram' ? 'Instagram DM' : 'TikTok DM'} message</p>
					{/if}
				</div>
				<button
					type="button"
					onclick={() => { draftModalOpen = false; campaignData = null; }}
					class="ml-4 p-2 text-gray-400 hover:text-gray-600 transition-colors rounded-lg hover:bg-gray-100"
					aria-label="Close modal"
				>
					<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
			
			<!-- Scrollable content -->
			<div class="flex-1 overflow-y-auto space-y-6 pr-2">
				<!-- Tone Selection -->
				<div>
					<div class="block text-sm font-medium text-gray-700 mb-2">Tone</div>
					<div class="flex gap-3">
							<button
								type="button"
							onclick={() => draftTone = 'friendly'}
							class="flex-1 px-4 py-3 rounded-lg border-2 text-sm font-medium transition-colors {
								draftTone === 'friendly'
									? 'border-[#FF6F61] bg-[#FFF1ED] text-gray-900'
									: 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
							}"
							>
							Friendly
							</button>
						<button
							type="button"
							onclick={() => draftTone = 'business'}
							class="flex-1 px-4 py-3 rounded-lg border-2 text-sm font-medium transition-colors {
								draftTone === 'business'
									? 'border-[#FF6F61] bg-[#FFF1ED] text-gray-900'
									: 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
							}"
						>
							Business
						</button>
					</div>
				</div>
				
				<!-- Campaign Information -->
				<div>
					<div class="block text-sm font-medium text-gray-700 mb-3">Campaign Information</div>
					<div class="bg-gray-50 rounded-lg p-4 space-y-3 text-sm">
						{#if isLoadingCampaignData}
							<div class="text-gray-500 text-center py-4">Loading campaign data...</div>
						{:else if campaignData}
							{#if campaignData.title}
								<div>
									<span class="font-medium text-gray-700">Campaign Title:</span>
									<span class="text-gray-600 ml-2">{campaignData.title}</span>
								</div>
							{/if}
							{#if campaignData.website}
								<div>
									<span class="font-medium text-gray-700">Website:</span>
									<span class="text-gray-600 ml-2">{campaignData.website}</span>
								</div>
							{/if}
							{#if campaignData.businessSummary}
								<div>
									<span class="font-medium text-gray-700">Business Description:</span>
									<span class="text-gray-600 ml-2">{campaignData.businessSummary}</span>
								</div>
							{/if}
							{#if campaignData.business_location}
								<div>
									<span class="font-medium text-gray-700">Business Location:</span>
									<span class="text-gray-600 ml-2">{campaignData.business_location}</span>
								</div>
							{/if}
						{:else}
							<div class="text-gray-500 text-center py-4">No campaign data available</div>
						{/if}
					</div>
				</div>
			</div>
			
			<!-- Footer buttons -->
			<div class="flex gap-3 pt-4 border-t border-gray-200 shrink-0 mt-4">
				<Button
					variant="outline"
					onclick={() => { draftModalOpen = false; campaignData = null; }}
					disabled={isDrafting}
					class="flex-1"
				>
					Cancel
				</Button>
					<Button
						variant="primary"
						onclick={draftWithChatGPT}
					disabled={isDrafting || isLoadingCampaignData}
					class="flex-1"
					>
					{isDrafting ? 'Drafting...' : 'Draft Message'}
					</Button>
			</div>
		</div>
	</div>
{/if}

<!-- Email Preview Modal -->
{#if previewEmailContent}
	<EmailPreview
		open={previewEmailContent !== null}
		emailContent={previewEmailContent}
		recipientName={previewRecipient?.name}
		recipientEmail={previewRecipient?.email}
		onClose={() => {
			previewEmailContent = null;
			previewRecipient = null;
		}}
	/>
{/if}

<!-- Instagram/TikTok Message Preview Modal -->
{#if previewMessageContent && previewMessagePlatform}
	<MessagePreview
		open={previewMessageContent !== null}
		messageContent={previewMessageContent}
		platform={previewMessagePlatform}
		recipientName={previewMessageRecipient?.name}
		onClose={() => {
			previewMessageContent = null;
			previewMessagePlatform = null;
			previewMessageRecipient = null;
		}}
	/>
{/if}

<!-- Footer Customization Modal -->
{#if footerModalOpen}
	<div
		class="fixed inset-0 z-100 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		onclick={() => footerModalOpen = false}
		onkeydown={(e) => e.key === 'Escape' && (footerModalOpen = false)}
		role="button"
		tabindex="-1"
		aria-label="Close modal"
		transition:fade={{ duration: 200 }}
	>
		<div
			class="bg-white rounded-2xl shadow-2xl p-8 max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && (footerModalOpen = false)}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			transition:fly={{ y: 20, duration: 300 }}
		>
			<div class="flex items-center justify-between mb-4 shrink-0">
				<h3 class="text-xl font-semibold text-gray-900">Customize Email Footer</h3>
				<button
					type="button"
					onclick={() => footerModalOpen = false}
					class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
					aria-label="Close"
				>
					<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
					</div>
			
			<div class="flex-1 overflow-y-auto space-y-4">
				<div>
					<div class="block text-sm font-medium text-gray-700 mb-2">
						Footer HTML Content
					</div>
					<p class="text-xs text-gray-500 mb-3">
						This footer will be appended to all your outreach emails. You can use HTML formatting.
					</p>
					{#if isFooterLoading}
						<div class="p-4 text-center text-gray-500">Loading...</div>
					{:else}
						<EmailEditor
							content={emailFooter}
							onUpdate={(content) => emailFooter = content}
						/>
					{/if}
				</div>
				
				{#if footerError}
					<div class="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
						{footerError}
					</div>
				{/if}
				</div>
			
			<div class="flex gap-3 pt-4 border-t border-gray-200 shrink-0 mt-4">
				<Button
					variant="outline"
					onclick={() => footerModalOpen = false}
					disabled={isFooterSaving}
					class="flex-1"
				>
					Cancel
				</Button>
				<Button
					variant="primary"
					onclick={saveEmailFooter}
					disabled={isFooterSaving || isFooterLoading}
					class="flex-1"
				>
					{isFooterSaving ? 'Saving...' : 'Save Footer'}
				</Button>
			</div>
		</div>
	</div>
{/if}

<!-- Gmail Connection Warning Popup -->
{#if showGmailWarningPopup}
	<div 
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
		transition:fade={{ duration: 200 }}
		onclick={() => showGmailWarningPopup = false}
		onkeydown={(e) => e.key === 'Escape' && (showGmailWarningPopup = false)}
		role="dialog"
		aria-modal="true"
		aria-labelledby="gmail-warning-title"
		tabindex="-1"
	>
		<div 
			class="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="none"
			transition:fly={{ y: 20, duration: 200 }}
		>
			<div class="flex items-start gap-4">
				<div class="shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
					<svg class="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
					</svg>
				</div>
				<div class="flex-1">
					<h3 id="gmail-warning-title" class="text-lg font-semibold text-gray-900 mb-2">Gmail Not Connected</h3>
					<p class="text-sm text-gray-600 mb-4">
						You need to connect your Gmail account to use email as a contact method. Please go to Settings to link your mailbox.
					</p>
					<div class="flex gap-3">
						<Button
							variant="outline"
							onclick={() => showGmailWarningPopup = false}
							class="flex-1"
						>
							Close
						</Button>
						<Button
							variant="primary"
							onclick={() => {
								showGmailWarningPopup = false;
								window.location.href = '/my-account/gmail';
							}}
							class="flex-1"
						>
							Go to Settings
						</Button>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}
