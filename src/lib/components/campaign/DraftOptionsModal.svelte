<script lang="ts">
  import { fly, fade } from 'svelte/transition';

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
    transition:fade={{ duration: 200 }}
  >
    <div class="popup-content" transition:fly={{ y: 20, duration: 300 }}>
      <div class="popup-header">
        <h3 id="draft-options-title" class="popup-title">Customize Draft</h3>
        <button
          class="close-btn"
          onclick={onClose}
          aria-label="Close"
          disabled={isGenerating}
        >
          <svg class="close-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="popup-body">
        <div class="section">
          <span id="tone-label" class="section-label">Tone</span>
          <p class="section-hint">Choose the voice for your message</p>

          <div class="tone-options" role="group" aria-labelledby="tone-label">
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
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9998;
    padding: 24px;
  }

  .popup-content {
    background: var(--color-bg-elevated);
    border-radius: 0;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.2);
    max-width: 500px;
    width: 100%;
  }

  .popup-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 32px 40px 24px;
    border-bottom: 1px solid var(--color-border);
  }

  .popup-title {
    font-family: 'Instrument Serif', Georgia, serif;
    font-size: 24px;
    font-weight: 400;
    color: var(--color-text);
    margin: 0;
    letter-spacing: -0.01em;
  }

  .close-btn {
    padding: 8px;
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: color 0.2s;
  }

  .close-btn:hover:not(:disabled) {
    color: var(--color-text);
  }

  .close-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .close-icon {
    width: 20px;
    height: 20px;
  }

  .popup-body {
    padding: 32px 40px;
  }

  .section {
    margin-bottom: 32px;
  }

  .section:last-of-type {
    margin-bottom: 24px;
  }

  .section-label {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text);
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .section-hint {
    font-size: 14px;
    color: var(--color-text-muted);
    margin: 0 0 16px 0;
  }

  .optional-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    background: transparent;
    color: var(--color-text-muted);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border: 1px solid var(--color-border);
  }

  .tone-options {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .tone-option {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 20px 0;
    border: none;
    border-bottom: 1px solid var(--color-border);
    background: transparent;
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
    width: 100%;
  }

  .tone-option:last-child {
    border-bottom: none;
  }

  .tone-option:hover:not(:disabled) {
    background: rgba(255, 111, 97, 0.03);
  }

  .tone-option.selected {
    background: rgba(255, 111, 97, 0.05);
  }

  .tone-option:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .tone-radio {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid var(--color-border);
    flex-shrink: 0;
    margin-top: 2px;
    transition: all 0.2s;
    position: relative;
  }

  .tone-radio.checked {
    border-color: #FF6F61;
  }

  .tone-radio.checked::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #FF6F61;
  }

  .tone-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .tone-label {
    font-family: 'Instrument Serif', Georgia, serif;
    font-size: 16px;
    color: var(--color-text);
  }

  .tone-description {
    font-size: 13px;
    color: var(--color-text-muted);
  }

  .instructions-textarea {
    width: 100%;
    padding: 16px 0;
    font-size: 15px;
    font-family: inherit;
    line-height: 1.6;
    border: none;
    border-bottom: 2px solid var(--color-border);
    resize: none;
    transition: all 0.2s;
    background: transparent;
    color: var(--color-text);
  }

  .instructions-textarea:focus {
    outline: none;
    border-bottom-color: #FF6F61;
  }

  .instructions-textarea:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .instructions-textarea::placeholder {
    color: var(--color-text-muted);
  }

  .char-counter {
    font-size: 12px;
    color: var(--color-text-muted);
    text-align: right;
    margin-top: 8px;
  }

  .char-counter.warning {
    color: #d97706;
  }

  .char-counter.error {
    color: #dc2626;
  }

  .error-message {
    padding: 16px;
    background: transparent;
    border-left: 3px solid #dc2626;
    color: #dc2626;
    font-size: 14px;
    margin-bottom: 24px;
  }

  .popup-footer {
    display: flex;
    gap: 16px;
    padding-top: 24px;
    border-top: 1px solid var(--color-border);
  }

  .reset-btn {
    padding: 14px 24px;
    font-size: 14px;
    font-weight: 500;
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: color 0.2s;
  }

  .reset-btn:hover:not(:disabled) {
    color: var(--color-text);
  }

  .reset-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .generate-btn {
    flex: 1;
    padding: 14px 24px;
    font-size: 14px;
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

  .generate-btn:hover:not(:disabled) {
    background: #E85A4F;
  }

  .generate-btn:disabled {
    opacity: 0.8;
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
</style>
