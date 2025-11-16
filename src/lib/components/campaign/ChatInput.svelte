<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import { fade } from 'svelte/transition';

	interface Props {
		draft: string;
		disabled: boolean;
		show?: boolean;
		onSubmit: (message: string) => void;
		onDraftChange?: (value: string) => void;
	}

	let { draft, disabled, show = true, onSubmit, onDraftChange }: Props = $props();
	
	let localDraft = $state(draft);
	let lastDraft = $state(draft);
	
	// Sync from parent when draft prop changes
	$effect(() => {
		if (draft !== lastDraft) {
			localDraft = draft;
			lastDraft = draft;
		}
	});
	
	// Notify parent when local draft changes (but avoid loops)
	$effect(() => {
		if (onDraftChange && localDraft !== lastDraft) {
			lastDraft = localDraft;
			onDraftChange(localDraft);
		}
	});

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const message = localDraft.trim();
		if (message && !disabled) {
			onSubmit(message);
			localDraft = '';
		}
	}
</script>

{#if show}
	<div class="border-t border-gray-200 bg-white px-6 py-5" transition:fade={{ duration: 300 }}>
		<form class="mx-auto flex w-full max-w-3xl items-center gap-3" onsubmit={handleSubmit}>
			<input
				type="text"
				class="flex-1 rounded-full border border-gray-300 px-5 py-3 text-sm shadow-sm focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10"
				placeholder="Type your reply..."
				bind:value={localDraft}
				autocomplete="off"
				disabled={disabled}
			/>
			<Button type="submit" variant="primary" size="md" disabled={localDraft.trim().length === 0 || disabled}>
				Send
			</Button>
		</form>
	</div>
{/if}

