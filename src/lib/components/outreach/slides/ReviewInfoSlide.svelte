<script lang="ts">
	export let active: boolean;
	export let className = '';
</script>

	{#if active}
	<div class={`h-full flex items-center justify-center px-8 py-12 ${className}`}>
		<slot />
	</div>
{/if}
