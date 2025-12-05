<script lang="ts">
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
  >
    <div class="popup">
      <div class="header">
        <div class="icon">🌐</div>
        <h1 id="prefill-title" class="title">Let's get started!</h1>
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
            <span class="error-icon">⚠️</span>
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
              Continue →
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
        <p class="footer-text">This helps us understand your brand better and saves you time ⚡</p>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 20px;
  }

  .popup {
    background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%);
    border-radius: 24px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    max-width: 560px;
    width: 100%;
    padding: 48px;
    animation: slideUp 0.3s ease-out;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .header {
    text-align: center;
    margin-bottom: 40px;
  }

  .icon {
    font-size: 64px;
    margin-bottom: 16px;
  }

  .title {
    font-size: 32px;
    font-weight: 700;
    color: #1a1a1a;
    margin: 0 0 12px 0;
    letter-spacing: -0.02em;
  }

  .subtitle {
    font-size: 16px;
    color: rgba(0, 0, 0, 0.6);
    margin: 0;
    line-height: 1.5;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .input-wrapper {
    position: relative;
  }

  .input {
    width: 100%;
    padding: 18px 24px;
    font-size: 16px;
    border: 2px solid rgba(0, 0, 0, 0.1);
    border-radius: 12px;
    outline: none;
    transition: all 0.2s;
    background: white;
    color: #1a1a1a;
  }

  .input:focus {
    border-color: #FF6F61;
    box-shadow: 0 0 0 4px rgba(255, 111, 97, 0.1);
  }

  .input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .input::placeholder {
    color: rgba(0, 0, 0, 0.3);
  }

  .error {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 8px;
    color: #dc2626;
    font-size: 14px;
  }

  .error-icon {
    font-size: 16px;
  }

  .buttons {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 8px;
  }

  .primary-btn {
    padding: 18px 32px;
    font-size: 16px;
    font-weight: 600;
    border: none;
    border-radius: 12px;
    background: linear-gradient(135deg, #FF6F61, #FF8A80);
    color: white;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 4px 20px rgba(255, 111, 97, 0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .primary-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 6px 25px rgba(255, 111, 97, 0.35);
  }

  .primary-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
    transform: none;
  }

  .secondary-btn {
    padding: 14px 24px;
    font-size: 15px;
    font-weight: 500;
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-radius: 10px;
    background: transparent;
    color: rgba(0, 0, 0, 0.6);
    cursor: pointer;
    transition: all 0.2s;
  }

  .secondary-btn:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.2);
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
    margin-top: 32px;
    padding-top: 24px;
    border-top: 1px solid rgba(0, 0, 0, 0.08);
  }

  .footer-text {
    text-align: center;
    font-size: 13px;
    color: rgba(0, 0, 0, 0.4);
    margin: 0;
  }
</style>
