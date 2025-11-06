<script lang="ts">
	interface Props {
		size?: 'sm' | 'md' | 'lg';
	}

	let { size = 'md' }: Props = $props();

const sizeStyles = {
	sm: 'h-6',
	md: 'h-8',
	lg: 'h-12'
};

const widthStyles = {
	sm: 'w-auto',
	md: 'w-auto',
	lg: 'w-auto'
};
</script>

<div class="flex items-center gap-2">
	<img
		src="/images/branding/penny-logo.png"
		alt="Penny logo"
		class={`${widthStyles[size]} ${sizeStyles[size]} object-contain`}
		loading="lazy"
	/>
</div>
