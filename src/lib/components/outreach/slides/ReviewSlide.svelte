<script lang="ts">
	export let active: boolean;
	export let className = '';
</script>

	{#if active}
	<div class={`h-full flex ${className}`}>
		<slot />
	</div>
{/if}
