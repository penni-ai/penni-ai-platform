<script lang="ts">
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

	const stages = ['Select', 'Draft', 'Info', 'Review'];
</script>

<div class="px-8 py-4 shrink-0 flex items-center justify-between" style="border-top: 1px solid var(--color-border);">
	<!-- Back Button (Left) -->
	<div class="flex-1 flex justify-start">
		{#if currentStage !== 'select-methods'}
			<button
				type="button"
				onclick={onBack}
				class="px-5 py-2 text-sm font-medium transition-colors"
				style="color: var(--color-text-secondary); border-bottom: 1px solid var(--color-border);"
				onmouseenter={(e) => {
					e.currentTarget.style.color = 'var(--color-text)';
					e.currentTarget.style.borderColor = 'var(--color-text)';
				}}
				onmouseleave={(e) => {
					e.currentTarget.style.color = 'var(--color-text-secondary)';
					e.currentTarget.style.borderColor = 'var(--color-border)';
				}}
			>
				Back
			</button>
		{/if}
	</div>

	<!-- Progress Indicator (Middle) -->
	<div class="flex items-center gap-6">
		{#each stages as stage, i}
			{@const isActive = currentStageIndex === i + 1}
			{@const isCompleted = currentStageIndex > i + 1}
			<div class="flex items-center gap-2">
				<span
					class="text-xs font-medium transition-colors"
					style="color: {isActive ? 'var(--color-primary)' : isCompleted ? 'var(--color-text)' : 'var(--color-text-muted)'};"
				>
					{stage}
				</span>
				{#if i < stages.length - 1}
					<div
						class="w-8 h-px"
						style="background: {isCompleted ? 'var(--color-primary)' : 'var(--color-border)'};"
					></div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Forward Button (Right) -->
	<div class="flex-1 flex justify-end">
		{#if currentStage !== 'review'}
			<button
				type="button"
				disabled={currentStage === 'select-methods' && !canProceedToDraft()}
				onclick={onNext}
				class="px-5 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
				style="background: var(--color-primary); color: white;"
				onmouseenter={(e) => {
					if (!e.currentTarget.disabled) {
						e.currentTarget.style.opacity = '0.9';
					}
				}}
				onmouseleave={(e) => {
					e.currentTarget.style.opacity = '1';
				}}
			>
				Continue
			</button>
		{/if}
	</div>
</div>
