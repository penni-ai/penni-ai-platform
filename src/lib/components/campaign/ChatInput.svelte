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
	
	// Sync from parent when draft prop changes
	$effect(() => {
		localDraft = draft;
	});

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		localDraft = target.value;
		if (onDraftChange) {
			onDraftChange(localDraft);
		}
	}

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const message = localDraft.trim();
		if (message && !disabled) {
			onSubmit(message);
			localDraft = '';
			if (onDraftChange) {
				onDraftChange('');
			}
		}
	}
</script>

{#if show}
	<div class="border-t border-gray-100 bg-white px-6 py-4" transition:fade={{ duration: 300 }}>
		<form class="mx-auto flex w-full max-w-3xl items-center gap-3" onsubmit={handleSubmit}>
			<input
				type="text"
				class="flex-1 border-b border-gray-200 bg-transparent px-2 py-3 text-sm placeholder:text-gray-400 focus:border-[#FF6F61] focus:outline-none transition-colors"
				placeholder="Type your reply..."
				value={localDraft}
				oninput={handleInput}
				autocomplete="off"
				disabled={disabled}
			/>
			<Button type="submit" variant="primary" size="md" disabled={localDraft.trim().length === 0 || disabled}>
				Send
			</Button>
		</form>
	</div>
{/if}

