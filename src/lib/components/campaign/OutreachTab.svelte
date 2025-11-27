<script lang="ts">
	import { browser } from '$app/environment';
	import type { PipelineStatus, InfluencerProfile } from '$lib/types/campaign';
	import type { SerializedCampaign } from '$lib/server/campaigns';
	import PipelineStatusComponent from './PipelineStatus.svelte';
	import InfluencersTable from './InfluencersTable.svelte';
	import Button from '$lib/components/Button.svelte';
	import SendOutreachPopupPanel from '$lib/components/outreach/SendOutreachPopupPanel.svelte';
	import EmailEditor from '$lib/components/EmailEditor.svelte';
	import { getProfileId } from '$lib/utils/campaign';

	interface Props {
		effectiveCampaign: SerializedCampaign | null;
		pipelineStatus: PipelineStatus | null;
		selectedInfluencerIds: Set<string>;
		contactedInfluencerIds: Set<string>;
		showContacted: boolean;
		previousProfileIds: Set<string>;
		campaignId: string | null;
		pipelineError?: { code: string; message: string; pipelineId: string } | null;
		isSearchFormSubmitting?: boolean;
		onToggleInfluencer: (id: string) => void;
		onToggleContacted: () => void;
		onSendOutreach: () => void;
		onSelectAll?: () => void;
		onDeselectAll?: () => void;
		onRefresh?: () => void | Promise<void>;
		onFindMore?: (excludeProfileUrls: string[]) => void;
	}

	let {
		effectiveCampaign,
		pipelineStatus,
		selectedInfluencerIds,
		contactedInfluencerIds,
		showContacted,
		previousProfileIds,
		campaignId,
		pipelineError = null,
		isSearchFormSubmitting = false,
		onToggleInfluencer,
		onToggleContacted,
		onSendOutreach,
		onSelectAll,
		onDeselectAll,
		onRefresh,
		onFindMore
	}: Props = $props();

	const selectedCount = $derived(selectedInfluencerIds.size);
	
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
	
	// Gmail connection state
	type GmailConnection = { id: string; email: string; primary?: boolean | null };
	let gmailConnections = $state<GmailConnection[]>([]);
	let isLoadingGmail = $state(false);
	let gmailLoadedCampaignId: string | null = $state(null);
	const gmailConnected = $derived(gmailConnections.length > 0);
	const primaryGmail = $derived(() => gmailConnections.find((c) => c.primary) ?? gmailConnections[0] ?? null);
	
	// Email template state
	let emailTemplate = $state('');
	let templateLastSavedAt: number | null = $state(null);
	let templateSaving = $state(false);
	let templateLoadedCampaignId: string | null = $state(null);
	const templateKey = () => `simpleEmailTemplate:${campaignId ?? effectiveCampaign?.id ?? ''}`;
	const hasTemplate = $derived(emailTemplate.trim().length > 0);
	const templateSaved = $derived(hasTemplate && templateLastSavedAt !== null);
	
	// Popup state
	let showEmailPopup = $state(false);
	let draftInFlight = $state(false);
	let draftStatus: string | null = $state(null);
	let draftError: string | null = $state(null);
	let isQuickDrafting = $state(false);
	let quickDraftError: string | null = $state(null);
	let templateWarning: string | null = $state(null);
	let templateJustSaved = $state(false);
	
	function templateStatusText() {
		if (!templateSaved && emailTemplate.trim().length === 0) return 'Not drafted';
		if (templateSaving) return 'Saving…';
		if (templateJustSaved) return '✓ Saved!';
		if (templateSaved) return 'Drafted';
		return 'Draft';
	}
	
	function defaultTemplate() {
		return `<p>Hi {{influencer_name}},</p><p>We love your content and think you'd be a great fit for our campaign. Are you open to a quick collaboration chat?</p><p>Thanks!</p>`;
	}
	
	// Load Gmail connections
	$effect(() => {
		if (!browser) return;
		const id = campaignId ?? effectiveCampaign?.id ?? null;
		if (!id || gmailLoadedCampaignId === id) return;
		gmailLoadedCampaignId = id;
		void refreshGmailStatus();
	});
	
	// Load template from localStorage
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
	
	async function refreshGmailStatus() {
		try {
			isLoadingGmail = true;
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
		} catch {
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
		} finally {
			templateSaving = false;
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
					}
				} catch {}
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
		const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
		if (paragraphs.length === 0) return '<p></p>';
		return paragraphs.map((p) => `<p>${p}</p>`).join('');
	}
	
	// Get recipients with emails
	const recipientsWithEmail = $derived(() => {
		return displayedProfiles.filter(p => p.email_address || p.business_email);
	});
	
	// Selected recipients with email
	const selectedRecipientsWithEmail = $derived(() => {
		return recipientsWithEmail().filter(p => selectedInfluencerIds.has(p._id || getProfileId(p)));
	});
	
	async function createGmailDrafts() {
		const sender = primaryGmail();
		if (!sender) {
			draftError = 'Connect Gmail before creating drafts.';
			return;
		}
		if (!templateSaved) {
			draftError = 'Add and save an email template first.';
			showEmailPopup = true;
			return;
		}
		
		const recips = selectedRecipientsWithEmail();
		if (recips.length === 0) {
			draftError = 'Selected influencers have no email addresses.';
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
		} catch (error) {
			draftError = error instanceof Error ? error.message : 'Failed to create drafts';
		} finally {
			draftInFlight = false;
		}
	}
	
	// Determine which profiles to show: use final profiles if available, otherwise preliminary candidates
	const displayedProfiles = $derived.by(() => {
		if (pipelineStatus?.profiles && pipelineStatus.profiles.length > 0) {
			return pipelineStatus.profiles;
		}
		// Show preliminary candidates if status is running and no final profiles yet
		if (pipelineStatus?.status === 'running' && pipelineStatus?.preliminary_candidates && pipelineStatus.preliminary_candidates.length > 0) {
			return pipelineStatus.preliminary_candidates;
		}
		return [];
	});
	
	const hasInfluencersInTable = $derived(displayedProfiles.length > 0);
	const isShowingPreliminary = $derived(
		!!(pipelineStatus?.status === 'running' && 
		   (!pipelineStatus.profiles || pipelineStatus.profiles.length === 0) && 
		   pipelineStatus?.preliminary_candidates && 
		   pipelineStatus.preliminary_candidates.length > 0)
	);

	/**
	 * Removes keys whose value is a dict or a list of dicts (i.e., nested).
	 * Lists of primitives are kept (joined by ';').
	 */
	function removeNestedKeys(entry: InfluencerProfile): Record<string, string | number | boolean | null | undefined> {
		const out: Record<string, string | number | boolean | null | undefined> = {};
		for (const [k, v] of Object.entries(entry)) {
			if (v === null || v === undefined) {
				out[k] = v;
			} else if (typeof v === 'object' && !Array.isArray(v)) {
				// Skip nested objects
				continue;
			} else if (Array.isArray(v)) {
				// Check if it's a list of objects
				if (v.length > 0 && typeof v[0] === 'object' && v[0] !== null && !Array.isArray(v[0])) {
					// Skip lists of objects
					continue;
				} else {
					// Keep lists of primitives, joined by ';'
					out[k] = v.map(i => String(i)).join(';');
				}
			} else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
				// Keep primitives
				out[k] = v;
			}
		}
		return out;
	}

	/**
	 * Escapes CSV field values
	 */
	function escapeCsvField(value: string | number | boolean | null | undefined): string {
		if (value === null || value === undefined) {
			return '';
		}
		const str = String(value);
		// If field contains comma, newline, or double quote, wrap in quotes and escape quotes
		if (str.includes(',') || str.includes('\n') || str.includes('"')) {
			return `"${str.replace(/"/g, '""')}"`;
		}
		return str;
	}

	/**
	 * Converts influencer profiles to CSV format
	 */
	function exportToCsv(profiles: InfluencerProfile[]): string {
		if (profiles.length === 0) {
			return '';
		}

		// Remove nested columns from each object
		const flatData = profiles.map(removeNestedKeys);

		// Determine all fieldnames
		const fieldnamesSet = new Set<string>();
		for (const row of flatData) {
			Object.keys(row).forEach(key => fieldnamesSet.add(key));
		}
		const fieldnames = Array.from(fieldnamesSet).sort();

		// Build CSV
		const lines: string[] = [];
		
		// Header row
		lines.push(fieldnames.map(escapeCsvField).join(','));

		// Data rows
		for (const row of flatData) {
			const values = fieldnames.map(field => escapeCsvField(row[field]));
			lines.push(values.join(','));
		}

		return lines.join('\n');
	}

	/**
	 * Downloads the CSV file
	 */
	function handleExportToCsv() {
		const profilesToExport = displayedProfiles;
		if (!profilesToExport || profilesToExport.length === 0) {
			return;
		}

		// Filter out profiles with missing or empty display_name
		const validProfiles = profilesToExport.filter(profile => {
			const displayName = profile.display_name;
			return displayName && typeof displayName === 'string' && displayName.trim() !== '' && displayName !== 'N/A';
		});

		if (validProfiles.length === 0) {
			return;
		}

		const csvContent = exportToCsv(validProfiles);
		const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		
		// Generate filename with campaign ID or timestamp
		const timestamp = new Date().toISOString().split('T')[0];
		const filename = campaignId 
			? `influencers-${campaignId}-${timestamp}.csv`
			: `influencers-${timestamp}.csv`;
		link.download = filename;
		
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	}
</script>

