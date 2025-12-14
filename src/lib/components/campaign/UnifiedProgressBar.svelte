<script lang="ts">
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import type { PipelineStatus } from '$lib/types/campaign';

  interface Props {
    status: PipelineStatus;
  }

  let { status }: Props = $props();

  // Animated counters for smooth number transitions
  const animatedProgress = tweened(0, { duration: 500, easing: cubicOut });
  const animatedInfluencerCount = tweened(0, { duration: 400, easing: cubicOut });

  // Update animated values when status changes
  $effect(() => {
    animatedProgress.set(status.overall_progress ?? 0);
  });

  $effect(() => {
    const count = status.stages.weaviate_search?.deduplicated_results ??
                  status.stages.brightdata_collection?.profiles_collected ?? 0;
    animatedInfluencerCount.set(count);
  });

  // Determine current active stage
  const currentStage = $derived.by((): 'search' | 'analysis' | null => {
    if (status.status !== 'running') return null;

    const stages = status.stages;
    if (stages.llm_analysis?.status === 'running') return 'analysis';
    if (stages.brightdata_collection?.status === 'running') return 'analysis';
    if (stages.weaviate_search?.status === 'running') return 'search';
    if (stages.query_expansion?.status === 'running') return 'search';

    // If we're past 50%, we're in analysis
    if (status.overall_progress > 50) return 'analysis';
    return 'search';
  });

  // Calculate stage-specific progress
  const stageProgress = $derived.by(() => {
    const p = status.overall_progress ?? 0;
    return {
      search: Math.min(100, p * 2),           // 0-50% overall → 0-100% search
      analysis: Math.max(0, (p - 50) * 2)     // 50-100% overall → 0-100% analysis
    };
  });

  // Stage label for display
  const stageLabel = $derived.by((): string => {
    if (currentStage === 'search') return 'Searching';
    if (currentStage === 'analysis') return 'Analyzing';
    if (status.status === 'completed') return 'Complete';
    if (status.status === 'error') return 'Error';
    return 'Preparing';
  });

  // Dynamic status message based on current stage and metrics
  const statusMessage = $derived.by((): string => {
    const stages = status.stages;

    if (status.status === 'completed') {
      const count = status.profiles_count ?? status.profiles?.length ?? 0;
      return `Found ${count} qualified influencers`;
    }

    if (status.status === 'error') {
      return status.error_message ?? 'An error occurred';
    }

    if (currentStage === 'search') {
      const queries = stages.query_expansion?.queries?.length ?? 0;
      const found = stages.weaviate_search?.deduplicated_results ?? 0;

      if (found > 0) {
        return `Found ${found} potential matches`;
      }
      if (queries > 0) {
        return `Running ${queries} search queries`;
      }
      return 'Generating search queries...';
    }

    if (currentStage === 'analysis') {
      const collected = stages.brightdata_collection?.profiles_collected ?? 0;
      const analyzed = stages.llm_analysis?.profiles_analyzed ?? 0;
      const batches = stages.brightdata_collection?.batches_completed ?? 0;
      const totalBatches = stages.brightdata_collection?.total_batches ?? 0;

      if (analyzed > 0) {
        return `${analyzed} qualified${batches > 0 ? ` • Batch ${batches}/${totalBatches}` : ''}`;
      }
      if (collected > 0) {
        return `Analyzing ${collected} profiles${batches > 0 ? ` • Batch ${batches}/${totalBatches}` : ''}`;
      }
      return 'Fetching live profile data...';
    }

    return 'Initializing pipeline...';
  });

  // Time remaining estimation
  function getTimeRemaining(progress: number): string {
    if (progress >= 100) return '';
    if (progress <= 0) return '~4 min remaining';

    const totalSeconds = 240; // ~4 minutes typical
    const remaining = Math.ceil(((100 - progress) / 100) * totalSeconds);

    if (remaining < 60) return `~${remaining}s remaining`;
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    return secs > 0 ? `~${mins}m ${secs}s remaining` : `~${mins}m remaining`;
  }
</script>

<div class="progress-container">
  <!-- Main progress bar with segments -->
  <div class="progress-track">
    <!-- Search segment (0-50%) -->
    <div
      class="progress-segment search"
      class:active={currentStage === 'search'}
      class:completed={stageProgress.search >= 100}
    >
      <div
        class="progress-fill"
        style="width: {stageProgress.search}%;"
      ></div>
      <span class="segment-label">Search</span>
    </div>

    <!-- Analysis segment (50-100%) -->
    <div
      class="progress-segment analysis"
      class:active={currentStage === 'analysis'}
      class:completed={stageProgress.analysis >= 100}
    >
      <div
        class="progress-fill"
        style="width: {stageProgress.analysis}%;"
      ></div>
      <span class="segment-label">Analysis</span>
    </div>
  </div>

  <!-- Progress info row -->
  <div class="progress-info">
    <div class="stage-info">
      {#if status.status === 'running'}
        <span class="status-dot"></span>
      {/if}
      <span class="stage-label">{stageLabel}...</span>
    </div>
    <div class="progress-meta">
      {#if status.status === 'running'}
        <span class="time-remaining">{getTimeRemaining(status.overall_progress)}</span>
      {/if}
      <span class="progress-percent">{Math.round($animatedProgress)}%</span>
    </div>
  </div>

  <!-- Status message -->
  <p class="status-message">{statusMessage}</p>
</div>

<style>
  .progress-container {
    padding: 20px 24px;
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.06);
  }

  .progress-track {
    display: flex;
    height: 6px;
    background: rgba(0, 0, 0, 0.04);
    overflow: hidden;
    gap: 2px;
  }

  .progress-segment {
    position: relative;
    flex: 1;
    height: 100%;
    overflow: hidden;
  }

  .progress-segment.search {
    background: rgba(0, 0, 0, 0.04);
  }

  .progress-segment.analysis {
    background: rgba(0, 0, 0, 0.04);
  }

  .progress-fill {
    height: 100%;
    transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .progress-segment.search .progress-fill {
    background: #FF6F61;
  }

  .progress-segment.analysis .progress-fill {
    background: #1a1a1a;
  }

  .progress-segment.active .progress-fill {
    animation: pulse-glow 1.5s ease-in-out infinite;
  }

  .progress-segment.completed .progress-fill {
    opacity: 0.7;
  }

  @keyframes pulse-glow {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }

  .segment-label {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(0, 0, 0, 0.3);
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .progress-segment:hover .segment-label {
    opacity: 1;
  }

  .progress-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 16px;
  }

  .stage-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    background: #FF6F61;
    animation: pulse-dot 1.5s ease-in-out infinite;
  }

  @keyframes pulse-dot {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .stage-label {
    font-size: 13px;
    font-weight: 500;
    color: rgba(0, 0, 0, 0.85);
    letter-spacing: -0.01em;
  }

  .progress-meta {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .time-remaining {
    font-size: 11px;
    color: rgba(0, 0, 0, 0.4);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .progress-percent {
    font-size: 13px;
    font-weight: 600;
    color: #FF6F61;
    min-width: 40px;
    text-align: right;
  }

  .status-message {
    margin: 10px 0 0 0;
    font-size: 12px;
    color: rgba(0, 0, 0, 0.5);
    line-height: 1.5;
  }
</style>
