/**
 * Centralized timing tracker for pipeline stages and sub-stages
 * Stores all timing data in a standardized nested structure
 */

import { getFirestoreInstance } from './firebase-admin.js';
import { Timestamp } from 'firebase-admin/firestore';

const db = getFirestoreInstance();
const PIPELINE_COLLECTION = 'pipeline_jobs';

export type PipelineStage = 
  | 'query_expansion'
  | 'weaviate_search'
  | 'brightdata_collection'
  | 'llm_analysis';

export interface StageTiming {
  start: number; // Relative to pipeline_start (seconds)
  end?: number;
  duration?: number;
  sub_stages?: {
    [key: string]: StageTiming | StageTiming[];
  };
}

export interface PipelineTimingData {
  pipeline_start: number; // Absolute timestamp (seconds)
  pipeline_end?: number; // Absolute timestamp (seconds)
  pipeline_duration?: number; // Duration in seconds
  stages: {
    query_expansion?: StageTiming;
    weaviate_search?: StageTiming;
    brightdata_collection?: StageTiming;
    llm_analysis?: StageTiming;
  };
}

export interface BatchTiming {
  batch_index: number;
  start: number;
  end?: number;
  duration?: number;
}

/**
 * Centralized timing tracker for pipeline execution
 */
export class PipelineTimingTracker {
  private jobId: string;
  private pipelineStartTime: number; // Absolute timestamp (seconds)
  private timing: PipelineTimingData;
  private activeStages: Map<PipelineStage, number>; // stage -> start time (relative)
  private activeSubStages: Map<string, number>; // "stage.substage" -> start time (relative)

  constructor(jobId: string) {
    this.jobId = jobId;
    this.pipelineStartTime = Date.now() / 1000;
    this.timing = {
      pipeline_start: this.pipelineStartTime,
      stages: {},
    };
    this.activeStages = new Map();
    this.activeSubStages = new Map();
  }

  /**
   * Get current relative time (seconds since pipeline start)
   */
  private getRelativeTime(): number {
    return (Date.now() / 1000) - this.pipelineStartTime;
  }

  /**
   * Mark the start of a stage
   */
  startStage(stage: PipelineStage): void {
    const relativeTime = this.getRelativeTime();
    this.activeStages.set(stage, relativeTime);
    
    if (!this.timing.stages[stage]) {
      this.timing.stages[stage] = {
        start: relativeTime,
      };
    } else {
      this.timing.stages[stage]!.start = relativeTime;
      // Reset end/duration if restarting
      delete this.timing.stages[stage]!.end;
      delete this.timing.stages[stage]!.duration;
    }
  }

  /**
   * Mark the end of a stage and calculate duration
   */
  endStage(stage: PipelineStage): void {
    const relativeTime = this.getRelativeTime();
    const startTime = this.activeStages.get(stage);
    
    if (!startTime) {
      console.warn(`[TimingTracker] Attempted to end stage ${stage} that was not started`);
      return;
    }

    if (!this.timing.stages[stage]) {
      this.timing.stages[stage] = {
        start: startTime,
      };
    }

    this.timing.stages[stage]!.end = relativeTime;
    this.timing.stages[stage]!.duration = relativeTime - startTime;
    this.activeStages.delete(stage);
  }

  /**
   * Mark the start of a sub-stage
   */
  startSubStage(stage: PipelineStage, subStage: string, metadata?: any): void {
    const relativeTime = this.getRelativeTime();
    const key = `${stage}.${subStage}`;
    this.activeSubStages.set(key, relativeTime);

    // Ensure stage exists
    if (!this.timing.stages[stage]) {
      this.timing.stages[stage] = {
        start: relativeTime,
      };
    }

    // Initialize sub_stages if needed
    if (!this.timing.stages[stage]!.sub_stages) {
      this.timing.stages[stage]!.sub_stages = {};
    }

    // Create sub-stage timing
    const subStageTiming: StageTiming = {
      start: relativeTime,
    };

    this.timing.stages[stage]!.sub_stages![subStage] = subStageTiming;
  }

  /**
   * Mark the end of a sub-stage and calculate duration
   */
  endSubStage(stage: PipelineStage, subStage: string): void {
    const relativeTime = this.getRelativeTime();
    const key = `${stage}.${subStage}`;
    const startTime = this.activeSubStages.get(key);

    if (!startTime) {
      console.warn(`[TimingTracker] Attempted to end sub-stage ${stage}.${subStage} that was not started`);
      return;
    }

    if (!this.timing.stages[stage]?.sub_stages?.[subStage]) {
      console.warn(`[TimingTracker] Sub-stage ${stage}.${subStage} timing not found`);
      return;
    }

    const subStageTiming = this.timing.stages[stage]!.sub_stages![subStage] as StageTiming;
    subStageTiming.end = relativeTime;
    subStageTiming.duration = relativeTime - startTime;
    this.activeSubStages.delete(key);
  }

  /**
   * Add batch timing for a stage
   */
  addBatchTiming(stage: PipelineStage, batchIndex: number, start: number, end?: number): void {
    // Ensure stage exists
    if (!this.timing.stages[stage]) {
      this.timing.stages[stage] = {
        start: start,
      };
    }

    // Initialize sub_stages if needed
    if (!this.timing.stages[stage]!.sub_stages) {
      this.timing.stages[stage]!.sub_stages = {};
    }

    // Initialize batches array if needed
    if (!this.timing.stages[stage]!.sub_stages!['batches']) {
      this.timing.stages[stage]!.sub_stages!['batches'] = [];
    }

    const batches = this.timing.stages[stage]!.sub_stages!['batches'] as BatchTiming[];
    
    // Find existing batch or create new one
    let batch = batches.find(b => b.batch_index === batchIndex);
    if (!batch) {
      batch = {
        batch_index: batchIndex,
        start: start,
      };
      batches.push(batch);
    } else {
      batch.start = start;
    }

    if (end !== undefined) {
      batch.end = end;
      batch.duration = end - start;
    }
  }

  /**
   * Mark pipeline end and calculate total duration
   */
  endPipeline(): void {
    const relativeTime = this.getRelativeTime();
    this.timing.pipeline_end = this.pipelineStartTime + relativeTime;
    this.timing.pipeline_duration = relativeTime;
  }

  /**
   * Get complete timing data structure
   */
  getTimingData(): PipelineTimingData {
    return JSON.parse(JSON.stringify(this.timing)); // Deep copy
  }

  /**
   * Save timing data to Firestore
   */
  async saveToFirestore(): Promise<void> {
    try {
      const jobRef = db.collection(PIPELINE_COLLECTION).doc(this.jobId);
      await jobRef.update({
        timing: this.timing,
        updated_at: Timestamp.now(),
      });
    } catch (error) {
      console.error(`[TimingTracker] Failed to save timing to Firestore for job ${this.jobId}:`, error);
      throw error;
    }
  }

  /**
   * Get pipeline start time (absolute timestamp)
   */
  getPipelineStartTime(): number {
    return this.pipelineStartTime;
  }
}

