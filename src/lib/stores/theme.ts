import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export type Theme = 'light' | 'dark' | 'mixed';

const DEFAULT_THEME: Theme = 'mixed';

function getStoredTheme(): Theme {
  if (!browser) return DEFAULT_THEME;
  return (localStorage.getItem('theme') as Theme | null) || DEFAULT_THEME;
}

function applyTheme(theme: Theme) {
  if (!browser) return;
  document.documentElement.setAttribute('data-theme', theme);
}

function persistTheme(theme: Theme) {
  if (!browser) return;
  localStorage.setItem('theme', theme);
  applyTheme(theme);
}

function createThemeStore() {
  const { subscribe, set, update } = writable<Theme>(getStoredTheme());

  return {
    subscribe,
    set: (theme: Theme) => {
      persistTheme(theme);
      set(theme);
    },
    toggle: () => {
      update(current => {
        // Cycle through: light -> dark -> mixed -> light
        const next: Theme = current === 'light' ? 'dark' : current === 'dark' ? 'mixed' : 'light';
        persistTheme(next);
        return next;
      });
    },
    // Sync store with localStorage (useful after hydration)
    sync: () => {
      if (!browser) return;
      const stored = getStoredTheme();
      applyTheme(stored);
      set(stored);
    }
  };
}

export const theme = createThemeStore();
