<script lang="ts">
	interface Props {
		progress: number;
		showDebug?: boolean;
		toggleDebug?: () => void;
	}

	let { progress, showDebug = false, toggleDebug }: Props = $props();
</script>

<div class="border-t border-gray-200 bg-white px-6 py-3 relative">
	<div class="mx-auto w-full max-w-3xl">
		<div class="mb-1 flex items-center justify-between text-xs">
			<span class="font-medium text-gray-600">Campaign Setup Progress</span>
			<span class="text-gray-500">{progress}%</span>
		</div>
		<div class="h-2 w-full overflow-hidden rounded-full bg-gray-100">
			<div
				class="h-full bg-[#FF6F61] transition-all duration-300 ease-out"
				style="width: {progress}%"
			></div>
		</div>
	</div>
	<!-- Debug Button (bottom left) -->
	{#if showDebug !== undefined}
		<button
			type="button"
			onclick={toggleDebug}
			class="absolute bottom-2 left-6 px-2 py-1 text-[10px] font-mono text-gray-400 hover:text-gray-600 transition-colors"
			title="Toggle debug mode"
		>
			DEBUG
		</button>
	{/if}
</div>

