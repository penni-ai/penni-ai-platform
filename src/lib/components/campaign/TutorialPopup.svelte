<script lang="ts">
  import { fly, fade } from 'svelte/transition';

  interface Props {
    open: boolean;
    onComplete: () => void;
    onSkip: () => void;
  }

  let { open, onComplete, onSkip }: Props = $props();

  let currentStep = $state(0);

  const steps = [
    {
      title: 'Welcome to Penni',
      description: "Let's get you set up to find the perfect influencers for your brand. This quick guide will walk you through creating your first campaign.",
      tip: "You'll be finding influencers in no time."
    },
    {
      title: 'Name Your Campaign',
      description: 'Start by giving your campaign a memorable name. This helps you organize multiple campaigns as your influencer marketing grows.',
      tip: 'Example: "Summer Product Launch" or "Q1 Brand Awareness"'
    },
    {
      title: 'Add Your Website',
      description: "Enter your brand's website URL. Penni will analyze your business to understand your niche and find the most relevant influencers.",
      tip: 'We use AI to match influencers who align with your brand.'
    },
    {
      title: 'Start Your Search',
      description: 'Tell us what kind of influencers you\'re looking for - their niche, follower range, and location. Then click "Find Influencers" to begin.',
      tip: 'Our AI will score each influencer based on fit with your brand.'
    }
  ];

  const totalSteps = steps.length;

  function nextStep() {
    if (currentStep < totalSteps - 1) {
      currentStep++;
    } else {
      onComplete();
    }
  }

  function prevStep() {
    if (currentStep > 0) {
      currentStep--;
    }
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.classList.contains('popup-overlay')) {
      // Don't close on backdrop click during tutorial - encourage completion
    }
  }
</script>

{#if open}
  <div
    class="popup-overlay"
    onclick={handleClickOutside}
    role="dialog"
    aria-modal="true"
    aria-labelledby="tutorial-title"
    tabindex="-1"
    transition:fade={{ duration: 200 }}
  >
    <div class="popup-content" transition:fly={{ y: 20, duration: 300 }}>
      <!-- Step indicator -->
      <div class="step-indicator">
        <span class="step-number">{currentStep + 1}</span>
        <span class="step-divider">/</span>
        <span class="step-total">{totalSteps}</span>
      </div>

      <!-- Step content -->
      <div class="step-content">
        <h2 id="tutorial-title" class="step-title">{steps[currentStep].title}</h2>
        <p class="step-description">{steps[currentStep].description}</p>

        <div class="step-tip">
          <span class="tip-text">{steps[currentStep].tip}</span>
        </div>
      </div>

      <!-- Progress bar -->
      <div class="progress-bar">
        <div class="progress-fill" style="width: {((currentStep + 1) / totalSteps) * 100}%"></div>
      </div>

      <!-- Actions -->
      <div class="popup-actions">
        <div class="actions-left">
          {#if currentStep > 0}
            <button type="button" class="back-btn" onclick={prevStep}>
              Back
            </button>
          {:else}
            <button type="button" class="skip-btn" onclick={onSkip}>
              Skip tutorial
            </button>
          {/if}
        </div>
        <div class="actions-right">
          <button type="button" class="next-btn" onclick={nextStep}>
            {currentStep === totalSteps - 1 ? "Let's Go" : 'Continue'}
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
    z-index: 9999;
    padding: 24px;
  }

  .popup-content {
    background: var(--color-bg-elevated);
    border-radius: 0;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.2);
    max-width: 480px;
    width: 100%;
    padding: 48px;
    position: relative;
  }

  .step-indicator {
    display: flex;
    align-items: baseline;
    gap: 4px;
    margin-bottom: 32px;
    font-family: 'Instrument Serif', Georgia, serif;
  }

  .step-number {
    font-size: 32px;
    color: #FF6F61;
    font-weight: 400;
  }

  .step-divider {
    font-size: 20px;
    color: var(--color-text-muted);
  }

  .step-total {
    font-size: 20px;
    color: var(--color-text-muted);
  }

  .step-content {
    margin-bottom: 40px;
  }

  .step-title {
    font-family: 'Instrument Serif', Georgia, serif;
    font-size: 28px;
    font-weight: 400;
    color: var(--color-text);
    margin: 0 0 16px 0;
    letter-spacing: -0.01em;
    line-height: 1.2;
  }

  .step-description {
    font-size: 15px;
    line-height: 1.7;
    color: var(--color-text-secondary);
    margin: 0 0 24px 0;
  }

  .step-tip {
    padding-left: 16px;
    border-left: 2px solid #FF6F61;
  }

  .tip-text {
    font-size: 14px;
    color: var(--color-text-muted);
    line-height: 1.5;
    font-style: italic;
  }

  .progress-bar {
    height: 2px;
    background: rgba(0, 0, 0, 0.08);
    margin-bottom: 32px;
  }

  .progress-fill {
    height: 100%;
    background: #FF6F61;
    transition: width 0.3s ease;
  }

  .popup-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
  }

  .actions-left,
  .actions-right {
    flex-shrink: 0;
  }

  .back-btn,
  .skip-btn {
    padding: 12px 0;
    font-size: 14px;
    font-weight: 500;
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: color 0.2s;
  }

  .back-btn:hover,
  .skip-btn:hover {
    color: var(--color-text);
  }

  .next-btn {
    padding: 14px 32px;
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.02em;
    border: none;
    background: #FF6F61;
    color: white;
    cursor: pointer;
    transition: background 0.2s;
  }

  .next-btn:hover {
    background: #E85A4F;
  }
</style>
