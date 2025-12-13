<script lang="ts">
	import Button from '../Button.svelte';
	import type { Stage } from './types';
	
	interface Props {
		currentStage: Stage;
		currentStageIndex: number;
		canProceedToDraft: () => boolean;
		onBack: () => void;
		onNext: () => void;
	}
	
	let {
		currentStage,
		currentStageIndex,
		canProceedToDraft,
		onBack,
		onNext
	}: Props = $props();
</script>

<div class="px-8 py-4 shrink-0 flex items-center justify-between" style="border-top: 1px solid var(--color-border);">
	<!-- Back Button (Left) -->
	<div class="flex-1 flex justify-start">
		{#if currentStage === 'draft-messages'}
			<Button
				variant="outline"
				onclick={onBack}
			>
				Back
			</Button>
		{:else if currentStage === 'review-info'}
			<Button
				variant="outline"
				onclick={onBack}
			>
				Back
			</Button>
		{:else if currentStage === 'review'}
			<Button
				variant="outline"
				onclick={onBack}
			>
				Back
			</Button>
		{/if}
	</div>
	
	<!-- Progress Indicator (Middle) -->
	<div class="flex items-center gap-2">
		<div class="h-2 w-2 rounded-full transition-colors" style="background: {currentStageIndex >= 1 ? 'var(--color-primary)' : 'var(--color-border)'};"></div>
		<div class="h-2 w-2 rounded-full transition-colors" style="background: {currentStageIndex >= 2 ? 'var(--color-primary)' : 'var(--color-border)'};"></div>
		<div class="h-2 w-2 rounded-full transition-colors" style="background: {currentStageIndex >= 3 ? 'var(--color-primary)' : 'var(--color-border)'};"></div>
		<div class="h-2 w-2 rounded-full transition-colors" style="background: {currentStageIndex >= 4 ? 'var(--color-primary)' : 'var(--color-border)'};"></div>
	</div>
	
	<!-- Forward Button (Right) -->
	<div class="flex-1 flex justify-end">
		{#if currentStage === 'select-methods'}
			<Button
				variant="primary"
				disabled={!canProceedToDraft()}
				onclick={onNext}
			>
				Next
			</Button>
		{:else if currentStage === 'draft-messages'}
			<Button
				variant="primary"
				onclick={onNext}
			>
				Next
			</Button>
		{:else if currentStage === 'review-info'}
			<Button
				variant="primary"
				onclick={onNext}
			>
				Next
			</Button>
		{/if}
	</div>
</div>

