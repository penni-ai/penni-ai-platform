<script lang="ts">
	import SelectContactMethods from './SelectContactMethods.svelte';
	import DraftMessages from './DraftMessages.svelte';
	import ReviewInfo from './ReviewInfo.svelte';
	import ReviewStage from './ReviewStage.svelte';
	import OutreachNavigationBar from './OutreachNavigationBar.svelte';
	import SelectMethodsSlide from './slides/SelectMethodsSlide.svelte';
	import DraftMessagesSlide from './slides/DraftMessagesSlide.svelte';
	import ReviewInfoSlide from './slides/ReviewInfoSlide.svelte';
	import ReviewSlide from './slides/ReviewSlide.svelte';
	import type { SendOutreachSequenceProps } from './types';

	let {
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
		navigationDirection,
		onStageChange,
		onEditingPlatformChange,
		onToggleMethod,
		onSetEmailAccount,
		onEvenlyAssignEmailAccounts,
		onSelectAllForMethod,
		onUpdateMessageContent,
		onSaveOutreachState,
		onCreateDrafts,
		onLoadContactedInfluencers,
		onQuickDraft,
		onOpenDraftModal,
		onOpenFooterModal,
		onConnectGmail,
		onPreviewEmail,
		onPreviewMessage,
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
	}: SendOutreachSequenceProps = $props();
	
	function goToDraftStage() {
		if (canProceedToDraft()) {
			onStageChange('draft-messages');
			onEditingPlatformChange(null);
			onSaveOutreachState(true);
		}
	}
	
	function goToReviewInfoStage() {
		onStageChange('review-info');
		onSaveOutreachState(true);
	}
	
	function goToReviewStage() {
		onStageChange('review');
		onSaveOutreachState(true);
	}
	
	function goBackToSelectMethods() {
		onStageChange('select-methods');
		onSaveOutreachState(true);
	}
	
	function goBackToDraft() {
		onStageChange('draft-messages');
		onSaveOutreachState(true);
	}
	
	function goBackToReviewInfo() {
		onStageChange('review-info');
		onSaveOutreachState(true);
	}
	
	async function handleSendInstagram() {
		const instagramRecipients = reviewData.filter(r => r.methods.includes('instagram'));
		try {
			await fetch('/api/outreach/track', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					platform: 'instagram',
					count: instagramRecipients.length,
					campaignId: campaignId || undefined,
					influencers: instagramRecipients.map(r => ({
						influencerId: r.influencer._id || getInfluencerKey(r.influencer),
						name: r.influencer.display_name,
						profileUrl: r.influencer.profile_url
					}))
				})
			});
		} catch (error) {
			console.error('Failed to track Instagram outreach:', error);
		}
		await onLoadContactedInfluencers();
		const immediateOpens = Math.min(5, instagramRecipients.length);
		for (let i = 0; i < immediateOpens; i++) {
			const url = instagramRecipients[i]?.influencer.profile_url;
			if (url) {
				window.open(url, '_blank');
			}
		}
		for (let i = immediateOpens; i < instagramRecipients.length; i++) {
			const url = instagramRecipients[i]?.influencer.profile_url;
			if (url) {
				const link = document.createElement('a');
				link.href = url;
				link.target = '_blank';
				link.rel = 'noopener noreferrer';
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				if (i < instagramRecipients.length - 1) {
					await new Promise(resolve => setTimeout(resolve, 50));
				}
			}
		}
	}
	
	async function handleSendTikTok() {
		const tiktokRecipients = reviewData.filter(r => r.methods.includes('tiktok'));
		try {
			await fetch('/api/outreach/track', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					platform: 'tiktok',
					count: tiktokRecipients.length,
					campaignId: campaignId || undefined,
					influencers: tiktokRecipients.map(r => ({
						influencerId: r.influencer._id || getInfluencerKey(r.influencer),
						name: r.influencer.display_name,
						profileUrl: r.influencer.profile_url
					}))
				})
			});
		} catch (error) {
			console.error('Failed to track TikTok outreach:', error);
		}
		await onLoadContactedInfluencers();
		const immediateOpens = Math.min(5, tiktokRecipients.length);
		for (let i = 0; i < immediateOpens; i++) {
			const url = tiktokRecipients[i]?.influencer.profile_url;
			if (url) {
				window.open(url, '_blank');
			}
		}
		for (let i = immediateOpens; i < tiktokRecipients.length; i++) {
			const url = tiktokRecipients[i]?.influencer.profile_url;
			if (url) {
				const link = document.createElement('a');
				link.href = url;
				link.target = '_blank';
				link.rel = 'noopener noreferrer';
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				if (i < tiktokRecipients.length - 1) {
					await new Promise(resolve => setTimeout(resolve, 50));
				}
			}
		}
	}
