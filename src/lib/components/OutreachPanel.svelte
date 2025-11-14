<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import EmailEditor from './EmailEditor.svelte';
	
	interface Influencer {
		_id?: string;
		display_name?: string;
		platform?: string;
		email_address?: string;
		business_email?: string;
		profile_url?: string;
	}
	
	interface Props {
		open: boolean;
		influencers: Influencer[];
		onClose: () => void;
	}
	
	let { open, influencers, onClose }: Props = $props();
	
	type Platform = 'gmail' | 'instagram' | 'tiktok';
	let selectedPlatform = $state<Platform>('gmail');
	let emailContents = $state<Record<Platform, string>>({
		gmail: '',
		instagram: '',
		tiktok: ''
	});
	
	interface GmailConnectionView {
		id: string;
		email: string;
		primary: boolean;
		connectedAt: number | null;
		lastRefreshedAt: number | null;
	}

	let gmailConnections = $state<GmailConnectionView[]>([]);
	let selectedGmailConnectionId = $state<string | null>(null);
	let isLoadingGmailStatus = $state(false);
	const gmailConnected = $derived(gmailConnections.length > 0);
	const selectedGmailConnection = $derived(() => {
		if (!selectedGmailConnectionId) return null;
		return gmailConnections.find((c) => c.id === selectedGmailConnectionId) ?? null;
	});
	
	// Check Gmail connection status when panel opens
	$effect(() => {
		if (open) {
			checkGmailStatus();
		}
	});
	
	// Update selected platform if Gmail is not connected and it's selected
	$effect(() => {
		if (!gmailConnected && selectedPlatform === 'gmail' && !isLoadingGmailStatus) {
			selectedPlatform = 'instagram';
		}
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
						lastRefreshedAt: conn.last_refreshed_at ?? conn.lastRefreshedAt ?? null
					}))
					: [];
				gmailConnections = connections;
				const preferred = connections.find((c) => c.primary) ?? connections[0];
				if (preferred) {
					selectedGmailConnectionId = preferred.id;
				} else {
					selectedGmailConnectionId = null;
				}
			}
		} catch (error) {
			console.error('Failed to check Gmail status:', error);
			gmailConnections = [];
			selectedGmailConnectionId = null;
		} finally {
			isLoadingGmailStatus = false;
		}
	}
	
	function handleConnectGmail() {
		// Redirect to Gmail OAuth connect endpoint
		window.location.href = '/api/auth/gmail/connect';
	}

	function handleReconnectGmail(connectionId: string) {
		window.location.href = `/api/auth/gmail/connect?connectionId=${encodeURIComponent(connectionId)}`;
	}
	
	// Filter and sort influencers based on selected platform
	const sortedInfluencers = $derived.by(() => {
		const matchingPlatform = influencers.filter(inf => {
			if (selectedPlatform === 'gmail') {
				// Gmail: show all influencers (email-based)
				return true;
			}
			// Instagram/TikTok: show only matching platform
			return inf.platform?.toLowerCase() === selectedPlatform;
		});
		
		const otherPlatforms = influencers.filter(inf => {
			if (selectedPlatform === 'gmail') {
				return false; // Gmail shows all, so no "others"
			}
			return inf.platform?.toLowerCase() !== selectedPlatform;
		});
		
		// Matching platform influencers first (bolded), then others
		return [...matchingPlatform, ...otherPlatforms];
	});
	
	// Generate a stable key for each influencer (doesn't depend on position)
	function getInfluencerKey(influencer: Influencer): string {
		return influencer._id || `${influencer.display_name || 'unknown'}-${influencer.platform || 'none'}-${influencer.email_address || influencer.business_email || ''}`;
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
</script>

{#if open}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-[10%]"
		onclick={onClose}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
		role="button"
		tabindex="-1"
		aria-label="Close panel"
		transition:fade={{ duration: 200 }}
	>
		<!-- Panel -->
		<div
			class="relative h-full w-full bg-white shadow-2xl rounded-2xl overflow-hidden"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && onClose()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			transition:fly={{ y: 20, duration: 300 }}
		>
			<!-- Header -->
			<div class="border-b border-gray-200 px-8 py-6">
				<div class="flex items-center justify-between">
					<h2 class="text-2xl font-semibold text-gray-900">Send Outreach</h2>
					<button
						type="button"
						onclick={onClose}
						class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
						aria-label="Close"
					>
						<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
			</div>
			
			<!-- Content -->
			<div class="flex h-[calc(100vh-88px)]">
				<!-- Column 1: Influencer List (20%) -->
				<div class="w-[20%] border-r border-gray-200 overflow-y-auto">
					<div class="p-4">
						<h3 class="text-sm font-semibold text-gray-900 mb-3">Recipients ({influencers.length})</h3>
						<div class="space-y-1">
							{#each sortedInfluencers as influencer (getInfluencerKey(influencer))}
								{@const isMatchingPlatform = selectedPlatform === 'gmail' || influencer.platform?.toLowerCase() === selectedPlatform}
								<div 
									class="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-gray-50 transition-all duration-300 {
										isMatchingPlatform ? 'bg-[#FFF1ED]/30' : ''
									}"
									animate:flip={{ duration: 400, easing: (t) => t * (2 - t) }}
									transition:fly={{ y: -10, duration: 300 }}
								>
									<div class="flex-shrink-0 flex flex-col items-center gap-1">
										{#if influencer.platform}
											<div class="flex items-center {getPlatformColor(influencer.platform)}">
												{@html getPlatformLogo(influencer.platform)}
											</div>
										{/if}
										{#if influencer.email_address || influencer.business_email}
											<a 
												href={`mailto:${influencer.email_address || influencer.business_email}`}
												class="text-gray-400 hover:text-[#FF6F61] transition-colors"
												title={influencer.email_address || influencer.business_email}
												onclick={(e) => e.stopPropagation()}
											>
												<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
													<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
												</svg>
											</a>
										{/if}
									</div>
									<div class="flex-1 min-w-0">
										<p class="text-sm truncate transition-all duration-300 {
											isMatchingPlatform ? 'font-bold text-gray-900' : 'font-medium text-gray-600'
										}">
											{influencer.display_name ?? 'N/A'}
										</p>
										{#if influencer.platform}
											<p class="text-xs text-gray-500 capitalize">{influencer.platform}</p>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				</div>
				
				<!-- Column 2: Platform Buttons + Email Editor (60%) -->
				<div class="w-[60%] border-r border-gray-200 flex flex-col">
					<!-- Platform Selection Buttons -->
					<div class="border-b border-gray-200 px-6 py-4">
						<h3 class="text-sm font-semibold text-gray-900 mb-3">Send With</h3>
						<div class="flex items-center gap-3">
							{#if gmailConnected}
								<!-- Gmail Button (only shown when connected) -->
				<button
					type="button"
					onclick={() => selectedPlatform = 'gmail'}
					class="flex items-center justify-center gap-2 rounded-xl border-2 px-6 py-3 text-sm font-medium transition-colors {
										selectedPlatform === 'gmail' 
											? 'border-[#FF6F61] bg-[#FFF1ED] text-gray-900' 
											: 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
									}"
								>
									<svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
										<path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/>
									</svg>
					<span>Gmail</span>
					{#if selectedGmailConnection()}
						<span class="text-xs text-gray-500">({selectedGmailConnection()?.email})</span>
					{:else if gmailConnections.length > 1}
						<span class="text-xs text-gray-500">({gmailConnections.length} accounts)</span>
					{/if}
				</button>
							{:else}
								<!-- Connect Gmail Button (shown when not connected) -->
								<button
									type="button"
									onclick={handleConnectGmail}
									disabled={isLoadingGmailStatus}
									class="flex items-center justify-center gap-2 rounded-xl border-2 border-[#FF6F61] bg-[#FF6F61] px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-[#FF5A4A] hover:border-[#FF5A4A] disabled:opacity-50 disabled:cursor-not-allowed"
								>
									<svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
										<path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/>
									</svg>
									<span>{isLoadingGmailStatus ? 'Checking...' : 'Connect with Gmail'}</span>
								</button>
							{/if}
							
							<!-- Instagram Button -->
							<button
								type="button"
								onclick={() => selectedPlatform = 'instagram'}
								class="flex items-center justify-center gap-2 rounded-xl border-2 px-6 py-3 text-sm font-medium transition-colors {
									selectedPlatform === 'instagram' 
										? 'border-[#FF6F61] bg-[#FFF1ED] text-gray-900' 
										: 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
								}"
							>
								<svg class="h-5 w-5 text-[#E4405F]" viewBox="0 0 24 24" fill="currentColor">
									<path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
								</svg>
								<span>Instagram</span>
							</button>
							
							<!-- TikTok Button -->
							<button
								type="button"
								onclick={() => selectedPlatform = 'tiktok'}
								class="flex items-center justify-center gap-2 rounded-xl border-2 px-6 py-3 text-sm font-medium transition-colors {
									selectedPlatform === 'tiktok' 
										? 'border-[#FF6F61] bg-[#FFF1ED] text-gray-900' 
										: 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
								}"
							>
								<svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
									<path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
								</svg>
								<span>TikTok</span>
							</button>
			</div>
		</div>

		{#if selectedPlatform === 'gmail'}
			<div class="border-b border-gray-200 px-6 py-4 bg-gray-50/60">
				<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<p class="text-sm font-semibold text-gray-900">Send from</p>
						<p class="text-xs text-gray-500">Choose which Gmail account will send this outreach.</p>
					</div>
					<div class="flex flex-wrap items-center gap-3">
						{#if gmailConnections.length > 0}
							<select
								class="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-[#FF6F61] focus:outline-none"
								bind:value={selectedGmailConnectionId}
							>
								{#each gmailConnections as connection}
									<option value={connection.id}>
										{connection.email}
										{connection.primary ? ' (Primary)' : ''}
									</option>
								{/each}
							</select>
							<button
								type="button"
								class="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-white"
								onclick={() => selectedGmailConnectionId && handleReconnectGmail(selectedGmailConnectionId)}
								disabled={!selectedGmailConnectionId}
							>
								Reconnect
							</button>
						{:else}
							<button
								type="button"
								class="rounded-xl border-2 border-[#FF6F61] bg-[#FF6F61] px-4 py-2 text-sm font-medium text-white"
								onclick={handleConnectGmail}
							>
								Connect Gmail
							</button>
						{/if}
						<button
							type="button"
							class="rounded-xl border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 hover:border-[#FF6F61]"
							onclick={handleConnectGmail}
						>
							Connect another Gmail
						</button>
					</div>
				</div>
			</div>
		{/if}
		
		<!-- Email Editor -->
		<div class="flex-1 overflow-hidden">
						<EmailEditor 
							content={emailContents[selectedPlatform]}
							onUpdate={(content) => emailContents[selectedPlatform] = content}
						/>
					</div>
				</div>
				
				<!-- Column 3: Empty for now (20%) -->
				<div class="w-[20%] overflow-y-auto">
					<div class="p-8">
						<!-- Column 3 content will go here -->
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}
