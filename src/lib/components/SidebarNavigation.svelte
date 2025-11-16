<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	type NavItem = {
		label: string;
		href: string;
		icon: 'settings' | 'inbox';
		badge?: number;
	};

	type CampaignLink = {
		id: string;
		name: string;
		href?: string;
	};

	interface Props {
		campaigns?: CampaignLink[];
		selectedCampaignId?: string | null;
		onUpgrade?: () => void;
	}

	const navItems: NavItem[] = [
		{ label: 'Account & Settings', href: '/my-account', icon: 'settings' },
		{ label: 'Inbox', href: '/inbox', icon: 'inbox', badge: 2 }
	];

	let {
		campaigns = [],
		selectedCampaignId = null,
		onUpgrade
	}: Props = $props();

	let openMenuId = $state<string | null>(null);
	let infoCampaignId = $state<string | null>(null);
	let infoCampaignData = $state<any>(null);
	let isLoadingInfo = $state(false);
	
	// Editable campaign fields state
	let editingFields = $state<Record<string, string>>({});
	let isSaving = $state(false);
	let saveError = $state<string | null>(null);
	let saveSuccess = $state(false);
	
	// Initialize editing fields when campaign data loads
	$effect(() => {
		if (infoCampaignData) {
			editingFields = {
				title: infoCampaignData.title ?? '',
				website: infoCampaignData.collected?.website ?? infoCampaignData.website ?? '',
				business_name: infoCampaignData.collected?.business_name ?? infoCampaignData.business_name ?? '',
				business_location: infoCampaignData.collected?.business_location ?? infoCampaignData.business_location ?? '',
				businessSummary: infoCampaignData.businessSummary ?? '',
				locations: infoCampaignData.collected?.locations ?? infoCampaignData.locations ?? '',
				type_of_influencer: infoCampaignData.collected?.type_of_influencer ?? infoCampaignData.type_of_influencer ?? '',
				platform: infoCampaignData.collected?.platform ?? infoCampaignData.platform ?? '',
				followersMin: infoCampaignData.followersMin?.toString() ?? infoCampaignData.followerRange?.min?.toString() ?? '',
				followersMax: infoCampaignData.followersMax?.toString() ?? infoCampaignData.followerRange?.max?.toString() ?? ''
			};
		}
	});
	
	async function saveCampaignFields() {
		if (!infoCampaignId || isSaving) return;
		
		isSaving = true;
		saveError = null;
		saveSuccess = false;
		
		try {
			const updateData: Record<string, unknown> = {};
			
			// Convert string values to appropriate types
			if (editingFields.title !== undefined) updateData.title = editingFields.title || null;
			if (editingFields.website !== undefined) updateData.website = editingFields.website || null;
			if (editingFields.business_name !== undefined) updateData.business_name = editingFields.business_name || null;
			if (editingFields.business_location !== undefined) updateData.business_location = editingFields.business_location || null;
			if (editingFields.businessSummary !== undefined) updateData.businessSummary = editingFields.businessSummary || null;
			if (editingFields.locations !== undefined) updateData.locations = editingFields.locations || null;
			if (editingFields.type_of_influencer !== undefined) updateData.type_of_influencer = editingFields.type_of_influencer || null;
			if (editingFields.platform !== undefined) updateData.platform = editingFields.platform || null;
			if (editingFields.followersMin !== undefined) updateData.followersMin = editingFields.followersMin ? parseInt(editingFields.followersMin, 10) : null;
			if (editingFields.followersMax !== undefined) updateData.followersMax = editingFields.followersMax ? parseInt(editingFields.followersMax, 10) : null;
			
			const response = await fetch(`/api/campaigns/${infoCampaignId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updateData)
			});
			
			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Failed to update campaign');
			}
			
			// Reload campaign data
			const updatedResponse = await fetch(`/api/campaigns/${infoCampaignId}`);
			if (updatedResponse.ok) {
				infoCampaignData = await updatedResponse.json();
			}
			
			saveSuccess = true;
			setTimeout(() => {
				saveSuccess = false;
			}, 2000);
		} catch (error) {
			saveError = error instanceof Error ? error.message : 'Failed to save changes';
			console.error('Failed to save campaign fields:', error);
		} finally {
			isSaving = false;
		}
	}
	let usage = $state<{ 
		influencersFound: { count: number; limit: number; remaining: number; resetDate: number };
		outreachSent: { count: number; limit: number; remaining: number; resetDate: number };
	} | null>(null);
	let currentPlanKey = $state<string | null>(null);
	
	// Cache for prefetched conversations to avoid duplicate requests
	const prefetchCache = new Map<string, Promise<void>>();
	
	// Prefetch conversation data when hovering on campaign link
	function prefetchConversation(campaignId: string) {
		// Skip if already prefetching or cached
		if (prefetchCache.has(campaignId)) {
			return;
		}
		
		// Start prefetch
		const prefetchPromise = fetch(`/api/chat/${campaignId}`, {
			method: 'GET',
			headers: { 'Content-Type': 'application/json' }
		}).then(() => {
			// Keep in cache for a short time to avoid re-fetching
			setTimeout(() => {
				prefetchCache.delete(campaignId);
			}, 30000); // Clear after 30 seconds
		}).catch(() => {
			// Remove from cache on error so it can be retried
			prefetchCache.delete(campaignId);
		});
		
		prefetchCache.set(campaignId, prefetchPromise);
	}

	function toggleMenu(campaignId: string, event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		openMenuId = openMenuId === campaignId ? null : campaignId;
	}

	function closeMenu() {
		openMenuId = null;
	}

	async function showCampaignInfo(campaignId: string, event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		closeMenu();
		
		infoCampaignId = campaignId;
		isLoadingInfo = true;
		
		try {
			const response = await fetch(`/api/campaigns/${campaignId}`);
			if (!response.ok) {
				throw new Error('Failed to load campaign info');
			}
			infoCampaignData = await response.json();
		} catch (error) {
			console.error('Failed to load campaign info:', error);
			alert('Failed to load campaign information. Please try again.');
			infoCampaignId = null;
		} finally {
			isLoadingInfo = false;
		}
	}

	function closeInfoModal() {
		infoCampaignId = null;
		infoCampaignData = null;
	}

	onMount(() => {
		function handleClickOutside(event: MouseEvent) {
			if (openMenuId !== null) {
				const target = event.target as HTMLElement | null;
				if (target?.closest('[data-campaign-menu]') || target?.closest('[data-campaign-menu-trigger]')) {
					return;
				}
				closeMenu();
			}
		}

		function handleEscape(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				if (infoCampaignId !== null) {
					closeInfoModal();
				}
				if (openMenuId !== null) {
					closeMenu();
				}
			}
		}

		document.addEventListener('click', handleClickOutside);
		document.addEventListener('keydown', handleEscape);
		
		// Load usage and plan
		void loadUsage();
		void loadPlan();
		
		return () => {
			document.removeEventListener('click', handleClickOutside);
			document.removeEventListener('keydown', handleEscape);
		};
	});
	
	async function loadUsage() {
		try {
			const response = await fetch('/api/usage');
			if (response.ok) {
				const result = await response.json();
				// Handle potential wrapper - check if response is wrapped in 'data' property
				usage = result.data ?? result;
			}
		} catch (error) {
			console.error('Failed to load usage:', error);
		}
	}

	async function loadPlan() {
		try {
			const response = await fetch('/api/billing/current-plan');
			if (response.ok) {
				const result = await response.json();
				currentPlanKey = result.data?.planKey ?? result.planKey ?? null;
			}
		} catch (error) {
			console.error('Failed to load plan:', error);
		}
	}

	function getPlanName(planKey: string | null): string {
		if (!planKey) return 'Free Plan';
		const planNames: Record<string, string> = {
			free: 'Free Plan',
			starter: 'Starter Plan',
			growth: 'Growth Plan',
			event: 'Event Plan'
		};
		return planNames[planKey] ?? 'Free Plan';
	}
	
	function formatResetDate(timestamp: number): string {
		const date = new Date(timestamp);
		return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
	}

	async function deleteCampaign(campaignId: string, event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		
		if (!confirm('Are you sure you want to delete this campaign? This action cannot be undone.')) {
			return;
		}

		try {
			const response = await fetch(`/api/campaigns/${campaignId}`, {
				method: 'DELETE'
			});

			if (!response.ok) {
				throw new Error('Failed to delete campaign');
			}

			// If we're currently viewing this campaign, redirect to dashboard
			if (selectedCampaignId === campaignId) {
				await goto('/dashboard');
			}

			closeMenu();
		} catch (error) {
			console.error('Failed to delete campaign:', error);
			alert('Failed to delete campaign. Please try again.');
		}
	}
</script>

<div class="flex h-full flex-1 flex-col">
	<div class="px-6 pt-6 pb-5 border-b border-gray-100">
	<Button
		onclick={async () => {
				try {
					const response = await fetch('/api/campaigns', { method: 'POST' });
					if (!response.ok) {
						throw new Error('Failed to create campaign');
					}
					const data = await response.json();
					if (data.campaignId) {
						await goto(`/campaign/${data.campaignId}`);
					}
				} catch (error) {
					console.error('Failed to create campaign', error);
					alert('Failed to create campaign. Please try again.');
				}
			}}
			class="w-full justify-center bg-[#FF6F61] text-white hover:bg-[#ff846f]"
		>
			New Campaign
		</Button>
	</div>

	<div class="px-6 py-5 space-y-3 border-t border-gray-100">
		<p class="text-xs font-semibold uppercase tracking-wide text-gray-400">Campaign</p>
		{#if campaigns.length}
			<div class="space-y-2">
				{#each campaigns as campaign}
					<div
						class={`group relative flex items-center justify-between rounded-xl px-4 py-2.5 text-sm transition ${
							selectedCampaignId === campaign.id
								? 'bg-[#FFF1ED] text-gray-900 shadow-sm'
								: 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
						}`}
					>
						<a
							href={campaign.href ?? `/campaign/${campaign.id}`}
							class="flex-1 font-medium"
							onmouseenter={() => prefetchConversation(campaign.id)}
						>
							{campaign.name}
						</a>
		<button
			type="button"
			data-campaign-menu-trigger
			onclick={(e) => toggleMenu(campaign.id, e)}
							class="ml-2 flex items-center justify-center rounded-lg p-1 text-gray-400 opacity-0 transition hover:bg-gray-200 hover:text-gray-600 group-hover:opacity-100"
							aria-label="Campaign options"
						>
							<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
								<path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
							</svg>
						</button>
			{#if openMenuId === campaign.id}
				<div
					class="absolute right-0 top-full z-10 mt-1 w-40 rounded-lg border border-gray-200 bg-white shadow-lg"
					role="menu"
					aria-label="Campaign options menu"
					tabindex="-1"
					data-campaign-menu
				>
					<button
						type="button"
						onclick={(e) => showCampaignInfo(campaign.id, e)}
						class="w-full rounded-lg px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
					>
						Info
					</button>
					<button
						type="button"
						onclick={(e) => deleteCampaign(campaign.id, e)}
						class="w-full rounded-lg px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
					>
						Delete
					</button>
				</div>
			{/if}
					</div>
				{/each}
			</div>
		{:else}
			<div class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
				<p class="font-medium text-gray-600">No campaigns setup</p>
				<p class="mt-1 text-[11px] text-gray-500">Start a chat to create your first campaign.</p>
			</div>
		{/if}
	</div>

	<nav class="px-6 py-5 mt-auto border-t border-gray-100 space-y-1">
		{#each navItems as item}
			<a
				href={item.href}
				class="relative flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-gray-600 transition hover:text-gray-900 hover:bg-gray-50"
			>
		{#if item.icon === 'settings'}
			<svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
				/>
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
			</svg>
		{:else}
			<svg class="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.667 2.667 0 00-.1.661z" />
			</svg>
		{/if}
				<span class="font-medium">{item.label}</span>
				{#if item.badge}
					<span class="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-[#FF6F61] text-[10px] font-semibold text-white">{item.badge}</span>
				{/if}
			</a>
		{/each}
	</nav>
	
	<!-- Current Plan Panel -->
	{#if usage}
		<div class="mx-6 mb-4 rounded-lg border-2 border-gray-200 bg-white p-3">
			<div class="space-y-3">
				<div class="flex items-center justify-between">
					<p class="text-sm font-semibold text-gray-900">{getPlanName(currentPlanKey)}</p>
					<Button
						variant="primary"
						size="sm"
						class="text-xs px-2.5 py-1 shrink-0"
						onclick={() => {
							if (onUpgrade) {
								onUpgrade();
							} else {
								window.location.href = '/pricing';
							}
						}}
					>
						Upgrade
					</Button>
				</div>
				
				<!-- Influencers Found Bar -->
				<div class="space-y-1">
					<div class="flex items-center justify-between">
						<p class="text-xs text-gray-600">Influencers Found</p>
						<p class="text-xs font-medium text-gray-900">
							{usage.influencersFound.remaining} / {usage.influencersFound.limit} remaining
						</p>
					</div>
					<div class="h-2 w-full overflow-hidden rounded-full bg-gray-100">
						<div
							class="h-full bg-[#FF6F61] transition-all duration-300"
							style="width: {usage.influencersFound.limit > 0 ? Math.min(100, (usage.influencersFound.remaining / usage.influencersFound.limit) * 100) : 0}%"
						></div>
					</div>
				</div>
				
				<!-- Outreach Sent Bar -->
				<div class="space-y-1">
					<div class="flex items-center justify-between">
						<p class="text-xs text-gray-600">Outreach Sent</p>
						<p class="text-xs font-medium text-gray-900">
							{usage.outreachSent.remaining} / {usage.outreachSent.limit} remaining
						</p>
					</div>
					<div class="h-2 w-full overflow-hidden rounded-full bg-gray-100">
						<div
							class="h-full bg-[#FF6F61] transition-all duration-300"
							style="width: {usage.outreachSent.limit > 0 ? Math.min(100, (usage.outreachSent.remaining / usage.outreachSent.limit) * 100) : 0}%"
						></div>
					</div>
				</div>
				
				<p class="text-[10px] text-gray-500">
					Resets {formatResetDate(usage.influencersFound.resetDate)}
				</p>
			</div>
		</div>
	{/if}
</div>

<!-- Campaign Info Modal -->


{#if infoCampaignId}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={(event) => {
			if (event.target === event.currentTarget) {
				closeInfoModal();
			}
		}}
		onkeydown={(e) => e.key === 'Escape' && closeInfoModal()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="campaign-info-title"
		tabindex="-1"
	>
		<div
			class="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-xl"
			role="document"
			tabindex="-1"
		>
			<div class="sticky top-0 border-b border-gray-200 bg-white px-6 py-4">
				<div class="flex items-center justify-between">
					<h2 id="campaign-info-title" class="text-xl font-semibold text-gray-900">Campaign Details</h2>
					<button
						type="button"
						onclick={closeInfoModal}
						class="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
						aria-label="Close"
					>
						<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
			</div>

			<div class="px-6 py-5">
				{#if isLoadingInfo}
					<div class="flex justify-center py-12">
						<div class="text-gray-500">Loading campaign information...</div>
					</div>
				{:else if infoCampaignData}
					<div class="space-y-6">
						<!-- Basic Info -->
						<section>
							<h3 class="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Basic Information</h3>
							<dl class="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<div>
									<dt class="text-xs font-medium text-gray-500">Campaign ID</dt>
									<dd class="mt-1 text-sm text-gray-900 font-mono">{infoCampaignData.id ?? '—'}</dd>
								</div>
								<div>
									<dt class="text-xs font-medium text-gray-500">Title</dt>
									<dd class="mt-1 text-sm text-gray-900">{infoCampaignData.title ?? '—'}</dd>
								</div>
								<div>
									<dt class="text-xs font-medium text-gray-500">Status</dt>
									<dd class="mt-1 text-sm text-gray-900 capitalize">{infoCampaignData.status ?? '—'}</dd>
								</div>
								<div>
									<dt class="text-xs font-medium text-gray-500">Created</dt>
									<dd class="mt-1 text-sm text-gray-900">
										{infoCampaignData.createdAt ? new Date(infoCampaignData.createdAt).toLocaleString() : '—'}
									</dd>
								</div>
								<div>
									<dt class="text-xs font-medium text-gray-500">Last Updated</dt>
									<dd class="mt-1 text-sm text-gray-900">
										{infoCampaignData.updatedAt ? new Date(infoCampaignData.updatedAt).toLocaleString() : '—'}
									</dd>
								</div>
								<div>
									<dt class="text-xs font-medium text-gray-500">Message Sequence</dt>
									<dd class="mt-1 text-sm text-gray-900">{infoCampaignData.messageSequence ?? '—'}</dd>
								</div>
							</dl>
						</section>

						<!-- Campaign Fields -->
							<section>
							<h3 class="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Campaign Fields</h3>
							<dl class="space-y-3">
								<!-- Business Name -->
								<div>
									<dt class="text-xs font-medium text-gray-500 flex items-center gap-2 mb-1">
										Business Name
										{#if infoCampaignData.fieldStatus?.business_name === 'confirmed'}
											<span class="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">Confirmed</span>
										{:else if infoCampaignData.fieldStatus?.business_name === 'collected'}
											<span class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">Collected</span>
										{:else if (infoCampaignData.collected?.business_name ?? infoCampaignData.business_name) !== null && (infoCampaignData.collected?.business_name ?? infoCampaignData.business_name) !== undefined}
											<span class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">Collected</span>
										{:else}
											<span class="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">Not Collected</span>
										{/if}
									</dt>
									<dd class="mt-1">
										<input
											type="text"
											bind:value={editingFields.business_name}
											placeholder="Enter business name"
											class="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-[#FF6F61] focus:outline-none focus:ring-1 focus:ring-[#FF6F61]"
										/>
									</dd>
								</div>

								<!-- Website -->
								<div>
									<dt class="text-xs font-medium text-gray-500 flex items-center gap-2 mb-1">
										Website
										{#if infoCampaignData.fieldStatus?.website === 'confirmed'}
											<span class="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">Confirmed</span>
										{:else if infoCampaignData.fieldStatus?.website === 'collected'}
											<span class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">Collected</span>
										{:else if infoCampaignData.missing?.includes('website') || (infoCampaignData.collected?.website ?? infoCampaignData.website) === null}
											<span class="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">Not Collected</span>
										{:else if (infoCampaignData.collected?.website ?? infoCampaignData.website) !== null && (infoCampaignData.collected?.website ?? infoCampaignData.website) !== undefined}
											<span class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">Collected</span>
										{:else}
											<span class="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">Not Collected</span>
										{/if}
									</dt>
									<dd class="mt-1">
										<input
											type="text"
											bind:value={editingFields.website}
											placeholder="Enter website URL"
											class="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-[#FF6F61] focus:outline-none focus:ring-1 focus:ring-[#FF6F61]"
										/>
									</dd>
								</div>

								<!-- Business Location -->
								<div>
									<dt class="text-xs font-medium text-gray-500 flex items-center gap-2 mb-1">
										Business Location
										{#if infoCampaignData.fieldStatus?.business_location === 'confirmed'}
											<span class="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">Confirmed</span>
										{:else if infoCampaignData.fieldStatus?.business_location === 'collected'}
											<span class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">Collected</span>
										{:else if infoCampaignData.missing?.includes('business_location') || (infoCampaignData.collected?.business_location ?? infoCampaignData.business_location) === null}
											<span class="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">Not Collected</span>
										{:else if (infoCampaignData.collected?.business_location ?? infoCampaignData.business_location) !== null && (infoCampaignData.collected?.business_location ?? infoCampaignData.business_location) !== undefined}
											<span class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">Collected</span>
										{:else}
											<span class="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">Not Collected</span>
										{/if}
									</dt>
									<dd class="mt-1">
										<input
											type="text"
											bind:value={editingFields.business_location}
											placeholder="Enter business location"
											class="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-[#FF6F61] focus:outline-none focus:ring-1 focus:ring-[#FF6F61]"
										/>
									</dd>
								</div>

								<!-- Business About -->
								<div>
									<dt class="text-xs font-medium text-gray-500 flex items-center gap-2 mb-1">
										Business About
										{#if infoCampaignData.fieldStatus?.business_about === 'confirmed'}
											<span class="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">Confirmed</span>
										{:else if infoCampaignData.fieldStatus?.business_about === 'collected'}
											<span class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">Collected</span>
										{:else if infoCampaignData.businessSummary && infoCampaignData.businessSummary !== '—'}
											<span class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">Collected</span>
										{:else}
											<span class="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">Not Collected</span>
										{/if}
									</dt>
									<dd class="mt-1">
										<textarea
											bind:value={editingFields.businessSummary}
											placeholder="Enter business description"
											rows="3"
											class="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-[#FF6F61] focus:outline-none focus:ring-1 focus:ring-[#FF6F61] resize-none"
										></textarea>
									</dd>
								</div>

								<!-- Influencer Location -->
										<div>
									<dt class="text-xs font-medium text-gray-500 flex items-center gap-2 mb-1">
										Influencer Location
										{#if infoCampaignData.fieldStatus?.influencer_location === 'confirmed'}
											<span class="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">Confirmed</span>
										{:else if infoCampaignData.fieldStatus?.influencer_location === 'collected'}
											<span class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">Collected</span>
										{:else if infoCampaignData.missing?.includes('locations') || ((infoCampaignData.collected?.locations ?? infoCampaignData.locations) === null)}
											<span class="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">Not Collected</span>
										{:else if (infoCampaignData.collected?.locations ?? infoCampaignData.locations) !== null && (infoCampaignData.collected?.locations ?? infoCampaignData.locations) !== undefined}
											<span class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">Collected</span>
										{:else}
											<span class="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">Not Collected</span>
										{/if}
									</dt>
									<dd class="mt-1">
										<input
											type="text"
											bind:value={editingFields.locations}
											placeholder="Enter influencer location"
											class="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-[#FF6F61] focus:outline-none focus:ring-1 focus:ring-[#FF6F61]"
										/>
									</dd>
										</div>

								<!-- Influencer Types -->
								<div>
								<dt class="text-xs font-medium text-gray-500 flex items-center gap-2 mb-1">
									Type of Influencer
									{#if (infoCampaignData.collected?.type_of_influencer ?? infoCampaignData.type_of_influencer) !== null && (infoCampaignData.collected?.type_of_influencer ?? infoCampaignData.type_of_influencer) !== undefined}
										<span class="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">Collected</span>
									{:else}
										<span class="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">Not Collected</span>
					{/if}
								</dt>
								<dd class="mt-1">
									<input
										type="text"
										bind:value={editingFields.type_of_influencer}
										placeholder="Enter type of influencer"
										class="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-[#FF6F61] focus:outline-none focus:ring-1 focus:ring-[#FF6F61]"
									/>
								</dd>
							</div>

							<!-- Platform -->
							<div>
								<dt class="text-xs font-medium text-gray-500 flex items-center gap-2 mb-1">
									Platform
									{#if (infoCampaignData.collected?.platform ?? infoCampaignData.platform) !== null && (infoCampaignData.collected?.platform ?? infoCampaignData.platform) !== undefined}
											<span class="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">Collected</span>
										{:else}
											<span class="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">Not Collected</span>
						{/if}
									</dt>
								<dd class="mt-1">
									<select
										bind:value={editingFields.platform}
										class="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-[#FF6F61] focus:outline-none focus:ring-1 focus:ring-[#FF6F61]"
									>
										<option value="">Select platform</option>
										<option value="instagram">Instagram</option>
										<option value="tiktok">TikTok</option>
									</select>
								</dd>
								</div>

								<!-- Followers -->
								<div>
									<dt class="text-xs font-medium text-gray-500 flex items-center gap-2 mb-1">
										Follower Range
										{#if infoCampaignData.fieldStatus?.min_followers === 'confirmed' || infoCampaignData.fieldStatus?.max_followers === 'confirmed'}
											<span class="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800">Confirmed</span>
										{:else if infoCampaignData.fieldStatus?.min_followers === 'collected' || infoCampaignData.fieldStatus?.max_followers === 'collected'}
											<span class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">Collected</span>
										{:else if infoCampaignData.missing?.includes('followers') || ((infoCampaignData.followerRange?.min === null || infoCampaignData.followerRange?.min === undefined) && (infoCampaignData.followerRange?.max === null || infoCampaignData.followerRange?.max === undefined) && infoCampaignData.followersMin === null && infoCampaignData.followersMax === null)}
											<span class="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">Not Collected</span>
										{:else if (infoCampaignData.followerRange?.min !== null && infoCampaignData.followerRange?.min !== undefined) || (infoCampaignData.followerRange?.max !== null && infoCampaignData.followerRange?.max !== undefined) || infoCampaignData.followersMin !== null || infoCampaignData.followersMax !== null}
											<span class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">Collected</span>
										{:else}
											<span class="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">Not Collected</span>
										{/if}
									</dt>
									<dd class="mt-1">
										<div class="flex items-center gap-2">
											<input
												type="number"
												bind:value={editingFields.followersMin}
												placeholder="Min"
												class="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-[#FF6F61] focus:outline-none focus:ring-1 focus:ring-[#FF6F61]"
											/>
											<span class="text-gray-500">–</span>
											<input
												type="number"
												bind:value={editingFields.followersMax}
												placeholder="Max"
												class="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-[#FF6F61] focus:outline-none focus:ring-1 focus:ring-[#FF6F61]"
											/>
										</div>
									</dd>
								</div>
							</dl>

							<!-- Save Button -->
							<div class="mt-4 pt-4 border-t border-gray-200">
								<div class="flex items-center justify-between gap-3">
									{#if saveError}
										<p class="text-xs text-red-600">{saveError}</p>
									{:else if saveSuccess}
										<p class="text-xs text-green-600">Changes saved successfully!</p>
									{:else}
										<div></div>
									{/if}
									<button
										type="button"
										onclick={saveCampaignFields}
										disabled={isSaving}
										class="ml-auto rounded-md bg-[#FF6F61] px-4 py-2 text-sm font-medium text-white hover:bg-[#FF5A4A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
									>
										{isSaving ? 'Saving...' : 'Save Changes'}
									</button>
								</div>
								</div>
							</section>


						<!-- Follower Range -->
						{#if infoCampaignData.followerRange || infoCampaignData.followersMin !== null || infoCampaignData.followersMax !== null}
							<section>
								<h3 class="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Follower Range</h3>
								<dl class="grid grid-cols-1 gap-3 sm:grid-cols-2">
									<div>
										<dt class="text-xs font-medium text-gray-500">Text Description</dt>
										<dd class="mt-1 text-sm text-gray-900">{infoCampaignData.followers ?? '—'}</dd>
									</div>
									<div>
										<dt class="text-xs font-medium text-gray-500">Numeric Range</dt>
										<dd class="mt-1 text-sm text-gray-900">
											{#if infoCampaignData.followerRange}
												{infoCampaignData.followerRange.min ?? '—'} – {infoCampaignData.followerRange.max ?? '—'}
											{:else}
												{infoCampaignData.followersMin ?? '—'} – {infoCampaignData.followersMax ?? '—'}
											{/if}
										</dd>
									</div>
								</dl>
							</section>
						{/if}

						<!-- Search Status -->
						{#if infoCampaignData.search}
							<section>
								<h3 class="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Search Status</h3>
								<dl class="grid grid-cols-1 gap-3 sm:grid-cols-2">
									<div>
										<dt class="text-xs font-medium text-gray-500">Status</dt>
										<dd class="mt-1 text-sm text-gray-900 capitalize">{infoCampaignData.search.status ?? '—'}</dd>
									</div>
									{#if infoCampaignData.search.completedAt}
										<div>
											<dt class="text-xs font-medium text-gray-500">Completed At</dt>
											<dd class="mt-1 text-sm text-gray-900">
												{new Date(infoCampaignData.search.completedAt).toLocaleString()}
											</dd>
										</div>
									{/if}
									{#if infoCampaignData.search.lastError}
										<div class="sm:col-span-2">
											<dt class="text-xs font-medium text-red-500">Last Error</dt>
											<dd class="mt-1 text-sm text-red-600">{infoCampaignData.search.lastError}</dd>
										</div>
									{/if}
								</dl>
							</section>
						{/if}

						<!-- Business Summary -->
						{#if infoCampaignData.businessSummary}
							<section>
								<h3 class="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Business Summary</h3>
								<p class="text-sm text-gray-700 whitespace-pre-wrap">{infoCampaignData.businessSummary}</p>
							</section>
						{/if}

						<!-- Influencer Search Query -->
						<section>
							<h3 class="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Influencer Search Query</h3>
							<p class="text-sm text-gray-700 whitespace-pre-wrap">{infoCampaignData.influencerSearchQuery ?? '—'}</p>
						</section>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