</script>

<div class="h-full flex flex-col">
	<!-- Content Area -->
	<div class="flex-1 overflow-hidden relative min-h-0">
	<SelectMethodsSlide
		active={currentStage === 'select-methods'}
	>
		<SelectContactMethods
			influencers={influencers}
			gmailConnections={gmailConnections}
			selectedMethods={selectedMethods}
			selectedEmailAccounts={selectedEmailAccounts}
			availableMethodCounts={availableMethodCounts}
			getInfluencerKey={getInfluencerKey}
			getSelectedMethods={getSelectedMethods}
			isMethodSelected={isMethodSelected}
			getSelectedEmailAccount={getSelectedEmailAccount}
			hasEmail={hasEmail}
			areAllSelectedForMethod={areAllSelectedForMethod}
			getMethodIcon={getMethodIcon}
			getPlatformLogo={getPlatformLogo}
			getPlatformColor={getPlatformColor}
			onToggleMethod={onToggleMethod}
			onSetEmailAccount={onSetEmailAccount}
			onEvenlyAssignEmailAccounts={onEvenlyAssignEmailAccounts}
			onSelectAllForMethod={onSelectAllForMethod}
			{navigationDirection}
		/>
	</SelectMethodsSlide>

	<DraftMessagesSlide
		active={currentStage === 'draft-messages'}
	>
		<DraftMessages
			editingPlatform={editingPlatform}
			messageContents={messageContents}
			navigationValidationErrors={navigationValidationErrors}
			gmailConnected={gmailConnected}
			campaignId={campaignId}
			isDrafting={isDrafting}
			isQuickDrafting={isQuickDrafting}
			quickDraftError={quickDraftError}
			hasContactMethodSelected={hasContactMethodSelected}
			getRecipientCount={getRecipientCount}
			getMethodIcon={getMethodIcon}
			onEditingPlatformChange={onEditingPlatformChange}
			onUpdateMessageContent={onUpdateMessageContent}
			onSaveOutreachState={onSaveOutreachState}
			onQuickDraft={onQuickDraft}
			onOpenDraftModal={onOpenDraftModal}
			onOpenFooterModal={onOpenFooterModal}
			onConnectGmail={onConnectGmail}
			{navigationDirection}
		/>
	</DraftMessagesSlide>

	<ReviewInfoSlide
		active={currentStage === 'review-info'}
	>
		<ReviewInfo {navigationDirection} />
	</ReviewInfoSlide>

	<ReviewSlide
		active={currentStage === 'review'}
	>
		<ReviewStage
			reviewData={reviewData}
			reviewCounts={reviewCounts}
			gmailConnections={gmailConnections}
			isCreatingDrafts={isCreatingDrafts}
			createDraftSuccess={createDraftSuccess}
			createDraftError={createDraftError}
			campaignId={campaignId}
			getInfluencerKey={getInfluencerKey}
			getMethodIcon={getMethodIcon}
			getMethodLabel={getMethodLabel}
			onCreateDrafts={onCreateDrafts}
			onLoadContactedInfluencers={onLoadContactedInfluencers}
			onPreviewEmail={onPreviewEmail}
			onPreviewMessage={onPreviewMessage}
			{navigationDirection}
		/>
	</ReviewSlide>
	</div>

	<!-- Unified Bottom Bar -->
	<OutreachNavigationBar
		currentStage={currentStage}
		currentStageIndex={currentStageIndex}
		canProceedToDraft={canProceedToDraft}
		onBack={() => {
			if (currentStage === 'draft-messages') {
				goBackToSelectMethods();
			} else if (currentStage === 'review-info') {
				goBackToDraft();
			} else if (currentStage === 'review') {
				goBackToReviewInfo();
			}
		}}
		onNext={() => {
			if (currentStage === 'select-methods') {
				goToDraftStage();
			} else if (currentStage === 'draft-messages') {
				goToReviewInfoStage();
			} else if (currentStage === 'review-info') {
				goToReviewStage();
			}
		}}
	/>
</div>
