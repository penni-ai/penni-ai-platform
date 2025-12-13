<script lang="ts">
  import { theme, type Theme } from '$lib/stores/theme';

  interface ThemeOption {
    value: Theme;
    label: string;
    icon: string;
  }

  const options: ThemeOption[] = [
    { value: 'light', label: 'Light', icon: '☀️' },
    { value: 'dark', label: 'Dark', icon: '🌙' },
    { value: 'system', label: 'System', icon: '💻' }
  ];

  let currentTheme: Theme = $state('system');

  $effect(() => {
    const unsubscribe = theme.subscribe(value => {
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
      <span class="icon">{option.icon}</span>
      <span class="label">{option.label}</span>
    </button>
  {/each}
</div>

<style>
  .theme-toggle {
    display: flex;
    gap: 4px;
    padding: 4px;
    background: rgb(248 250 252);
    border-radius: 12px;
    border: 1px solid rgb(226 232 240);
  }

  .theme-option {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border: none;
    background: transparent;
    border-radius: 8px;
    cursor: pointer;
    transition: all 150ms ease;
    color: rgb(100 116 139);
    font-size: 13px;
    font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .theme-option:hover {
    background: white;
    color: rgb(15 23 42);
  }

  .theme-option.active {
    background: white;
    color: rgb(15 23 42);
    box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  }

  .icon {
    font-size: 14px;
  }

  .label {
    font-weight: 500;
  }

  /* Dark mode styles */
  :global([data-theme="dark"]) .theme-toggle {
    background: rgb(30 41 59);
    border-color: rgb(51 65 85);
  }

  :global([data-theme="dark"]) .theme-option {
    color: rgb(148 163 184);
  }

  :global([data-theme="dark"]) .theme-option:hover {
    background: rgb(51 65 85);
    color: rgb(241 245 249);
  }

  :global([data-theme="dark"]) .theme-option.active {
    background: rgb(51 65 85);
    color: rgb(241 245 249);
    box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.3);
  }

  /* Compact variant */
  :global(.theme-toggle-compact) .label {
    display: none;
  }

  :global(.theme-toggle-compact) .theme-option {
    padding: 8px;
  }
</style>
