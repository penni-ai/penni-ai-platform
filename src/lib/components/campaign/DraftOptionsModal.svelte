<script lang="ts">
  interface Props {
    open: boolean;
    campaignId: string;
    platform: 'email' | 'instagram' | 'tiktok';
    onClose: () => void;
    onDraftGenerated: (content: string) => void;
  }

  let {
    open,
    campaignId,
    platform,
    onClose,
    onDraftGenerated
  }: Props = $props();

  let selectedTone = $state<'friendly' | 'business'>('friendly');
  let customInstructions = $state('');
  let isGenerating = $state(false);
  let error = $state<string | null>(null);

  const maxInstructions = 500;
  const remainingChars = $derived(maxInstructions - customInstructions.length);

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.classList.contains('popup-overlay')) {
      onClose();
    }
  }

  function renderTemplateFromText(text: string): string {
    const paragraphs = text.split(/\n\n+/);
    return paragraphs
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  async function handleGenerate() {
    if (isGenerating) return;

    isGenerating = true;
    error = null;
    let accumulatedText = '';

    try {
      const response = await fetch('/api/outreach/draft/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          tone: selectedTone,
          platform,
          customInstructions: customInstructions.trim() || undefined
        })
      });

      if (!response.ok) {
        throw new Error('Failed to generate draft');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7);
          } else if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);
              if (currentEvent === 'delta' && data.delta) {
                accumulatedText += data.delta;
              } else if (currentEvent === 'error' && data.message) {
                throw new Error(data.message);
              } else if (currentEvent === 'final') {
                // Draft complete
              }
            } catch (parseError) {
              // Skip invalid JSON
            }
          }
        }
      }

      if (accumulatedText) {
        const htmlContent = renderTemplateFromText(accumulatedText);
        onDraftGenerated(htmlContent);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to generate draft';
    } finally {
      isGenerating = false;
    }
  }

  function handleReset() {
    selectedTone = 'friendly';
    customInstructions = '';
    error = null;
  }
</script>

