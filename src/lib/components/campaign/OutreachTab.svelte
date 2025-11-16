<script lang="ts">
	import type { PipelineStatus } from '$lib/types/campaign';
	import type { SerializedCampaign } from '$lib/server/campaigns';
	import PipelineStatusComponent from './PipelineStatus.svelte';
	import InfluencersTable from './InfluencersTable.svelte';
	import CampaignOutreachPanel from '$lib/components/CampaignOutreachPanel.svelte';
	import { getProfileId } from '$lib/utils/campaign';
	import type { Influencer } from '$lib/types/campaign';

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

	const selectedInfluencers = $derived(() => {
		if (!pipelineStatus?.profiles) return [];
		return pipelineStatus.profiles.filter(profile => {
			const profileId = profile._id || getProfileId(profile);
			return selectedInfluencerIds.has(profileId);
		}) as Influencer[];
	});

	const selectedCount = $derived(selectedInfluencerIds.size);
</script>

<div class="w-1/2 shrink-0 h-full overflow-hidden">
	<div class="flex h-full flex-col overflow-hidden">
		<!-- Show pipeline status and influencers list if pipeline exists -->
		{#if effectiveCampaign?.pipeline_id}
			<div class="flex-1 overflow-y-auto px-8 py-6 border-b border-gray-200">
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
			<div class="flex-1 overflow-y-auto px-8 py-6">
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
		{#if effectiveCampaign?.pipeline_id && pipelineStatus?.status === 'completed'}
			<div class="border-t border-gray-200 bg-white px-8 py-4 shrink-0 flex items-center justify-between">
				<div class="flex items-center gap-4">
					<span class="text-sm font-medium text-gray-900">
						{selectedCount} {selectedCount === 1 ? 'influencer' : 'influencers'} selected
					</span>
				</div>
				<button
					type="button"
					onclick={onSendOutreach}
					disabled={selectedCount === 0}
					class="px-6 py-2 bg-[#FF6F61] text-white font-medium rounded-lg hover:bg-[#FF5A4A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
				>
					Send Outreach
				</button>
			</div>
		{/if}
	</div>
	
	<!-- Embedded Outreach Panel - Always visible -->
	<div class="flex-1 overflow-hidden">
		<CampaignOutreachPanel 
			open={false}
			embedded={true}
			influencers={selectedInfluencers()} 
			campaignId={campaignId}
			onClose={() => {}}
			showNotReadyMessage={!effectiveCampaign?.pipeline_id || pipelineStatus?.status !== 'completed'}
		/>
	</div>
</div>
