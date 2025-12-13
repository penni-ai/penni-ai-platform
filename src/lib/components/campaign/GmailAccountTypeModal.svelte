<script lang="ts">
  import { fly, fade } from 'svelte/transition';

  interface Props {
    open: boolean;
    onSelect: (type: 'draft' | 'send') => void;
    onCancel: () => void;
  }

  let { open, onSelect, onCancel }: Props = $props();
</script>

{#if open}
  <div
    class="modal-overlay"
    onclick={(e) => {
      if (e.target === e.currentTarget) onCancel();
    }}
    onkeydown={(e) => e.key === 'Escape' && onCancel()}
    role="dialog"
    aria-modal="true"
    aria-labelledby="gmail-type-title"
    tabindex="-1"
    transition:fade={{ duration: 200 }}
  >
    <div class="modal-content" transition:fly={{ y: 20, duration: 300 }}>
      <button
        type="button"
        class="close-btn"
        onclick={onCancel}
        aria-label="Close"
      >
        <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <h2 id="gmail-type-title" class="modal-title">Connect Gmail Account</h2>
      <p class="modal-description">Choose how you want to send outreach emails:</p>

      <div class="options-container">
        <!-- Draft Mode -->
        <button
          type="button"
          class="option-card"
          onclick={() => onSelect('draft')}
        >
          <div class="option-icon draft">
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <div class="option-content">
            <h3 class="option-title">Draft Mode</h3>
            <p class="option-description">
              Creates drafts in your Gmail account for you to review and send manually.
            </p>
            <span class="option-badge recommended">Recommended</span>
          </div>
        </button>

        <!-- Send Mode -->
        <button
          type="button"
          class="option-card"
          onclick={() => onSelect('send')}
        >
          <div class="option-icon send">
            <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </div>
          <div class="option-content">
            <h3 class="option-title">Send Mode</h3>
            <p class="option-description">
              Sends emails directly from your Gmail account. Emails are sent immediately.
            </p>
            <span class="option-badge warning">Sends immediately</span>
          </div>
        </button>
      </div>

      <p class="modal-note">
        You can change this later in your Gmail settings.
      </p>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: var(--color-bg-overlay);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 20px;
  }

  .modal-content {
    background: var(--color-bg-elevated);
    border-radius: 20px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
    max-width: 480px;
    width: 100%;
    padding: 28px;
    position: relative;
  }

  .close-btn {
    position: absolute;
    top: 16px;
    right: 16px;
    padding: 8px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: rgba(0, 0, 0, 0.05);
    color: var(--color-text-secondary);
  }

  .modal-title {
    font-size: 22px;
    font-weight: 700;
    color: var(--color-text);
    margin: 0 0 8px 0;
  }

  .modal-description {
    font-size: 15px;
    color: var(--color-text-secondary);
    margin: 0 0 24px 0;
  }

  .options-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 20px;
  }

  .option-card {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 16px;
    border: 2px solid var(--color-border);
    border-radius: 14px;
    background: var(--color-bg-elevated);
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
    width: 100%;
  }

  .option-card:hover {
    border-color: var(--color-primary);
    box-shadow: 0 4px 16px rgba(255, 111, 97, 0.15);
    transform: translateY(-1px);
  }

  .option-icon {
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .option-icon.draft {
    background: linear-gradient(135deg, #3b82f6, #60a5fa);
    color: white;
  }

  .option-icon.send {
    background: linear-gradient(135deg, #10b981, #34d399);
    color: white;
  }

  .option-content {
    flex: 1;
  }

  .option-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--color-text);
    margin: 0 0 4px 0;
  }

  .option-description {
    font-size: 13px;
    color: var(--color-text-secondary);
    margin: 0 0 8px 0;
    line-height: 1.4;
  }

  .option-badge {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .option-badge.recommended {
    background: rgba(59, 130, 246, 0.1);
    color: #3b82f6;
  }

  .option-badge.warning {
    background: rgba(245, 158, 11, 0.1);
    color: #d97706;
  }

  .modal-note {
    font-size: 12px;
    color: var(--color-text-muted);
    text-align: center;
    margin: 0;
  }
</style>
