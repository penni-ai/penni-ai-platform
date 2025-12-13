import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export type Theme = 'light' | 'dark' | 'system';

function getSystemTheme(): 'light' | 'dark' {
  if (!browser) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  if (!browser) return;

  const resolved = theme === 'system' ? getSystemTheme() : theme;
  document.documentElement.setAttribute('data-theme', resolved);
}

function createThemeStore() {
  const stored = browser ? (localStorage.getItem('theme') as Theme | null) : null;
  const initial: Theme = stored || 'system';

  const { subscribe, set, update } = writable<Theme>(initial);

  // Apply initial theme
  if (browser) {
    applyTheme(initial);
  }

  return {
    subscribe,
    set: (theme: Theme) => {
      if (browser) {
        localStorage.setItem('theme', theme);
        applyTheme(theme);
      }
      set(theme);
    },
    toggle: () => {
      update(current => {
        const resolved = current === 'system' ? getSystemTheme() : current;
        const next: Theme = resolved === 'dark' ? 'light' : 'dark';
        if (browser) {
          localStorage.setItem('theme', next);
          applyTheme(next);
        }
        return next;
      });
    },
    init: () => {
      if (!browser) return;

      // Apply stored theme
      const stored = localStorage.getItem('theme') as Theme | null;
      const theme = stored || 'system';
      applyTheme(theme);
      set(theme);

      // Listen for system preference changes
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        const current = get({ subscribe });
        if (current === 'system') {
          applyTheme('system');
        }
      });
    }
  };
}

export const theme = createThemeStore();
