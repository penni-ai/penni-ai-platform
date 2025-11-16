<script lang="ts">
	export let active: boolean;
	export let className = '';
</script>

	{#if active}
	<div class={`h-full flex flex-col ${className}`}>
		<slot />
	</div>
{/if}
