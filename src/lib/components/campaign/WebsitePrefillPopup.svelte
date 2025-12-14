<script lang="ts">
  import { fly, fade } from 'svelte/transition';

  interface Props {
    open: boolean;
    onSubmit: (websiteUrl: string) => Promise<void>;
    onSkip: () => void;
  }

  let { open, onSubmit, onSkip }: Props = $props();

  let websiteUrl = $state('');
  let isSubmitting = $state(false);
  let error = $state<string | null>(null);

  async function handleSubmit(e: Event) {
    e.preventDefault();

    if (!websiteUrl.trim()) {
      error = 'Please enter a website URL';
      return;
    }

    // Basic URL validation
    try {
      new URL(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`);
    } catch {
      error = 'Please enter a valid website URL';
      return;
    }

    error = null;
    isSubmitting = true;

    try {
      const normalizedUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
      await onSubmit(normalizedUrl);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to fetch website information';
      isSubmitting = false;
    }
  }

  function handleSkip() {
    onSkip();
  }
</script>

{#if open}
  <div
    class="overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="prefill-title"
    transition:fade={{ duration: 200 }}
  >
    <div class="popup" transition:fly={{ y: 20, duration: 300 }}>
      <div class="header">
        <h1 id="prefill-title" class="title">Let's get started</h1>
        <p class="subtitle">Enter your website URL and we'll automatically fill in your brand details</p>
      </div>

      <form onsubmit={handleSubmit} class="form">
        <div class="input-wrapper">
          <input
            type="text"
            class="input"
            bind:value={websiteUrl}
            placeholder="yourwebsite.com"
            disabled={isSubmitting}
          />
        </div>

        {#if error}
          <div class="error">
            {error}
          </div>
        {/if}

        <div class="buttons">
          <button
            type="submit"
            class="primary-btn"
            disabled={isSubmitting}
          >
            {#if isSubmitting}
              <span class="spinner"></span>
              Analyzing website...
            {:else}
              Continue
            {/if}
          </button>

          <button
            type="button"
            class="secondary-btn"
            onclick={handleSkip}
            disabled={isSubmitting}
          >
            I don't have a website
          </button>
        </div>
      </form>

      <div class="footer">
        <p class="footer-text">This helps us understand your brand better and saves you time</p>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
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

  .popup {
    background: var(--color-bg-elevated);
    border-radius: 0;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.2);
    max-width: 520px;
    width: 100%;
    padding: 56px;
  }

  .header {
    text-align: center;
    margin-bottom: 48px;
  }

  .title {
    font-family: 'Instrument Serif', Georgia, serif;
    font-size: 36px;
    font-weight: 400;
    color: var(--color-text);
    margin: 0 0 16px 0;
    letter-spacing: -0.02em;
    line-height: 1.1;
  }

  .subtitle {
    font-size: 16px;
    color: var(--color-text-secondary);
    margin: 0;
    line-height: 1.6;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .input-wrapper {
    position: relative;
  }

  .input {
    width: 100%;
    padding: 20px 0;
    font-size: 18px;
    border: none;
    border-bottom: 2px solid var(--color-border);
    outline: none;
    transition: border-color 0.2s;
    background: transparent;
    color: var(--color-text);
  }

  .input:focus {
    border-bottom-color: #FF6F61;
  }

  .input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .input::placeholder {
    color: var(--color-text-muted);
  }

  .error {
    padding: 16px;
    background: transparent;
    border-left: 3px solid #dc2626;
    color: #dc2626;
    font-size: 14px;
  }

  .buttons {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 16px;
  }

  .primary-btn {
    padding: 18px 32px;
    font-size: 15px;
    font-weight: 500;
    letter-spacing: 0.02em;
    border: none;
    background: #FF6F61;
    color: white;
    cursor: pointer;
    transition: background 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }

  .primary-btn:hover:not(:disabled) {
    background: #E85A4F;
  }

  .primary-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .secondary-btn {
    padding: 16px 24px;
    font-size: 14px;
    font-weight: 500;
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: color 0.2s;
  }

  .secondary-btn:hover:not(:disabled) {
    color: var(--color-text);
  }

  .secondary-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .footer {
    margin-top: 48px;
    padding-top: 32px;
    border-top: 1px solid var(--color-border);
  }

  .footer-text {
    text-align: center;
    font-size: 13px;
    color: var(--color-text-muted);
    margin: 0;
  }
</style>