{#if open}
  <div
    class="popup-overlay"
    onclick={handleClickOutside}
    onkeydown={(e) => e.key === 'Escape' && !isGenerating && onClose()}
    role="dialog"
    aria-modal="true"
    aria-labelledby="draft-options-title"
    tabindex="-1"
  >
    <div class="popup-content">
      <div class="popup-header">
        <h3 id="draft-options-title" class="popup-title">Customize Draft</h3>
        <button
          class="close-btn"
          onclick={onClose}
          aria-label="Close"
          disabled={isGenerating}
        >
          ×
        </button>
      </div>

      <div class="popup-body">
        <div class="section">
          <label class="section-label">Tone</label>
          <p class="section-hint">Choose the voice for your message</p>

          <div class="tone-options">
            <button
              type="button"
              class="tone-option"
              class:selected={selectedTone === 'friendly'}
              onclick={() => selectedTone = 'friendly'}
              disabled={isGenerating}
            >
              <div class="tone-radio" class:checked={selectedTone === 'friendly'}></div>
              <div class="tone-content">
                <span class="tone-label">Friendly</span>
                <span class="tone-description">Warm, casual, and personable</span>
              </div>
            </button>

            <button
              type="button"
              class="tone-option"
              class:selected={selectedTone === 'business'}
              onclick={() => selectedTone = 'business'}
              disabled={isGenerating}
            >
              <div class="tone-radio" class:checked={selectedTone === 'business'}></div>
              <div class="tone-content">
                <span class="tone-label">Professional</span>
                <span class="tone-description">Formal, concise, and direct</span>
              </div>
            </button>
          </div>
        </div>

        <div class="section">
          <label for="custom-instructions" class="section-label">
            Custom Instructions
            <span class="optional-badge">Optional</span>
          </label>
          <p class="section-hint">Add specific requirements or context for the AI</p>

          <textarea
            id="custom-instructions"
            class="instructions-textarea"
            bind:value={customInstructions}
            placeholder="e.g., Mention our summer collection launch, include a discount offer, focus on sustainability..."
            maxlength={maxInstructions}
            disabled={isGenerating}
            rows="4"
          ></textarea>

          <div class="char-counter" class:warning={remainingChars < 100} class:error={remainingChars < 20}>
            {remainingChars} characters remaining
          </div>
        </div>

        {#if error}
          <div class="error-message">
            {error}
          </div>
        {/if}

        <div class="popup-footer">
          <button
            type="button"
            class="reset-btn"
            onclick={handleReset}
            disabled={isGenerating}
          >
            Reset
          </button>
          <button
            type="button"
            class="generate-btn"
            onclick={handleGenerate}
            disabled={isGenerating}
          >
            {#if isGenerating}
              <span class="spinner"></span>
              Generating...
            {:else}
              Generate Draft
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .popup-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9998;
    padding: 20px;
  }

  .popup-content {
    background: var(--color-bg-elevated);
    border-radius: 16px;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.15);
    max-width: 480px;
    width: 100%;
    animation: slideIn 0.2s ease-out;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .popup-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    border-bottom: 1px solid var(--color-border);
  }

  .popup-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--color-text);
    margin: 0;
  }

  .close-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: rgba(0, 0, 0, 0.4);
    font-size: 28px;
    line-height: 1;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.05);
    color: rgba(0, 0, 0, 0.7);
  }

  .close-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .popup-body {
    padding: 24px;
  }

  .section {
    margin-bottom: 24px;
  }

  .section:last-of-type {
    margin-bottom: 16px;
  }

  .section-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text);
    margin-bottom: 4px;
  }

  .section-hint {
    font-size: 13px;
    color: var(--color-text-muted);
    margin: 0 0 12px 0;
  }

  .optional-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 6px;
    background: rgba(0, 0, 0, 0.05);
    color: rgba(0, 0, 0, 0.5);
    font-size: 11px;
    font-weight: 500;
    border-radius: 4px;
  }

  .tone-options {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .tone-option {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;
    border-radius: 12px;
    border: 2px solid var(--color-border);
    background: var(--color-bg-elevated);
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
    width: 100%;
  }

  .tone-option:hover:not(:disabled) {
    border-color: rgba(0, 0, 0, 0.15);
    background: rgba(0, 0, 0, 0.02);
  }

  .tone-option.selected {
    border-color: var(--color-primary);
    background: linear-gradient(135deg, rgba(255, 111, 97, 0.06), rgba(255, 138, 128, 0.03));
  }

  .tone-option:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .tone-radio {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid rgba(0, 0, 0, 0.2);
    flex-shrink: 0;
    margin-top: 2px;
    transition: all 0.2s;
    position: relative;
  }

  .tone-radio.checked {
    border-color: var(--color-primary);
  }

  .tone-radio.checked::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-primary);
  }

  .tone-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tone-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text);
  }

  .tone-description {
    font-size: 13px;
    color: var(--color-text-muted);
  }

  .instructions-textarea {
    width: 100%;
    padding: 12px 14px;
    font-size: 14px;
    font-family: inherit;
    line-height: 1.5;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    resize: vertical;
    transition: all 0.2s;
    background: var(--color-bg-elevated);
  }

  .instructions-textarea:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(255, 111, 97, 0.1);
  }

  .instructions-textarea:disabled {
    background: rgba(0, 0, 0, 0.03);
    cursor: not-allowed;
  }

  .instructions-textarea::placeholder {
    color: rgba(0, 0, 0, 0.35);
  }

  .char-counter {
    font-size: 11px;
    color: rgba(0, 0, 0, 0.4);
    text-align: right;
    margin-top: 6px;
  }

  .char-counter.warning {
    color: #d97706;
  }

  .char-counter.error {
    color: #dc2626;
  }

  .error-message {
    padding: 12px 14px;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 10px;
    color: #dc2626;
    font-size: 13px;
    margin-bottom: 16px;
  }

  .popup-footer {
    display: flex;
    gap: 12px;
    padding-top: 16px;
    border-top: 1px solid var(--color-border);
  }

  .reset-btn {
    padding: 12px 20px;
    font-size: 14px;
    font-weight: 500;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-bg-elevated);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: all 0.2s;
  }

  .reset-btn:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.2);
  }

  .reset-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .generate-btn {
    flex: 1;
    padding: 12px 20px;
    font-size: 14px;
    font-weight: 600;
    border-radius: 10px;
    border: none;
    background: var(--color-primary);
    color: white;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 4px 16px rgba(255, 111, 97, 0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .generate-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(255, 111, 97, 0.35);
  }

  .generate-btn:disabled {
    opacity: 0.8;
    cursor: not-allowed;
    transform: none;
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
</style>
