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
        <svg class="close-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <h2 id="gmail-type-title" class="modal-title">Connect Gmail Account</h2>
      <p class="modal-description">Choose how you want to send outreach emails</p>

      <div class="options-container">
        <!-- Draft Mode -->
        <button
          type="button"
          class="option-card"
          onclick={() => onSelect('draft')}
        >
          <div class="option-header">
            <h3 class="option-title">Draft Mode</h3>
            <span class="option-badge recommended">Recommended</span>
          </div>
          <p class="option-description">
            Creates drafts in your Gmail account for you to review and send manually.
          </p>
        </button>

        <!-- Send Mode -->
        <button
          type="button"
          class="option-card"
          onclick={() => onSelect('send')}
        >
          <div class="option-header">
            <h3 class="option-title">Send Mode</h3>
            <span class="option-badge warning">Sends immediately</span>
          </div>
          <p class="option-description">
            Sends emails directly from your Gmail account. Emails are sent immediately.
          </p>
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
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 24px;
  }

  .modal-content {
    background: var(--color-bg-elevated);
    border-radius: 0;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.2);
    max-width: 480px;
    width: 100%;
    padding: 48px;
    position: relative;
  }

  .close-btn {
    position: absolute;
    top: 24px;
    right: 24px;
    padding: 8px;
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: color 0.2s;
  }

  .close-btn:hover {
    color: var(--color-text);
  }

  .close-icon {
    width: 20px;
    height: 20px;
  }

  .modal-title {
    font-family: 'Instrument Serif', Georgia, serif;
    font-size: 28px;
    font-weight: 400;
    color: var(--color-text);
    margin: 0 0 8px 0;
    letter-spacing: -0.01em;
  }

  .modal-description {
    font-size: 15px;
    color: var(--color-text-secondary);
    margin: 0 0 32px 0;
    line-height: 1.5;
  }

  .options-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 32px;
  }

  .option-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 24px;
    border: none;
    border-bottom: 2px solid var(--color-border);
    background: transparent;
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
    width: 100%;
  }

  .option-card:hover {
    border-bottom-color: #FF6F61;
    background: rgba(255, 111, 97, 0.03);
  }

  .option-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .option-title {
    font-family: 'Instrument Serif', Georgia, serif;
    font-size: 18px;
    font-weight: 400;
    color: var(--color-text);
    margin: 0;
  }

  .option-description {
    font-size: 14px;
    color: var(--color-text-secondary);
    margin: 0;
    line-height: 1.5;
  }

  .option-badge {
    display: inline-block;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .option-badge.recommended {
    background: rgba(255, 111, 97, 0.1);
    color: #FF6F61;
  }

  .option-badge.warning {
    background: rgba(245, 158, 11, 0.1);
    color: #d97706;
  }

  .modal-note {
    font-size: 13px;
    color: var(--color-text-muted);
    text-align: center;
    margin: 0;
    padding-top: 24px;
    border-top: 1px solid var(--color-border);
  }
</style>
