import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeFirestore } from './helpers/fake-firebase';

type FitResult = { fit_score: number; fit_rationale: string; fit_summary: string };

function parseStructuredLogCall(call: unknown[]): Record<string, any> | null {
  const first = call[0];
  if (typeof first !== 'string') return null;
  try {
    const parsed = JSON.parse(first);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
  } catch {
    return null;
  }
}

function expectStructuredLogMessage(spy: ReturnType<typeof vi.spyOn>, message: string) {
  const matched = spy.mock.calls.some((call) => parseStructuredLogCall(call as unknown[])?.message === message);
  expect(matched).toBe(true);
}

function makeUrls(count: number, platform: 'instagram' | 'tiktok' = 'instagram'): string[] {
  return Array.from({ length: count }, (_, i) =>
    platform === 'instagram'
      ? `https://instagram.com/test_user_${i}/`
      : `https://tiktok.com/@test_user_${i}`
  );
}

function makeWeaviateResults(urls: string[], platform: 'instagram' | 'tiktok' = 'instagram'): any[] {
  return urls.map((url, i) => ({
    id: `w_${i}`,
    data: {
      profile_url: url,
      platform,
      display_name: `User ${i}`,
      biography: `Bio ${i}`,
      followers: 1000 + i,
    },
  }));
}

function makeRawProfiles(urls: string[], platform: 'instagram' | 'tiktok' = 'instagram'): any[] {
  return urls.map((url, i) => ({
    profile_url: url,
    url,
    platform,
    account: `test_user_${i}`,
  }));
}

const state = {
  savedBatches: new Map<number, any[]>(),
  snapshotCounter: 0,
};

const firestoreTracker = {
  updatePipelineJobStatus: vi.fn(async () => {}),
  updatePipelineStage: vi.fn(async () => {}),
  completeStage: vi.fn(async () => {}),
  updateQueryExpansionStage: vi.fn(async () => {}),
  updateWeaviateSearchStage: vi.fn(async () => {}),
  updateBrightDataStage: vi.fn(async () => {}),
  updateLLMAnalysisStage: vi.fn(async () => {}),
  storePipelineResults: vi.fn(async () => {}),
  storeRemainingProfiles: vi.fn(async () => {}),
  appendBatchResults: vi.fn(async (_jobId: string, batchIndex: number, profiles: any[]) => {
    state.savedBatches.set(batchIndex, profiles);
  }),
  mergeBatchResults: vi.fn(async () => {
    const all: any[] = [];
    for (const batch of Array.from(state.savedBatches.keys()).sort((a, b) => a - b)) {
      all.push(...(state.savedBatches.get(batch) || []));
    }
    return all;
  }),
  updateBatchCounters: vi.fn(async () => {}),
  isJobCancelled: vi.fn(async () => false),
  finalizePipelineProgress: vi.fn(async () => {}),
  saveWeaviateCandidates: vi.fn(async () => ''),
  updateProgress: vi.fn(async () => {}),
  updateProgressiveTopN: vi.fn(async () => {}),
  finalizeProgressiveResults: vi.fn(async () => {}),
};

const searchQueryGenerator = {
  generateSearchQueriesFromDescription: vi.fn(async () => ({
    description: 'test',
    queries: ['query 1', 'query 2'],
    rawResponse: 'query 1\nquery 2',
    prompt: 'prompt',
  })),
};

const weaviateSearch = {
  performParallelHybridSearches: vi.fn(async () => ({
    allSearchResults: [],
    deduplicatedResults: [],
    queriesExecuted: 0,
    batchTimings: [],
    totalRuntimeMs: 0,
  })),
};

const profileNormalizer = {
  normalizeProfiles: vi.fn((profiles: any[]) => profiles),
};

const llmAnalysis = {
  analyzeProfileFitBatch: vi.fn(async (profiles: any[]) => {
    const results: FitResult[] = profiles.map(() => ({
      fit_score: 0,
      fit_rationale: 'no',
      fit_summary: 'no',
    }));
    return results;
  }),
};

const brightdataCache = {
  getCachedProfilesBatch: vi.fn(async (_urls: string[]) => new Map<string, any>()),
  setCachedProfilesBatch: vi.fn(async () => {}),
  detectPlatformFromUrl: vi.fn((_url: string) => 'instagram' as const),
  extractProfileUrl: vi.fn((profile: any) => profile.profile_url || profile.url),
};

const brightdataInternal = {
  getBrightDataApiKey: vi.fn(() => 'test'),
  getBrightDataBaseUrl: vi.fn(() => 'https://example.test'),
  triggerCollection: vi.fn(async (_urls: string[]) => [
    { snapshot_id: `snap_${++state.snapshotCounter}`, platform: 'instagram' as const },
  ]),
  checkProgress: vi.fn(async (snapshotId: string) => ({ snapshot_id: snapshotId, dataset_id: 'ds', status: 'ready' as const })),
  downloadResults: vi.fn(async () => [] as any[]),
};

const timingTrackerModule = {
  PipelineTimingTracker: class {
    private start = Date.now() / 1000;
    constructor(_jobId: string) {}
    getPipelineStartTime(): number {
      return this.start;
    }
    startStage(_stage: any): void {}
    endStage(_stage: any): void {}
    startSubStage(_stage: any, _subStage: string): void {}
    endSubStage(_stage: any, _subStage: string): void {}
    addBatchTiming(_stage: any, _batchIndex: number, _start: number, _end?: number): void {}
    endPipeline(): void {}
    async saveToFirestore(): Promise<void> {}
  },
};

vi.mock('../dist/utils/firestore-tracker.js', () => firestoreTracker);

let campaignDb: FakeFirestore;
vi.mock('../dist/utils/firebase-admin.js', () => ({
	getFirestoreInstance: () => campaignDb,
}));
vi.mock('../dist/utils/search-query-generator.js', () => searchQueryGenerator);
vi.mock('../dist/utils/weaviate-search.js', () => weaviateSearch);
vi.mock('../dist/utils/profile-normalizer.js', () => profileNormalizer);
vi.mock('../dist/utils/llm-analysis.js', () => llmAnalysis);
vi.mock('../dist/utils/brightdata-cache.js', () => brightdataCache);
vi.mock('../dist/utils/brightdata-internal.js', () => brightdataInternal);
vi.mock('../dist/utils/timing-tracker.js', () => timingTrackerModule);

