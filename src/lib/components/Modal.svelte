<script lang="ts">
  import { fly, fade } from 'svelte/transition';

  interface Props {
    open: boolean;
    title?: string;
    onClose: () => void;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    dismissible?: boolean;
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
    centerContent?: boolean;
  }

  let {
    open = false,
    title,
    onClose,
    size = 'md',
    dismissible = true,
    closeOnBackdrop = true,
    closeOnEscape = true,
    centerContent = false
  }: Props = $props();

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl'
  };

  function handleBackdropClick(e: MouseEvent) {
    if (closeOnBackdrop && dismissible && e.target === e.currentTarget) {
      onClose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (closeOnEscape && dismissible && e.key === 'Escape') {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <div
    class="modal-backdrop"
    onclick={handleBackdropClick}
    transition:fade={{ duration: 200 }}
    role="dialog"
    aria-modal="true"
    aria-labelledby={title ? 'modal-title' : undefined}
    tabindex="-1"
  >
    <div
      class="modal-content {sizes[size]}"
      class:center-content={centerContent}
      transition:fly={{ y: 20, duration: 300 }}
    >
      {#if title || dismissible}
        <div class="modal-header">
          {#if title}
            <h2 id="modal-title" class="modal-title">{title}</h2>
          {:else}
            <div></div>
          {/if}
          {#if dismissible}
            <button
              type="button"
              onclick={onClose}
              class="modal-close"
              aria-label="Close modal"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          {/if}
        </div>
      {/if}
      <div class="modal-body">
        <slot />
      </div>
      {#if $$slots.footer}
        <div class="modal-footer">
          <slot name="footer" />
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
    padding: 1rem;
  }

  .modal-content {
    position: relative;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    border-radius: 20px;
    background: white;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  }

  .modal-content.center-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem 1.75rem;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    position: sticky;
    top: 0;
    background: white;
    z-index: 1;
  }

  .modal-title {
    font-size: 1.375rem;
    font-weight: 700;
    color: #1a1a1a;
    margin: 0;
  }

  .modal-close {
    padding: 0.5rem;
    border-radius: 8px;
    color: rgba(0, 0, 0, 0.4);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
  }

  .modal-close:hover {
    color: rgba(0, 0, 0, 0.7);
    background: rgba(0, 0, 0, 0.05);
  }

  .modal-body {
    padding: 1.5rem 1.75rem;
  }

  .modal-footer {
    padding: 1rem 1.75rem;
    border-top: 1px solid rgba(0, 0, 0, 0.08);
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
  }

  /* Responsive adjustments */
  @media (max-width: 640px) {
    .modal-backdrop {
      padding: 0.5rem;
    }

    .modal-content {
      max-height: 95vh;
      border-radius: 16px;
    }

    .modal-header,
    .modal-body,
    .modal-footer {
      padding-left: 1.25rem;
      padding-right: 1.25rem;
    }

    .modal-title {
      font-size: 1.125rem;
    }
  }
</style>
