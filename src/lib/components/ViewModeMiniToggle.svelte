<script lang="ts">
  import type { ViewMode } from '$lib/stores/viewMode';
  import { setViewMode, viewMode as viewModeStore } from '$lib/stores/viewMode';

  let current = $state<ViewMode>('advanced');

  const unsubscribe = viewModeStore.subscribe((mode) => {
    current = mode;
  });

  $effect(() => () => unsubscribe());

  function toggle(mode: ViewMode) {
    if (mode === current) return;
    setViewMode(mode);
  }
</script>

<div class="inline-flex rounded-full border border-gray-200 bg-white shadow-sm overflow-hidden">
  <button
    type="button"
    class={`px-2 py-1 text-[11px] font-medium tracking-wide transition ${current === 'simple' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
    aria-pressed={current === 'simple'}
    aria-label="Switch to simple view"
    onclick={() => toggle('simple')}
  >
    S
  </button>
  <button
    type="button"
    class={`px-2 py-1 text-[11px] font-medium tracking-wide transition ${current === 'advanced' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
    aria-pressed={current === 'advanced'}
    aria-label="Switch to advanced view"
    onclick={() => toggle('advanced')}
  >
    A
  </button>
</div>