beforeEach(() => {
  vi.clearAllMocks();
  state.savedBatches.clear();
  state.snapshotCounter = 0;
  campaignDb = new FakeFirestore();
  firestoreTracker.isJobCancelled.mockResolvedValue(false);
  brightdataCache.detectPlatformFromUrl.mockImplementation(() => 'instagram');
});

describe('pipeline worker (cache-first + early stop)', () => {
  it('completes with empty results when Weaviate yields no candidates', async () => {
    weaviateSearch.performParallelHybridSearches.mockResolvedValue({
      allSearchResults: [],
      deduplicatedResults: [],
      queriesExecuted: 2,
      batchTimings: [],
      totalRuntimeMs: 1,
    });

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

    await handlePipelineExecution({
      job_id: 'job_test_empty',
      uid: 'user_1',
      business_description: 'desc',
      top_n: 10,
      weaviate_top_n: 500,
      llm_top_n: 10,
      request_id: 'req_empty',
    });

    expect(firestoreTracker.storePipelineResults).toHaveBeenCalledWith(
      'job_test_empty',
      [],
      expect.objectContaining({ profiles_collected: 0, profiles_analyzed: 0 })
    );
    expect(firestoreTracker.updatePipelineJobStatus).toHaveBeenCalledWith('job_test_empty', 'completed');
  });

  it('scores cached profiles first and stops without BrightData if target reached', async () => {
    const llmTopN = 10;
    const candidateUrls = makeUrls(40, 'instagram');
    const weaviateResults = makeWeaviateResults(candidateUrls, 'instagram');

    weaviateSearch.performParallelHybridSearches.mockResolvedValue({
      allSearchResults: [],
      deduplicatedResults: weaviateResults,
      queriesExecuted: 2,
      batchTimings: [],
      totalRuntimeMs: 1,
    });

    const cachedUrls = candidateUrls.slice(0, 20);
    const cachedProfiles = makeRawProfiles(cachedUrls, 'instagram');
    const cacheMap = new Map<string, any>(cachedUrls.map((u, i) => [u, cachedProfiles[i]]));
    brightdataCache.getCachedProfilesBatch.mockResolvedValue(cacheMap);

    llmAnalysis.analyzeProfileFitBatch.mockImplementation(async (profiles: any[]) => {
      const results: FitResult[] = profiles.map((p: any, i: number) => ({
        fit_score: i < llmTopN ? 100 : 0,
        fit_rationale: `rationale ${p.profile_url}`,
        fit_summary: `summary ${p.profile_url}`,
      }));
      return results;
    });

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

    await handlePipelineExecution({
      job_id: 'job_test_cache_only',
      uid: 'user_1',
      business_description: 'desc',
      top_n: llmTopN,
      weaviate_top_n: 500,
      llm_top_n: llmTopN,
      request_id: 'req_1',
    });

    expect(brightdataInternal.triggerCollection).not.toHaveBeenCalled();
    expect(brightdataInternal.downloadResults).not.toHaveBeenCalled();
    expect(llmAnalysis.analyzeProfileFitBatch).toHaveBeenCalledTimes(1);

    expect(firestoreTracker.storePipelineResults).toHaveBeenCalledTimes(1);
    const [, finalProfiles] = firestoreTracker.storePipelineResults.mock.calls[0] as any[];
    expect(Array.isArray(finalProfiles)).toBe(true);
    expect(finalProfiles).toHaveLength(llmTopN);
    expect(finalProfiles.every((p: any) => (p.fit_score ?? 0) >= 90)).toBe(true);
    expect(firestoreTracker.storeRemainingProfiles).toHaveBeenCalledTimes(1);
  });

  it('does not fail the pipeline when storing remaining profiles errors', async () => {
    const llmTopN = 10;
    const candidateUrls = makeUrls(40, 'instagram');
    const weaviateResults = makeWeaviateResults(candidateUrls, 'instagram');

    weaviateSearch.performParallelHybridSearches.mockResolvedValue({
      allSearchResults: [],
      deduplicatedResults: weaviateResults,
      queriesExecuted: 2,
      batchTimings: [],
      totalRuntimeMs: 1,
    });

    const cachedUrls = candidateUrls.slice(0, 20);
    const cachedProfiles = makeRawProfiles(cachedUrls, 'instagram');
    const cacheMap = new Map<string, any>(cachedUrls.map((u, i) => [u, cachedProfiles[i]]));
    brightdataCache.getCachedProfilesBatch.mockResolvedValue(cacheMap);

    llmAnalysis.analyzeProfileFitBatch.mockResolvedValue(
      cachedProfiles.map((_p: any, i: number) => ({
        fit_score: i < llmTopN ? 90 : 0,
        fit_rationale: 'r',
        fit_summary: 's',
      }))
    );

    firestoreTracker.storeRemainingProfiles.mockRejectedValueOnce(new Error('storage down'));

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

    await handlePipelineExecution({
      job_id: 'job_test_store_remaining_fail',
      uid: 'user_1',
      business_description: 'desc',
      top_n: llmTopN,
      weaviate_top_n: 500,
      llm_top_n: llmTopN,
      request_id: 'req_remaining_fail',
    });

    expect(firestoreTracker.updatePipelineJobStatus).toHaveBeenCalledWith('job_test_store_remaining_fail', 'completed');
  });

  it('passes expanded campaign description and strict location flag into LLM analysis', async () => {
    const llmTopN = 10;
    const candidateUrls = makeUrls(20, 'instagram');
    const weaviateResults = makeWeaviateResults(candidateUrls, 'instagram');

    // Seed campaign docs used by worker campaign expansion.
    await campaignDb
      .collection('users')
      .doc('user_1')
      .collection('campaigns')
      .doc('camp_1')
      .set({
        business_name: 'Penny Coffee',
        business_about: 'We sell coffee',
        website: 'https://example.com',
        influencer_location: 'NYC',
        type_of_influencer: 'Food creators',
        platform: 'instagram',
      });
    await campaignDb
      .collection('users')
      .doc('user_1')
      .collection('campaigns')
      .doc('camp_1')
      .collection('collected')
      .doc('data')
      .set({
        business_name: 'Penny Coffee (Collected)',
        business_about: 'Collected about',
        influencer_location: 'San Francisco',
      });

    weaviateSearch.performParallelHybridSearches.mockResolvedValue({
      allSearchResults: [],
      deduplicatedResults: weaviateResults,
      queriesExecuted: 2,
      batchTimings: [],
      totalRuntimeMs: 1,
    });

    const cachedProfiles = makeRawProfiles(candidateUrls, 'instagram');
    const cacheMap = new Map<string, any>(candidateUrls.map((u, i) => [u, cachedProfiles[i]]));
    brightdataCache.getCachedProfilesBatch.mockResolvedValue(cacheMap);

    llmAnalysis.analyzeProfileFitBatch.mockResolvedValue(
      cachedProfiles.map(() => ({ fit_score: 0, fit_rationale: 'r', fit_summary: 's' }))
    );

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

    await handlePipelineExecution({
      job_id: 'job_test_campaign_expand',
      uid: 'user_1',
      campaign_id: 'camp_1',
      business_description: 'fallback desc',
      top_n: llmTopN,
      weaviate_top_n: 500,
      llm_top_n: llmTopN,
      request_id: 'req_campaign',
      strict_location_matching: true,
    });

    expect(llmAnalysis.analyzeProfileFitBatch).toHaveBeenCalled();
    const [, campaignDescription, , strictFlag] = llmAnalysis.analyzeProfileFitBatch.mock.calls[0] as any[];
    expect(typeof campaignDescription).toBe('string');
    expect(campaignDescription).toContain('Penny Coffee');
    expect(campaignDescription).toContain('Influencer Location');
    expect(strictFlag).toBe(true);
  });

  it('runs BrightData batches only for cache misses and stops once enough 10/10s are found', async () => {
    const llmTopN = 10;
    const candidateUrls = makeUrls(140, 'instagram'); // 7 batches @ 20
    const weaviateResults = makeWeaviateResults(candidateUrls, 'instagram');

    weaviateSearch.performParallelHybridSearches.mockResolvedValue({
      allSearchResults: [],
      deduplicatedResults: weaviateResults,
      queriesExecuted: 2,
      batchTimings: [],
      totalRuntimeMs: 1,
    });

    // No cache hits
    brightdataCache.getCachedProfilesBatch.mockResolvedValue(new Map());

    // BrightData returns 20 raw profiles per snapshot
    let downloadCall = 0;
    brightdataInternal.downloadResults.mockImplementation(async () => {
      const start = downloadCall * 20;
      const urls = candidateUrls.slice(start, start + 20);
      downloadCall++;
      return makeRawProfiles(urls, 'instagram');
    });

    // First batch yields all perfect fits → pipeline should stop after processing 1 batch
    llmAnalysis.analyzeProfileFitBatch.mockImplementation(async (profiles: any[]) => {
      const results: FitResult[] = profiles.map((p: any) => ({
        fit_score: 100,
        fit_rationale: `rationale ${p.profile_url}`,
        fit_summary: `summary ${p.profile_url}`,
      }));
      return results;
    });

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

    await handlePipelineExecution({
      job_id: 'job_test_brightdata_stop',
      uid: 'user_1',
      business_description: 'desc',
      top_n: llmTopN,
      weaviate_top_n: 500,
      llm_top_n: llmTopN,
      request_id: 'req_2',
    });

    // We keep 5 batches in-flight when possible, so at least 5 triggers should happen up-front.
    expect(brightdataInternal.triggerCollection.mock.calls.length).toBeGreaterThanOrEqual(5);

    // But we should stop processing downloads/LLM once target is reached.
    expect(brightdataInternal.downloadResults).toHaveBeenCalledTimes(1);
    expect(llmAnalysis.analyzeProfileFitBatch).toHaveBeenCalledTimes(1);

    const [, finalProfiles] = firestoreTracker.storePipelineResults.mock.calls[0] as any[];
    expect(finalProfiles).toHaveLength(llmTopN);
  });

  it('handles BrightData batch failures and still completes with best-effort results', async () => {
    vi.useFakeTimers();
    try {
      const llmTopN = 10;
      const candidateUrls = makeUrls(20, 'instagram');
      const weaviateResults = makeWeaviateResults(candidateUrls, 'instagram');

      weaviateSearch.performParallelHybridSearches.mockResolvedValue({
        allSearchResults: [],
        deduplicatedResults: weaviateResults,
        queriesExecuted: 2,
        batchTimings: [],
        totalRuntimeMs: 1,
      });

      brightdataCache.getCachedProfilesBatch.mockResolvedValue(new Map());
      brightdataInternal.checkProgress.mockResolvedValue({
        snapshot_id: 'snap_1',
        dataset_id: 'ds',
        status: 'failed' as const,
      });

      const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

      const promise = handlePipelineExecution({
        job_id: 'job_test_brightdata_failed',
        uid: 'user_1',
        business_description: 'desc',
        top_n: llmTopN,
        weaviate_top_n: 500,
        llm_top_n: llmTopN,
        request_id: 'req_failed',
      });

      // Worker sleeps between polls; fast-forward the 10s poll interval.
      await vi.advanceTimersByTimeAsync(10_000);
      await promise;

      expect(firestoreTracker.updateBatchCounters).toHaveBeenCalled();
      expect(firestoreTracker.storePipelineResults).toHaveBeenCalledWith(
        'job_test_brightdata_failed',
        expect.any(Array),
        expect.any(Object)
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('respects cancellation and marks job cancelled', async () => {
    const llmTopN = 10;
    const candidateUrls = makeUrls(40, 'instagram');
    const weaviateResults = makeWeaviateResults(candidateUrls, 'instagram');

    weaviateSearch.performParallelHybridSearches.mockResolvedValue({
      allSearchResults: [],
      deduplicatedResults: weaviateResults,
      queriesExecuted: 2,
      batchTimings: [],
      totalRuntimeMs: 1,
    });

    brightdataCache.getCachedProfilesBatch.mockResolvedValue(new Map());
    firestoreTracker.isJobCancelled.mockResolvedValue(true);

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

    await handlePipelineExecution({
      job_id: 'job_test_cancel',
      uid: 'user_1',
      business_description: 'desc',
      top_n: llmTopN,
      weaviate_top_n: 500,
      llm_top_n: llmTopN,
      request_id: 'req_3',
    });

    expect(firestoreTracker.updatePipelineJobStatus).toHaveBeenCalledWith('job_test_cancel', 'cancelled');
  });

  it('surfaces query expansion errors and runs outer error handler', async () => {
    searchQueryGenerator.generateSearchQueriesFromDescription.mockRejectedValueOnce(new Error('boom'));

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

    await expect(
      handlePipelineExecution({
        job_id: 'job_test_query_fail',
        uid: 'user_1',
        business_description: 'desc',
        top_n: 10,
        weaviate_top_n: 500,
        llm_top_n: 10,
        request_id: 'req_fail',
      })
    ).rejects.toThrow('boom');

    expect(firestoreTracker.updatePipelineJobStatus).toHaveBeenCalledWith('job_test_query_fail', 'error', 'boom');
  });

  it('logs when Firestore error update fails in outer catch', async () => {
    searchQueryGenerator.generateSearchQueriesFromDescription.mockRejectedValueOnce(new Error('boom2'));

    // First call sets job to running, second is the stage-level error update, third is the outer catch update.
    firestoreTracker.updatePipelineJobStatus
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {
        throw new Error('firestore down');
      });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

    await expect(
      handlePipelineExecution({
        job_id: 'job_test_outer_fail',
        uid: 'user_1',
        business_description: 'desc',
        top_n: 10,
        weaviate_top_n: 500,
        llm_top_n: 10,
        request_id: 'req_fail2',
      })
    ).rejects.toThrow('boom2');

    expect(errorSpy).toHaveBeenCalled();
  });

  it('extractTopCandidates respects platform filter and field fallbacks (best-effort candidate saving)', async () => {
    const llmTopN = 2;
    const deduplicatedResults = [
      // Mismatched platform should be skipped (continue branch).
      {
        id: 'skip_me',
        data: { profile_url: 'https://tiktok.com/@skip', platform: 'tiktok' },
      },
      // profile_url fallback + uuid + metadata score/distance + followers type fallback.
      {
        uuid: 'uuid_2',
        profile_url: 'https://instagram.com/ig_1/',
        platform: 'instagram',
        data: { platform: 'instagram', display_name: 'IG1', biography: 'bio', followers: '1000' },
        metadata: { score: 0.5, distance: 0.1 },
      },
      // url fallback + id + explicit score/distance.
      {
        id: 'id_3',
        url: 'https://instagram.com/ig_2/',
        data: { platform: 'instagram', display_name: 'IG2', biography: 'bio2', followers: 1234 },
        score: 0.9,
        distance: 0.2,
      },
    ];

    weaviateSearch.performParallelHybridSearches.mockResolvedValue({
      allSearchResults: [],
      deduplicatedResults,
      queriesExecuted: 2,
      batchTimings: [],
      totalRuntimeMs: 1,
    });

    // Ensure progress callbacks run.
    weaviateSearch.performParallelHybridSearches.mockImplementationOnce(async (...args: any[]) => {
      const onProgress = args[7];
      await onProgress('embedding_generation');
      await onProgress('searches_complete');
      return {
        allSearchResults: [],
        deduplicatedResults,
        queriesExecuted: 2,
        batchTimings: [],
        totalRuntimeMs: 1,
      };
    });

    const cacheMap = new Map<string, any>([
      ['https://instagram.com/ig_1/', { profile_url: 'https://instagram.com/ig_1/', platform: 'instagram' }],
      ['https://instagram.com/ig_2/', { profile_url: 'https://instagram.com/ig_2/', platform: 'instagram' }],
    ]);
    brightdataCache.getCachedProfilesBatch.mockResolvedValue(cacheMap);
    llmAnalysis.analyzeProfileFitBatch.mockResolvedValue([
      { fit_score: 90, fit_rationale: 'r1', fit_summary: 's1' },
      { fit_score: 90, fit_rationale: 'r2', fit_summary: 's2' },
    ]);

    firestoreTracker.saveWeaviateCandidates.mockRejectedValueOnce(new Error('storage down'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');
    await handlePipelineExecution({
      job_id: 'job_test_candidates_fallbacks',
      uid: 'user_1',
      business_description: 'desc',
      top_n: llmTopN,
      weaviate_top_n: 2,
      llm_top_n: llmTopN,
      platform: 'instagram',
      request_id: 'req_candidates',
    });

    expect(firestoreTracker.saveWeaviateCandidates).toHaveBeenCalled();
    const [, savedCandidates] = firestoreTracker.saveWeaviateCandidates.mock.calls[0] as any[];
    expect(savedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'uuid_2', profile_url: 'https://instagram.com/ig_1/' }),
        expect.objectContaining({ id: 'id_3', profile_url: 'https://instagram.com/ig_2/' }),
      ])
    );
    expectStructuredLogMessage(warnSpy, 'weaviate_candidates_save_failed');
    expect(firestoreTracker.updateProgress).toHaveBeenCalledWith(
      'job_test_candidates_fallbacks',
      'weaviate_search',
      'embedding_generation'
    );
  });

  it('cancels after query expansion completes (second cancellation check)', async () => {
    firestoreTracker.isJobCancelled
      .mockResolvedValueOnce(false) // before query generation
      .mockResolvedValueOnce(true); // after query generation

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

    await handlePipelineExecution({
      job_id: 'job_test_cancel_after_queries',
      uid: 'user_1',
      business_description: 'desc',
      top_n: 10,
      weaviate_top_n: 500,
      llm_top_n: 10,
      request_id: 'req_cancel_queries',
    });

    expect(searchQueryGenerator.generateSearchQueriesFromDescription).toHaveBeenCalled();
    expect(firestoreTracker.updatePipelineJobStatus).toHaveBeenCalledWith('job_test_cancel_after_queries', 'cancelled');
  });

  it('cancels after Weaviate searches complete and runs the weaviate cancellation handler', async () => {
    const urls = makeUrls(2, 'instagram');
    const deduplicatedResults = makeWeaviateResults(urls, 'instagram');

    weaviateSearch.performParallelHybridSearches.mockImplementationOnce(async (...args: any[]) => {
      const onProgress = args[7];
      await onProgress('embedding_generation');
      await onProgress('searches_complete');
      return {
        allSearchResults: [],
        deduplicatedResults,
        queriesExecuted: 2,
        batchTimings: [],
        totalRuntimeMs: 1,
      };
    });

    // Stage 1 checks (2) + stage 2 pre-search check (1) => false, then cancel after searches.
    firestoreTracker.isJobCancelled.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

    await handlePipelineExecution({
      job_id: 'job_test_cancel_after_weaviate',
      uid: 'user_1',
      business_description: 'desc',
      top_n: 10,
      weaviate_top_n: 500,
      llm_top_n: 10,
      request_id: 'req_cancel_weaviate',
    });

    expect(firestoreTracker.updatePipelineJobStatus).toHaveBeenCalledWith('job_test_cancel_after_weaviate', 'cancelled');
    expect(firestoreTracker.updateProgress).toHaveBeenCalledWith(
      'job_test_cancel_after_weaviate',
      'weaviate_search',
      'searches_complete'
    );
  });

  it('updates stage error state when Weaviate search throws', async () => {
    weaviateSearch.performParallelHybridSearches.mockRejectedValueOnce(new Error('weaviate down'));

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

    await expect(
      handlePipelineExecution({
        job_id: 'job_test_weaviate_error',
        uid: 'user_1',
        business_description: 'desc',
        top_n: 10,
        weaviate_top_n: 500,
        llm_top_n: 10,
        request_id: 'req_weaviate_err',
      })
    ).rejects.toThrow('weaviate down');

    expect(firestoreTracker.updateWeaviateSearchStage).toHaveBeenCalledWith(
      'job_test_weaviate_error',
      'error',
      undefined,
      undefined,
      expect.any(Number),
      'weaviate down'
    );
  });

  it('builds follower requirements from campaign collected data and cancels early', async () => {
    // Seed campaign docs used by worker campaign expansion.
    await campaignDb
      .collection('users')
      .doc('user_1')
      .collection('campaigns')
      .doc('camp_followers')
      .set({});
    await campaignDb
      .collection('users')
      .doc('user_1')
      .collection('campaigns')
      .doc('camp_followers')
      .collection('collected')
      .doc('data')
      .set({ min_followers: '1000', max_followers: 2000 });

    firestoreTracker.isJobCancelled.mockResolvedValue(true);

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

    await handlePipelineExecution({
      job_id: 'job_test_campaign_followers',
      uid: 'user_1',
      campaign_id: 'camp_followers',
      business_description: 'desc',
      top_n: 10,
      weaviate_top_n: 500,
      llm_top_n: 10,
      request_id: 'req_campaign_followers',
    });

    expect(firestoreTracker.updatePipelineJobStatus).toHaveBeenCalledWith('job_test_campaign_followers', 'cancelled');
  });

  it('covers campaign expansion branches for missing campaign and fetch errors', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    firestoreTracker.isJobCancelled.mockResolvedValue(true);

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

    // Campaign doc missing.
    await handlePipelineExecution({
      job_id: 'job_test_campaign_missing',
      uid: 'user_1',
      campaign_id: 'nope',
      business_description: 'desc',
      top_n: 10,
      weaviate_top_n: 500,
      llm_top_n: 10,
      request_id: 'req_campaign_missing',
    });

    // Campaign fetch fails.
    (campaignDb as any).collection = () => {
      throw new Error('firestore down');
    };
    await handlePipelineExecution({
      job_id: 'job_test_campaign_fetch_fail',
      uid: 'user_1',
      campaign_id: 'camp_1',
      business_description: 'desc',
      top_n: 10,
      weaviate_top_n: 500,
      llm_top_n: 10,
      request_id: 'req_campaign_fetch_fail',
    });

    expectStructuredLogMessage(warnSpy, 'campaign_description_failed');
  });

  it('processes cached TikTok batches and warns when progressive updates fail', async () => {
    const llmTopN = 2;
    const candidateUrls = makeUrls(2, 'tiktok');
    const weaviateResults = makeWeaviateResults(candidateUrls, 'tiktok');

    weaviateSearch.performParallelHybridSearches.mockResolvedValue({
      allSearchResults: [],
      deduplicatedResults: weaviateResults,
      queriesExecuted: 2,
      batchTimings: [],
      totalRuntimeMs: 1,
    });

    brightdataCache.detectPlatformFromUrl.mockImplementation((url: string) =>
      url.includes('tiktok.com') ? 'tiktok' : 'instagram'
    );
    const cachedProfiles = makeRawProfiles(candidateUrls, 'tiktok');
    const cacheMap = new Map<string, any>(candidateUrls.map((u, i) => [u, cachedProfiles[i]]));
    brightdataCache.getCachedProfilesBatch.mockResolvedValue(cacheMap);

    // Never hit good-fit threshold so we don't short-circuit before the TikTok loop runs.
    llmAnalysis.analyzeProfileFitBatch.mockResolvedValue(
      cachedProfiles.map(() => ({ fit_score: 0, fit_rationale: 'r', fit_summary: 's' }))
    );

    firestoreTracker.updateProgressiveTopN.mockRejectedValueOnce(new Error('progressive down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');
    await handlePipelineExecution({
      job_id: 'job_test_cached_tiktok',
      uid: 'user_1',
      business_description: 'desc',
      top_n: llmTopN,
      weaviate_top_n: 500,
      llm_top_n: llmTopN,
      request_id: 'req_cached_tiktok',
    });

    expectStructuredLogMessage(warnSpy, 'progressive_topn_failed');
  });

  it('handles BrightData trigger failures (no snapshot returned and thrown errors)', async () => {
    const llmTopN = 10;
    const candidateUrls = makeUrls(40, 'tiktok'); // 2 batches @ 20
    const weaviateResults = makeWeaviateResults(candidateUrls, 'tiktok');

    weaviateSearch.performParallelHybridSearches.mockResolvedValue({
      allSearchResults: [],
      deduplicatedResults: weaviateResults,
      queriesExecuted: 2,
      batchTimings: [],
      totalRuntimeMs: 1,
    });

    brightdataCache.detectPlatformFromUrl.mockImplementation(() => 'tiktok');
    brightdataCache.getCachedProfilesBatch.mockResolvedValue(new Map());

    // First trigger returns wrong platform snapshot, second throws.
    brightdataInternal.triggerCollection
      .mockResolvedValueOnce([{ snapshot_id: 'snap_wrong', platform: 'instagram' as const }])
      .mockRejectedValueOnce(new Error('trigger down'));

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');
    await handlePipelineExecution({
      job_id: 'job_test_trigger_failures',
      uid: 'user_1',
      business_description: 'desc',
      top_n: llmTopN,
      weaviate_top_n: 500,
      llm_top_n: llmTopN,
      request_id: 'req_trigger_fail',
    });

    expect(firestoreTracker.updateBatchCounters).toHaveBeenCalled();
  });

  it('logs progress check failures and times out individual batches after 5 minutes', async () => {
    vi.useFakeTimers();
    try {
      const llmTopN = 10;
      const candidateUrls = makeUrls(20, 'instagram');
      const weaviateResults = makeWeaviateResults(candidateUrls, 'instagram');

      weaviateSearch.performParallelHybridSearches.mockResolvedValue({
        allSearchResults: [],
        deduplicatedResults: weaviateResults,
        queriesExecuted: 2,
        batchTimings: [],
        totalRuntimeMs: 1,
      });

      brightdataCache.getCachedProfilesBatch.mockResolvedValue(new Map());

      // Progress check rejects → allSettled produces rejected.
      brightdataInternal.checkProgress.mockRejectedValueOnce(new Error('progress down'));

      const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

      const promise = handlePipelineExecution({
        job_id: 'job_test_progress_reject',
        uid: 'user_1',
        business_description: 'desc',
        top_n: llmTopN,
        weaviate_top_n: 500,
        llm_top_n: llmTopN,
        request_id: 'req_progress_reject',
      });

      // Advance beyond the per-batch timeout (5 minutes) and a poll interval.
      await vi.advanceTimersByTimeAsync(301_000);
      await promise;

      expect(firestoreTracker.updateBatchCounters).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('warns when caching BrightData profiles fails and when finalizing progressive results fails', async () => {
    const llmTopN = 10;
    const candidateUrls = makeUrls(20, 'instagram');
    const weaviateResults = makeWeaviateResults(candidateUrls, 'instagram');

    weaviateSearch.performParallelHybridSearches.mockResolvedValue({
      allSearchResults: [],
      deduplicatedResults: weaviateResults,
      queriesExecuted: 2,
      batchTimings: [],
      totalRuntimeMs: 1,
    });

    brightdataCache.getCachedProfilesBatch.mockResolvedValue(new Map());
    brightdataInternal.checkProgress.mockResolvedValue({
      snapshot_id: 'snap_1',
      dataset_id: 'ds',
      status: 'ready' as const,
    });
    brightdataInternal.downloadResults.mockResolvedValue(makeRawProfiles(candidateUrls, 'instagram'));

    brightdataCache.setCachedProfilesBatch.mockRejectedValueOnce(new Error('cache down'));
    firestoreTracker.finalizeProgressiveResults.mockRejectedValueOnce(new Error('finalize down'));
    llmAnalysis.analyzeProfileFitBatch.mockResolvedValue(
      makeRawProfiles(candidateUrls, 'instagram').map(() => ({ fit_score: 90, fit_rationale: 'r', fit_summary: 's' }))
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');
    await handlePipelineExecution({
      job_id: 'job_test_cache_and_finalize_warn',
      uid: 'user_1',
      business_description: 'desc',
      top_n: llmTopN,
      weaviate_top_n: 500,
      llm_top_n: llmTopN,
      request_id: 'req_cache_finalize_warn',
    });

    expectStructuredLogMessage(warnSpy, 'brightdata_batch_cache_failed');
    expectStructuredLogMessage(warnSpy, 'progressive_finalize_failed');
  });

  it('updates stage error state when a batch returns a non-array profile payload', async () => {
    const llmTopN = 10;
    const candidateUrls = makeUrls(20, 'instagram');
    const weaviateResults = makeWeaviateResults(candidateUrls, 'instagram');

    weaviateSearch.performParallelHybridSearches.mockResolvedValue({
      allSearchResults: [],
      deduplicatedResults: weaviateResults,
      queriesExecuted: 2,
      batchTimings: [],
      totalRuntimeMs: 1,
    });

    brightdataCache.getCachedProfilesBatch.mockResolvedValue(new Map());
    brightdataInternal.checkProgress.mockResolvedValue({
      snapshot_id: 'snap_1',
      dataset_id: 'ds',
      status: 'ready' as const,
    });

    // Non-array should throw inside processAndStoreBatch.
    brightdataInternal.downloadResults.mockResolvedValue({ not: 'an array' } as any);

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');
    await expect(
      handlePipelineExecution({
        job_id: 'job_test_non_array_batch',
        uid: 'user_1',
        business_description: 'desc',
        top_n: llmTopN,
        weaviate_top_n: 500,
        llm_top_n: llmTopN,
        request_id: 'req_non_array_batch',
      })
    ).rejects.toThrow(/not an array/);

    expect(firestoreTracker.updateBrightDataStage).toHaveBeenCalledWith(
      'job_test_non_array_batch',
      'error',
      expect.any(Number),
      undefined,
      expect.stringMatching(/not an array/)
    );
  });

  it('cancels before Weaviate searches start (stage 2 pre-search cancellation)', async () => {
    // Stage 1 checks (2) => false, then stage 2 pre-search check => true.
    firestoreTracker.isJobCancelled.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

    await handlePipelineExecution({
      job_id: 'job_test_cancel_before_weaviate',
      uid: 'user_1',
      business_description: 'desc',
      top_n: 10,
      weaviate_top_n: 500,
      llm_top_n: 10,
      request_id: 'req_cancel_before_weaviate',
    });

    expect(firestoreTracker.updatePipelineJobStatus).toHaveBeenCalledWith('job_test_cancel_before_weaviate', 'cancelled');
    expect(weaviateSearch.performParallelHybridSearches).not.toHaveBeenCalled();
  });

  it('logs campaign exists-but-empty branch when campaign has no usable collected data', async () => {
    const llmTopN = 1;
    const candidateUrls = makeUrls(1, 'instagram');
    const weaviateResults = makeWeaviateResults(candidateUrls, 'instagram');

    await campaignDb
      .collection('users')
      .doc('user_1')
      .collection('campaigns')
      .doc('camp_empty')
      .set({});
    // No collected/data doc.

    weaviateSearch.performParallelHybridSearches.mockResolvedValue({
      allSearchResults: [],
      deduplicatedResults: weaviateResults,
      queriesExecuted: 2,
      batchTimings: [],
      totalRuntimeMs: 1,
    });

    const cachedProfiles = makeRawProfiles(candidateUrls, 'instagram');
    const cacheMap = new Map<string, any>(candidateUrls.map((u, i) => [u, cachedProfiles[i]]));
    brightdataCache.getCachedProfilesBatch.mockResolvedValue(cacheMap);

    llmAnalysis.analyzeProfileFitBatch.mockResolvedValue([{ fit_score: 0, fit_rationale: 'r', fit_summary: 's' }]);

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');
    await handlePipelineExecution({
      job_id: 'job_test_campaign_empty',
      uid: 'user_1',
      campaign_id: 'camp_empty',
      business_description: 'desc',
      top_n: llmTopN,
      weaviate_top_n: 500,
      llm_top_n: llmTopN,
      request_id: 'req_campaign_empty',
    });

    expectStructuredLogMessage(debugSpy, 'campaign_description_missing_collected');
    const [, campaignDescription] = llmAnalysis.analyzeProfileFitBatch.mock.calls[0] as any[];
    expect(campaignDescription).toBe('desc');
  });

  it('includes follower range from collected data (number) in the campaign description', async () => {
    const llmTopN = 1;
    const candidateUrls = makeUrls(1, 'instagram');
    const weaviateResults = makeWeaviateResults(candidateUrls, 'instagram');

    await campaignDb
      .collection('users')
      .doc('user_1')
      .collection('campaigns')
      .doc('camp_followers_collected')
      .set({});
    await campaignDb
      .collection('users')
      .doc('user_1')
      .collection('campaigns')
      .doc('camp_followers_collected')
      .collection('collected')
      .doc('data')
      .set({
        min_followers: 1200,
        max_followers: 3400,
      });

    weaviateSearch.performParallelHybridSearches.mockResolvedValue({
      allSearchResults: [],
      deduplicatedResults: weaviateResults,
      queriesExecuted: 2,
      batchTimings: [],
      totalRuntimeMs: 1,
    });

    const cachedProfiles = makeRawProfiles(candidateUrls, 'instagram');
    const cacheMap = new Map<string, any>(candidateUrls.map((u, i) => [u, cachedProfiles[i]]));
    brightdataCache.getCachedProfilesBatch.mockResolvedValue(cacheMap);

    llmAnalysis.analyzeProfileFitBatch.mockResolvedValue([{ fit_score: 0, fit_rationale: 'r', fit_summary: 's' }]);

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');
    await handlePipelineExecution({
      job_id: 'job_test_campaign_followers_collected',
      uid: 'user_1',
      campaign_id: 'camp_followers_collected',
      business_description: 'desc',
      top_n: llmTopN,
      weaviate_top_n: 500,
      llm_top_n: llmTopN,
      request_id: 'req_campaign_followers_collected',
    });

    const [, campaignDescription] = llmAnalysis.analyzeProfileFitBatch.mock.calls[0] as any[];
    expect(campaignDescription).toContain('Followers: 1,200-3,400');
  });

  it('includes follower range from followerRange + followersMin/Max + request fallbacks', async () => {
    const llmTopN = 1;
    const candidateUrls = makeUrls(1, 'instagram');
    const weaviateResults = makeWeaviateResults(candidateUrls, 'instagram');

    const cachedProfiles = makeRawProfiles(candidateUrls, 'instagram');
    const cacheMap = new Map<string, any>(candidateUrls.map((u, i) => [u, cachedProfiles[i]]));
    brightdataCache.getCachedProfilesBatch.mockResolvedValue(cacheMap);
    llmAnalysis.analyzeProfileFitBatch.mockResolvedValue([{ fit_score: 0, fit_rationale: 'r', fit_summary: 's' }]);

    weaviateSearch.performParallelHybridSearches.mockResolvedValue({
      allSearchResults: [],
      deduplicatedResults: weaviateResults,
      queriesExecuted: 2,
      batchTimings: [],
      totalRuntimeMs: 1,
    });

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

    // followerRange fallback
    await campaignDb
      .collection('users')
      .doc('user_1')
      .collection('campaigns')
      .doc('camp_followers_range')
      .set({ followerRange: { min: 10, max: 20 } });
    await handlePipelineExecution({
      job_id: 'job_test_campaign_followers_range',
      uid: 'user_1',
      campaign_id: 'camp_followers_range',
      business_description: 'desc',
      top_n: llmTopN,
      weaviate_top_n: 500,
      llm_top_n: llmTopN,
      request_id: 'req_campaign_followers_range',
    });
    {
      const [, campaignDescription] = llmAnalysis.analyzeProfileFitBatch.mock.calls.at(-1) as any[];
      expect(campaignDescription).toContain('Followers: 10-20');
    }

    // followersMin/followersMax fallback
    await campaignDb
      .collection('users')
      .doc('user_1')
      .collection('campaigns')
      .doc('camp_followers_minmax')
      .set({ followersMin: 5, followersMax: 6 });
    await handlePipelineExecution({
      job_id: 'job_test_campaign_followers_minmax',
      uid: 'user_1',
      campaign_id: 'camp_followers_minmax',
      business_description: 'desc',
      top_n: llmTopN,
      weaviate_top_n: 500,
      llm_top_n: llmTopN,
      request_id: 'req_campaign_followers_minmax',
    });
    {
      const [, campaignDescription] = llmAnalysis.analyzeProfileFitBatch.mock.calls.at(-1) as any[];
      expect(campaignDescription).toContain('Followers: 5-6');
    }

    // request fallback
    await campaignDb
      .collection('users')
      .doc('user_1')
      .collection('campaigns')
      .doc('camp_followers_request')
      .set({});
    await handlePipelineExecution({
      job_id: 'job_test_campaign_followers_request',
      uid: 'user_1',
      campaign_id: 'camp_followers_request',
      business_description: 'desc',
      top_n: llmTopN,
      weaviate_top_n: 500,
      llm_top_n: llmTopN,
      min_followers: 7,
      max_followers: 8,
      request_id: 'req_campaign_followers_request',
    });
    {
      const [, campaignDescription] = llmAnalysis.analyzeProfileFitBatch.mock.calls.at(-1) as any[];
      expect(campaignDescription).toContain('Followers: 7-8');
    }
  });

  it('runs the stage 4/5 cancellation handler when cancelled during BrightData processing', async () => {
    const llmTopN = 10;
    const candidateUrls = makeUrls(20, 'instagram');
    const weaviateResults = makeWeaviateResults(candidateUrls, 'instagram');

    weaviateSearch.performParallelHybridSearches.mockResolvedValue({
      allSearchResults: [],
      deduplicatedResults: weaviateResults,
      queriesExecuted: 2,
      batchTimings: [],
      totalRuntimeMs: 1,
    });

    let stage4Started = false;
    brightdataCache.getCachedProfilesBatch.mockImplementationOnce(async () => {
      stage4Started = true;
      return new Map();
    });
    firestoreTracker.isJobCancelled.mockImplementation(async () => stage4Started);

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');
    await handlePipelineExecution({
      job_id: 'job_test_cancel_stage4',
      uid: 'user_1',
      business_description: 'desc',
      top_n: llmTopN,
      weaviate_top_n: 500,
      llm_top_n: llmTopN,
      request_id: 'req_cancel_stage4',
    });

    expect(firestoreTracker.updatePipelineJobStatus).toHaveBeenCalledWith('job_test_cancel_stage4', 'cancelled');
  });

  it('times out the BrightData phase if the overall deadline is exceeded', async () => {
    const llmTopN = 10;
    const candidateUrls = makeUrls(20, 'instagram');
    const weaviateResults = makeWeaviateResults(candidateUrls, 'instagram');

    weaviateSearch.performParallelHybridSearches.mockResolvedValue({
      allSearchResults: [],
      deduplicatedResults: weaviateResults,
      queriesExecuted: 2,
      batchTimings: [],
      totalRuntimeMs: 1,
    });

    brightdataCache.getCachedProfilesBatch.mockResolvedValue(new Map());

    let now = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      brightdataInternal.triggerCollection.mockImplementationOnce(async () => {
        // brightdataStart is captured before triggering; jump forward by >1hr before the poll loop.
        now = 3_600_000 + 1;
        return [{ snapshot_id: `snap_${++state.snapshotCounter}`, platform: 'instagram' as const }];
      });

      const { handlePipelineExecution } = await import('../dist/handlers/worker.js');
      await handlePipelineExecution({
        job_id: 'job_test_brightdata_global_timeout',
        uid: 'user_1',
        business_description: 'desc',
        top_n: llmTopN,
        weaviate_top_n: 500,
        llm_top_n: llmTopN,
        request_id: 'req_brightdata_global_timeout',
      });
    } finally {
      nowSpy.mockRestore();
    }

    expect(firestoreTracker.updateBatchCounters).toHaveBeenCalled();
    expect(firestoreTracker.updatePipelineJobStatus).toHaveBeenCalledWith('job_test_brightdata_global_timeout', 'completed');
  });

  it('times out individual BrightData batches after 5 minutes when progress never reaches ready/completed/failed', async () => {
    vi.useFakeTimers();
    try {
      const llmTopN = 10;
      const candidateUrls = makeUrls(20, 'instagram');
      const weaviateResults = makeWeaviateResults(candidateUrls, 'instagram');

      weaviateSearch.performParallelHybridSearches.mockResolvedValue({
        allSearchResults: [],
        deduplicatedResults: weaviateResults,
        queriesExecuted: 2,
        batchTimings: [],
        totalRuntimeMs: 1,
      });

      brightdataCache.getCachedProfilesBatch.mockResolvedValue(new Map());
      brightdataInternal.checkProgress.mockResolvedValue({
        snapshot_id: 'snap_1',
        dataset_id: 'ds',
        status: 'running' as any,
      });

      const { handlePipelineExecution } = await import('../dist/handlers/worker.js');

      const promise = handlePipelineExecution({
        job_id: 'job_test_brightdata_batch_timeout',
        uid: 'user_1',
        business_description: 'desc',
        top_n: llmTopN,
        weaviate_top_n: 500,
        llm_top_n: llmTopN,
        request_id: 'req_brightdata_batch_timeout',
      });

      await vi.advanceTimersByTimeAsync(311_000);
      await promise;

      expect(firestoreTracker.updateBatchCounters).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels inside processAndStoreBatch before normalization (first internal cancellation check)', async () => {
    const llmTopN = 1;
    const candidateUrls = makeUrls(1, 'instagram');
    const weaviateResults = makeWeaviateResults(candidateUrls, 'instagram');

    weaviateSearch.performParallelHybridSearches.mockResolvedValue({
      allSearchResults: [],
      deduplicatedResults: weaviateResults,
      queriesExecuted: 2,
      batchTimings: [],
      totalRuntimeMs: 1,
    });

    const cachedProfiles = makeRawProfiles(candidateUrls, 'instagram');
    const cacheMap = new Map<string, any>(candidateUrls.map((u, i) => [u, cachedProfiles[i]]));

    let stage4Started = false;
    let cancelNext = false;
    brightdataCache.getCachedProfilesBatch.mockImplementationOnce(async () => {
      stage4Started = true;
      return cacheMap;
    });
    firestoreTracker.isJobCancelled.mockImplementation(async () => {
      if (!stage4Started) return false;
      if (cancelNext) return true;
      cancelNext = true;
      return false;
    });

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');
    await handlePipelineExecution({
      job_id: 'job_test_cancel_in_batch_pre_norm',
      uid: 'user_1',
      business_description: 'desc',
      top_n: llmTopN,
      weaviate_top_n: 500,
      llm_top_n: llmTopN,
      request_id: 'req_cancel_in_batch_pre_norm',
    });

    expect(firestoreTracker.updatePipelineJobStatus).toHaveBeenCalledWith('job_test_cancel_in_batch_pre_norm', 'cancelled');
  });

  it('cancels inside processAndStoreBatch after normalization (second internal cancellation check)', async () => {
    const llmTopN = 1;
    const candidateUrls = makeUrls(1, 'instagram');
    const weaviateResults = makeWeaviateResults(candidateUrls, 'instagram');

    weaviateSearch.performParallelHybridSearches.mockResolvedValue({
      allSearchResults: [],
      deduplicatedResults: weaviateResults,
      queriesExecuted: 2,
      batchTimings: [],
      totalRuntimeMs: 1,
    });

    const cachedProfiles = makeRawProfiles(candidateUrls, 'instagram');
    const cacheMap = new Map<string, any>(candidateUrls.map((u, i) => [u, cachedProfiles[i]]));

    let stage4Started = false;
    let stage4CancelCalls = 0;
    brightdataCache.getCachedProfilesBatch.mockImplementationOnce(async () => {
      stage4Started = true;
      return cacheMap;
    });
    firestoreTracker.isJobCancelled.mockImplementation(async () => {
      if (!stage4Started) return false;
      stage4CancelCalls += 1;
      // outer loop check (1) => false, inside batch pre-norm (2) => false, post-norm (3) => true
      return stage4CancelCalls >= 3;
    });

    const { handlePipelineExecution } = await import('../dist/handlers/worker.js');
    await handlePipelineExecution({
      job_id: 'job_test_cancel_in_batch_post_norm',
      uid: 'user_1',
      business_description: 'desc',
      top_n: llmTopN,
      weaviate_top_n: 500,
      llm_top_n: llmTopN,
      request_id: 'req_cancel_in_batch_post_norm',
    });

    expect(firestoreTracker.updatePipelineJobStatus).toHaveBeenCalledWith(
      'job_test_cancel_in_batch_post_norm',
      'cancelled'
    );
    expect(llmAnalysis.analyzeProfileFitBatch).not.toHaveBeenCalled();
  });
});
