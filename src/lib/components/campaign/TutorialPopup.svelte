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
      title: 'Welcome to Penni!',
      icon: '👋',
      description: "Let's get you set up to find the perfect influencers for your brand. This quick guide will walk you through creating your first campaign.",
      tip: "You'll be finding influencers in no time!"
    },
    {
      title: 'Name Your Campaign',
      icon: '📝',
      description: 'Start by giving your campaign a memorable name. This helps you organize multiple campaigns as your influencer marketing grows.',
      tip: 'Example: "Summer Product Launch" or "Q1 Brand Awareness"'
    },
    {
      title: 'Add Your Website',
      icon: '🌐',
      description: "Enter your brand's website URL. Penni will analyze your business to understand your niche and find the most relevant influencers.",
      tip: 'We use AI to match influencers who align with your brand'
    },
    {
      title: 'Start Your Search',
      icon: '🔍',
      description: 'Tell us what kind of influencers you\'re looking for — their niche, follower range, and location. Then click "Find Influencers" to start!',
      tip: 'Our AI will score each influencer based on fit with your brand'
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
      <!-- Progress dots -->
      <div class="progress-dots">
        {#each steps as _, index}
          <button
            type="button"
            class="dot"
            class:active={index === currentStep}
            class:completed={index < currentStep}
            onclick={() => currentStep = index}
            aria-label="Step {index + 1}"
          ></button>
        {/each}
      </div>

      <!-- Step content -->
      <div class="step-content">
        <div class="step-icon">{steps[currentStep].icon}</div>
        <h2 id="tutorial-title" class="step-title">{steps[currentStep].title}</h2>
        <p class="step-description">{steps[currentStep].description}</p>
        <div class="step-tip">
          <span class="tip-icon">💡</span>
          <span class="tip-text">{steps[currentStep].tip}</span>
        </div>
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
            {currentStep === totalSteps - 1 ? "Let's Go!" : 'Next'}
          </button>
        </div>
      </div>

      <!-- Step counter -->
      <div class="step-counter">
        Step {currentStep + 1} of {totalSteps}
      </div>
    </div>
  </div>
{/if}

<style>
  .popup-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 20px;
  }

  .popup-content {
    background: var(--color-bg-elevated);
    border-radius: 24px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
    max-width: 440px;
    width: 100%;
    padding: 32px;
    position: relative;
  }

  .progress-dots {
    display: flex;
    justify-content: center;
    gap: 8px;
    margin-bottom: 28px;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: none;
    background: rgba(0, 0, 0, 0.1);
    cursor: pointer;
    transition: all 0.3s;
    padding: 0;
  }

  .dot:hover {
    background: rgba(0, 0, 0, 0.2);
  }

  .dot.active {
    background: linear-gradient(135deg, var(--color-primary), #FF8A80);
    width: 24px;
    border-radius: 5px;
  }

  .dot.completed {
    background: var(--color-primary);
  }

  .step-content {
    text-align: center;
    margin-bottom: 28px;
  }

  .step-icon {
    font-size: 56px;
    margin-bottom: 16px;
    animation: bounce 0.6s ease-out;
  }

  @keyframes bounce {
    0%, 100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-8px);
    }
  }

  .step-title {
    font-size: 24px;
    font-weight: 700;
    color: var(--color-text);
    margin: 0 0 12px 0;
  }

  .step-description {
    font-size: 15px;
    line-height: 1.6;
    color: var(--color-text-secondary);
    margin: 0 0 20px 0;
  }

  .step-tip {
    display: inline-flex;
    align-items: flex-start;
    gap: 8px;
    padding: 12px 16px;
    background: rgba(255, 111, 97, 0.08);
    border-radius: 12px;
    text-align: left;
  }

  .tip-icon {
    font-size: 16px;
    flex-shrink: 0;
  }

  .tip-text {
    font-size: 13px;
    color: var(--color-text-muted);
    line-height: 1.4;
  }

  .popup-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .actions-left,
  .actions-right {
    flex: 1;
  }

  .actions-right {
    display: flex;
    justify-content: flex-end;
  }

  .back-btn,
  .skip-btn {
    padding: 12px 20px;
    font-size: 14px;
    font-weight: 500;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-bg-elevated);
    color: var(--color-text-muted);
    cursor: pointer;
    transition: all 0.2s;
  }

  .back-btn:hover,
  .skip-btn:hover {
    background: rgba(0, 0, 0, 0.03);
    border-color: rgba(0, 0, 0, 0.2);
  }

  .next-btn {
    padding: 12px 28px;
    font-size: 15px;
    font-weight: 600;
    border-radius: 10px;
    border: none;
    background: linear-gradient(135deg, var(--color-primary), #FF8A80);
    color: white;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 4px 16px rgba(255, 111, 97, 0.3);
  }

  .next-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(255, 111, 97, 0.4);
  }

  .step-counter {
    text-align: center;
    margin-top: 20px;
    font-size: 12px;
    color: rgba(0, 0, 0, 0.35);
  }
</style>
