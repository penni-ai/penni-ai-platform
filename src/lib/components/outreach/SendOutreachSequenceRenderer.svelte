<script lang="ts">
	import SendOutreachSequence from './SendOutreachSequence.svelte';
	import type { SendOutreachSequenceProps } from './types';

	export let props: SendOutreachSequenceProps;
</script>

<SendOutreachSequence
	currentStage={props.currentStage}
	selectedMethods={props.selectedMethods}
	messageContents={props.messageContents}
	editingPlatform={props.editingPlatform}
	navigationValidationErrors={props.navigationValidationErrors}
	gmailConnections={props.gmailConnections}
	selectedEmailAccounts={props.selectedEmailAccounts}
	reviewData={props.reviewData}
	reviewCounts={props.reviewCounts}
	currentStageIndex={props.currentStageIndex}
	availableMethodCounts={props.availableMethodCounts}
	gmailConnected={props.gmailConnected}
	isCreatingDrafts={props.isCreatingDrafts}
	createDraftSuccess={props.createDraftSuccess}
	createDraftError={props.createDraftError}
	isDrafting={props.isDrafting}
	isQuickDrafting={props.isQuickDrafting}
	quickDraftError={props.quickDraftError}
	footerModalOpen={props.footerModalOpen}
	influencers={props.influencers}
	campaignId={props.campaignId}
	navigationDirection={props.navigationDirection}
	onStageChange={props.onStageChange}
	onEditingPlatformChange={props.onEditingPlatformChange}
	onToggleMethod={props.onToggleMethod}
	onSetEmailAccount={props.onSetEmailAccount}
	onEvenlyAssignEmailAccounts={props.onEvenlyAssignEmailAccounts}
	onSelectAllForMethod={props.onSelectAllForMethod}
	onUpdateMessageContent={props.onUpdateMessageContent}
	onSaveOutreachState={props.onSaveOutreachState}
	onCreateDrafts={props.onCreateDrafts}
	onLoadContactedInfluencers={props.onLoadContactedInfluencers}
	onQuickDraft={props.onQuickDraft}
	onOpenDraftModal={props.onOpenDraftModal}
	onOpenFooterModal={props.onOpenFooterModal}
	onConnectGmail={props.onConnectGmail}
	onPreviewEmail={props.onPreviewEmail}
	onPreviewMessage={props.onPreviewMessage}
	getInfluencerKey={props.getInfluencerKey}
	getSelectedMethods={props.getSelectedMethods}
	isMethodSelected={props.isMethodSelected}
	getSelectedEmailAccount={props.getSelectedEmailAccount}
	hasEmail={props.hasEmail}
	areAllSelectedForMethod={props.areAllSelectedForMethod}
	hasContactMethodSelected={props.hasContactMethodSelected}
	getRecipientCount={props.getRecipientCount}
	getMethodIcon={props.getMethodIcon}
	getMethodLabel={props.getMethodLabel}
	getPlatformLogo={props.getPlatformLogo}
	getPlatformColor={props.getPlatformColor}
	canProceedToDraft={props.canProceedToDraft}
/>