<div class="flex h-full w-full overflow-hidden flex-col">
	<!-- Influencers List -->
	<div class="flex-1 overflow-hidden flex flex-col min-h-0">
		<!-- Show pipeline status and influencers list if pipeline exists -->
		{#if effectiveCampaign?.pipeline_id}
			<div class="flex-1 overflow-y-auto px-8 py-6 border-b border-gray-200 min-h-0">
				{#if pipelineError}
					<!-- Pipeline Error State - Show error but allow viewing existing data -->
					<div class="mx-auto w-full max-w-6xl space-y-6">
						<div class="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
							<div class="flex items-start gap-3">
								<div class="shrink-0">
									<svg class="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
								</div>
								<div class="flex-1">
									<p class="text-sm font-medium text-red-900">{pipelineError.message}</p>
									<p class="mt-1 text-xs text-red-700">Error code: {pipelineError.code}</p>
								</div>
							</div>
						</div>
						{#if pipelineStatus !== null && pipelineStatus !== undefined}
							<!-- Show existing pipeline status data below error -->
							<div class="space-y-6">
								<PipelineStatusComponent status={pipelineStatus} />
								
								<!-- Influencers Table -->
								{#if pipelineStatus.status === 'running' || pipelineStatus.status === 'completed' || pipelineStatus.status === 'pending'}
									{#if isShowingPreliminary}
										<div class="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
											<strong>Preview:</strong> Showing preliminary search results. Final analysis with fit scores will appear shortly.
										</div>
									{/if}
								<InfluencersTable
									profiles={displayedProfiles}
									selectedIds={selectedInfluencerIds}
									contactedIds={contactedInfluencerIds}
									{showContacted}
									status={pipelineStatus.status}
									isPreliminary={isShowingPreliminary}
									{previousProfileIds}
									isSearching={isSearchFormSubmitting}
									onToggleSelection={onToggleInfluencer}
									onToggleContacted={onToggleContacted}
									onFindMore={handleFindMore}
								/>
							{/if}
						</div>
					{/if}
				</div>
			{:else if pipelineStatus !== null && pipelineStatus !== undefined}
				<div class="space-y-6">
					<PipelineStatusComponent status={pipelineStatus} />
					
					<!-- Influencers Table -->
					{#if pipelineStatus.status === 'running' || pipelineStatus.status === 'completed' || pipelineStatus.status === 'pending'}
						{#if isShowingPreliminary}
							<div class="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
								<strong>Preview:</strong> Showing preliminary search results. Final analysis with fit scores will appear shortly.
							</div>
						{/if}
						<InfluencersTable
							profiles={displayedProfiles}
							selectedIds={selectedInfluencerIds}
							contactedIds={contactedInfluencerIds}
							{showContacted}
							status={pipelineStatus.status}
							isPreliminary={isShowingPreliminary}
							{previousProfileIds}
							isSearching={isSearchFormSubmitting}
							onToggleSelection={onToggleInfluencer}
							onToggleContacted={onToggleContacted}
							onFindMore={handleFindMore}
						/>
					{/if}
				</div>
				{:else}
					<!-- Loading Pipeline Status -->
					<div class="mx-auto w-full max-w-6xl space-y-6">
						<div class="flex flex-col items-center justify-center py-12">
							<div class="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#FF6F61] mb-4"></div>
							<p class="text-sm font-medium text-gray-900">Loading pipeline status...</p>
							<p class="mt-1 text-xs text-gray-500">Your influencer search is being initiated.</p>
						</div>
					</div>
				{/if}
			</div>
		{:else}
			<div class="flex-1 overflow-y-auto px-8 py-6 min-h-0">
				<div class="h-full flex items-center justify-center">
					<div class="max-w-md text-center text-gray-600 space-y-4">
						<h3 class="text-lg font-semibold text-gray-900">No influencer search started</h3>
						<p class="text-sm">
							Use the chat tab to complete the campaign setup and trigger an influencer search. Once the search is running,
							you'll be able to review profiles and send outreach here.
						</p>
						{#if onRefresh}
							<button
								type="button"
								onclick={async () => {
									if (onRefresh) {
										await onRefresh();
									}
								}}
								class="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
							>
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
								</svg>
								Refresh
							</button>
						{/if}
					</div>
				</div>
			</div>
		{/if}
		
		<!-- Bottom Bar with Gmail/Template Controls -->
		{#if hasInfluencersInTable && !isShowingPreliminary}
			<div class="border-t border-gray-200 bg-white shrink-0">
				<!-- Selection row -->
				<div class="px-8 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
					<div class="flex items-center gap-4">
						<span class="text-sm font-medium text-gray-900">
							{selectedCount} {selectedCount === 1 ? 'influencer' : 'influencers'} selected
						</span>
						{#if onSelectAll && onDeselectAll}
							{#if selectedCount === 0}
								<button
									type="button"
									class="text-xs font-medium text-[#FF6F61] hover:text-[#FF5A4A] transition-colors"
									onclick={onSelectAll}
								>
									Select all
								</button>
							{:else}
								<button
									type="button"
									class="text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
									onclick={onDeselectAll}
								>
									Clear selection
								</button>
							{/if}
						{/if}
					</div>
					<button
						type="button"
						onclick={handleExportToCsv}
						class="text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1"
					>
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
						</svg>
						Export CSV
					</button>
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
						class="flex items-center gap-2 px-4 py-2.5 rounded-lg cursor-pointer transition-colors {templateSaved ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}"
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
						class="px-6 py-2.5 bg-[#FF6F61] text-white font-medium rounded-lg hover:bg-[#FF5A4A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
		{/if}
	</div>
</div>

<!-- Email Template Popup -->
<SendOutreachPopupPanel
	open={showEmailPopup}
	onClose={() => showEmailPopup = false}
	title="Email Template"
	subtitle="Draft your outreach email"
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
				{#if templateWarning}
					<span class="text-amber-600">⚠️ {templateWarning}</span>
				{/if}
			</div>
		</div>
		<div class="border-t border-gray-200 px-6 py-4 flex justify-end">
			<Button variant="secondary" size="sm" onclick={() => void saveTemplate()} disabled={templateSaving}>Save template</Button>
		</div>
	</div>
</SendOutreachPopupPanel>
