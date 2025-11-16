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

<div class="border-t border-gray-200 px-8 py-4 shrink-0 flex items-center justify-between">
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
		<div class="h-2 w-2 rounded-full transition-colors {
			currentStageIndex >= 1 ? 'bg-[#FF6F61]' : 'bg-gray-300'
		}"></div>
		<div class="h-2 w-2 rounded-full transition-colors {
			currentStageIndex >= 2 ? 'bg-[#FF6F61]' : 'bg-gray-300'
		}"></div>
		<div class="h-2 w-2 rounded-full transition-colors {
			currentStageIndex >= 3 ? 'bg-[#FF6F61]' : 'bg-gray-300'
		}"></div>
		<div class="h-2 w-2 rounded-full transition-colors {
			currentStageIndex >= 4 ? 'bg-[#FF6F61]' : 'bg-gray-300'
		}"></div>
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

