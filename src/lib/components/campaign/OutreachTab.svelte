<script lang="ts">
	import type { PipelineStatus, InfluencerProfile } from '$lib/types/campaign';
	import type { SerializedCampaign } from '$lib/server/campaigns';
	import PipelineStatusComponent from './PipelineStatus.svelte';
	import InfluencersTable from './InfluencersTable.svelte';

	interface Props {
		effectiveCampaign: SerializedCampaign | null;
		pipelineStatus: PipelineStatus | null;
		selectedInfluencerIds: Set<string>;
		contactedInfluencerIds: Set<string>;
		showContacted: boolean;
		previousProfileIds: Set<string>;
		campaignId: string | null;
		onToggleInfluencer: (id: string) => void;
		onToggleContacted: () => void;
		onSendOutreach: () => void;
	}

	let {
		effectiveCampaign,
		pipelineStatus,
		selectedInfluencerIds,
		contactedInfluencerIds,
		showContacted,
		previousProfileIds,
		campaignId,
		onToggleInfluencer,
		onToggleContacted,
		onSendOutreach
	}: Props = $props();

	const selectedCount = $derived(selectedInfluencerIds.size);
	const hasInfluencersInTable = $derived(!!(pipelineStatus?.profiles && pipelineStatus.profiles.length > 0));

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
		if (!pipelineStatus?.profiles || pipelineStatus.profiles.length === 0) {
			return;
		}

		// Filter out profiles with missing or empty display_name
		const validProfiles = pipelineStatus.profiles.filter(profile => {
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
				{#if pipelineStatus !== null && pipelineStatus !== undefined}
					<div class="space-y-6">
						<PipelineStatusComponent status={pipelineStatus} />
						
						<!-- Influencers Table -->
						{#if pipelineStatus.status === 'running' || pipelineStatus.status === 'completed' || pipelineStatus.status === 'pending'}
							<InfluencersTable
								profiles={pipelineStatus.profiles}
								selectedIds={selectedInfluencerIds}
								contactedIds={contactedInfluencerIds}
								{showContacted}
								status={pipelineStatus.status}
								{previousProfileIds}
								onToggleSelection={onToggleInfluencer}
								onToggleContacted={onToggleContacted}
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
					<div class="max-w-md text-center text-gray-600 space-y-3">
						<h3 class="text-lg font-semibold text-gray-900">No influencer search started</h3>
						<p class="text-sm">
							Use the chat tab to complete the campaign setup and trigger an influencer search. Once the search is running,
							you'll be able to review profiles and send outreach here.
						</p>
					</div>
				</div>
			</div>
		{/if}
		
		<!-- Bottom Bar with Selected Count and Send Button -->
		{#if hasInfluencersInTable}
			<div class="border-t border-gray-200 bg-white px-8 py-4 shrink-0 flex items-center justify-between">
				<div class="flex items-center gap-4">
					<span class="text-sm font-medium text-gray-900">
						{selectedCount} {selectedCount === 1 ? 'influencer' : 'influencers'} selected
					</span>
				</div>
				<div class="flex items-center gap-3">
					<button
						type="button"
						onclick={handleExportToCsv}
						class="px-6 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
					>
						Export to CSV
					</button>
					<button
						type="button"
						onclick={onSendOutreach}
						disabled={selectedCount === 0}
						class="px-6 py-2 bg-[#FF6F61] text-white font-medium rounded-lg hover:bg-[#FF5A4A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
					>
						Send Outreach
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>
