<script lang="ts">
	import { theme, type Theme } from '$lib/stores/theme';

	interface ThemeOption {
		value: Theme;
		label: string;
	}

	const options: ThemeOption[] = [
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' },
		{ value: 'mixed', label: 'Mixed' }
	];

	let currentTheme: Theme = $state('mixed');

	$effect(() => {
		const unsubscribe = theme.subscribe((value) => {
			currentTheme = value;
		});

		return () => unsubscribe();
	});

	function handleThemeChange(newTheme: Theme) {
		theme.set(newTheme);
	}
</script>

<div class="theme-toggle">
	{#each options as option}
		<button
			class="theme-option"
			class:active={currentTheme === option.value}
			onclick={() => handleThemeChange(option.value)}
			title={option.label}
			type="button"
		>
			{#if option.value === 'light'}
				<!-- Sun icon for light mode -->
				<svg class="theme-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<circle cx="12" cy="12" r="4" stroke-width="1.5" />
					<path stroke-linecap="round" stroke-width="1.5" d="M12 2v2m0 16v2M4 12H2m4.314-5.686L4.9 4.9m12.786 1.414L19.1 4.9M6.314 17.686L4.9 19.1m12.786-1.414L19.1 19.1M22 12h-2" />
				</svg>
			{:else if option.value === 'dark'}
				<!-- Moon icon for dark mode -->
				<svg class="theme-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" />
				</svg>
			{:else}
				<!-- Split circle icon for mixed mode -->
				<svg class="theme-icon" fill="none" viewBox="0 0 24 24">
					<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5" />
					<path d="M12 3a9 9 0 010 18V3z" fill="currentColor" />
				</svg>
			{/if}
			<span class="theme-label">{option.label}</span>
		</button>
	{/each}
</div>

<style>
	.theme-toggle {
		display: flex;
		gap: 0;
		background-color: var(--color-bg-subtle);
		border: 1px solid var(--color-border);
		border-radius: 2px;
		padding: 0.1875rem;
	}

	.theme-option {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.625rem;
		border: none;
		background: transparent;
		border-radius: 1px;
		cursor: pointer;
		transition: all 0.15s ease;
		color: var(--color-text-muted);
		font-family: var(--font-body, 'DM Sans', sans-serif);
		font-size: 0.75rem;
	}

	.theme-option:hover {
		color: var(--color-text);
	}

	.theme-option.active {
		background-color: var(--color-bg-elevated);
		color: var(--color-text);
	}

	.theme-icon {
		width: 0.875rem;
		height: 0.875rem;
		flex-shrink: 0;
	}

	.theme-label {
		font-weight: 500;
		letter-spacing: 0.01em;
	}

	/* Compact variant - applied via parent class */
	:global(.theme-toggle-compact) .theme-label {
		display: none;
	}

	:global(.theme-toggle-compact) .theme-option {
		padding: 0.375rem;
	}

	/* Dark mode */
	[data-theme='dark'] .theme-toggle {
		background-color: var(--color-bg-subtle);
		border-color: var(--color-border);
	}

	[data-theme='dark'] .theme-option.active {
		background-color: var(--color-bg-elevated);
	}

	/* Mixed mode */
	[data-theme='mixed'] .theme-toggle {
		background-color: var(--color-bg-subtle);
		border-color: var(--color-border);
	}

	[data-theme='mixed'] .theme-option.active {
		background-color: var(--color-bg-elevated);
	}
</style>
