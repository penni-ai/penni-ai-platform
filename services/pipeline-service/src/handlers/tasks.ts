import { z } from 'zod';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { generateSearchQueriesFromDescription } from '../utils/search-query-generator.js';
import { performParallelHybridSearches } from '../utils/weaviate-search.js';
import { normalizeProfiles } from '../utils/profile-normalizer.js';
import { analyzeProfileFitBatch } from '../utils/llm-analysis.js';
import {
	appendBatchResults,
	finalizePipelineProgress,
	finalizeProgressiveResults,
	getPipelineJob,
	isJobCancelled,
	mergeBatchResults,
	saveWeaviateCandidates,
	storePipelineResults,
	storeRemainingProfiles,
	updateBrightDataStage,
	updateLLMAnalysisStage,
	updatePipelineJobStatus,
	updatePipelineStage,
	updateProgress,
	updateProgressiveTopN,
	updateQueryExpansionStage,
	updateWeaviateSearchStage,
	completeStage,
} from '../utils/firestore-tracker.js';
import {
	getCachedProfilesBatch,
	setCachedProfilesBatch,
	detectPlatformFromUrl,
	extractProfileUrl,
} from '../utils/brightdata-cache.js';
import {
	checkProgress,
	downloadResults,
	getBrightDataApiKey,
	getBrightDataBaseUrl,
	getMaxWaitTime,
	getPollingInterval,
	triggerCollection,
} from '../utils/brightdata-internal.js';
import { enqueueTask } from '../utils/cloud-tasks.js';
import { getFirestoreInstance } from '../utils/firebase-admin.js';
import { writePipelineSummary } from '../utils/pipeline-summary.js';
import { createLogger } from '../utils/logger.js';
import type { BrightDataProfile, BrightDataPlatform, BrightDataUnifiedProfile } from '../types/brightdata.js';

const db = getFirestoreInstance();
const PIPELINE_COLLECTION = 'pipeline_jobs';
const BATCH_COLLECTION = 'batches';
const logger = createLogger({ component: 'tasks' });

async function writeSummarySafe(jobId: string, reason: string): Promise<void> {
	try {
		await writePipelineSummary(jobId);
	} catch (error) {
		logger.warn('tasks_pipeline_summary_failed', { job_id: jobId, reason, error });
	}
}

const stageTaskSchema = z.object({
	job_id: z.string().min(1),
	uid: z.string().min(1),
	campaign_id: z.string().optional(),
	business_description: z.string().min(1),
	top_n: z.number().int().min(10).max(1000),
	weaviate_top_n: z.number().int().min(100),
	llm_top_n: z.number().int().min(10),
	min_followers: z.number().int().min(0).optional().nullable(),
	max_followers: z.number().int().min(0).optional().nullable(),
	platform: z.enum(['instagram', 'tiktok']).optional().nullable(),
	request_id: z.string().optional(),
	exclude_profile_urls: z.array(z.string()).optional().nullable(),
	strict_location_matching: z.boolean().optional(),
});

const batchTaskSchema = z.object({
	job_id: z.string().min(1),
	batch_id: z.number().int().min(0),
});

type StageTaskPayload = z.infer<typeof stageTaskSchema>;

type BatchStatus = 'pending' | 'running' | 'triggered' | 'completed' | 'failed' | 'skipped';

type BatchType = 'cache' | 'brightdata';

type PipelineBatchRecord = {
	batch_id: number;
	type: BatchType;
	platform: BrightDataPlatform;
	status: BatchStatus;
	urls: string[];
	snapshot_id?: string | null;
	poll_attempts?: number;
	started_at?: Timestamp | null;
	triggered_at?: Timestamp | null;
	completed_at?: Timestamp | null;
	created_at: Timestamp;
	updated_at: Timestamp;
	last_error?: string | null;
};

function getBatchRef(jobId: string, batchId: number) {
	return db.collection(PIPELINE_COLLECTION).doc(jobId).collection(BATCH_COLLECTION).doc(String(batchId));
}

function getGoodFitThreshold(): number {
	return 100;
}

function isGoodFit(profile: { fit_score?: number }): boolean {
	return (profile.fit_score ?? 0) >= getGoodFitThreshold();
}

function getMaxConcurrentLLMRequests(): number {
	const raw = Number(process.env.MAX_CONCURRENT_LLM_REQUESTS || process.env.MAX_CONCURRENT_LLM_ANALYSES || '100');
	const configured = Number.isFinite(raw) ? Math.floor(raw) : 100;
	return Math.min(100, Math.max(1, configured));
}

function getBatchSize(): number {
	const raw = Number(process.env.BRIGHTDATA_BATCH_SIZE || '20');
	return Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 20;
}

function getMaxInFlightBatches(): number {
	const raw = Number(process.env.BRIGHTDATA_MAX_IN_FLIGHT || '5');
	return Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 5;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += chunkSize) {
		chunks.push(items.slice(i, i + chunkSize));
	}
	return chunks;
}

function extractTopCandidates(
	results: any[],
	topN: number,
	platform?: string | null
): Array<{
	id: string;
	score?: number;
	distance?: number;
	profile_url: string;
	platform?: string;
	display_name?: string;
	biography?: string;
	followers?: number;
}> {
	const candidates: Array<{
		id: string;
		score?: number;
		distance?: number;
		profile_url: string;
		platform?: string;
		display_name?: string;
		biography?: string;
		followers?: number;
	}> = [];

	for (const result of results) {
		if (candidates.length >= topN) break;

		const profileUrl = result.data?.profile_url || result.profile_url || result.url;
		const profilePlatform = result.data?.platform || result.platform;

		if (platform && profilePlatform && profilePlatform.toLowerCase() !== platform.toLowerCase()) {
			continue;
		}

		if (profileUrl && (profileUrl.includes('instagram.com') || profileUrl.includes('tiktok.com'))) {
			candidates.push({
				id: result.id || result.uuid || '',
				score: result.score || result.metadata?.score,
				distance: result.distance || result.metadata?.distance,
				profile_url: profileUrl,
				platform: profilePlatform,
				display_name: result.data?.display_name,
				biography: result.data?.biography,
				followers: typeof result.data?.followers === 'number' ? result.data.followers : undefined,
			});
		}
	}

	return candidates;
}

async function buildCampaignDescription(payload: StageTaskPayload): Promise<string> {
	const { business_description, uid, campaign_id } = payload;
	const descriptionLogger = logger.child({
		action: 'build_campaign_description',
		job_id: payload.job_id,
		uid,
		campaign_id: campaign_id ?? null,
	});
	if (!campaign_id) {
		return business_description;
	}

	try {
		const campaignDoc = await db
			.collection('users')
			.doc(uid)
			.collection('campaigns')
			.doc(campaign_id)
			.get();

		if (!campaignDoc.exists) {
			descriptionLogger.info('campaign_missing', { campaign_id });
			return business_description;
		}

		const campaignData = campaignDoc.data() || {};
		const collectedDoc = await db
			.collection('users')
			.doc(uid)
			.collection('campaigns')
			.doc(campaign_id)
			.collection('collected')
			.doc('data')
			.get();

		const collectedData = collectedDoc.exists ? collectedDoc.data() : null;
		const details: string[] = [];

		const businessName = collectedData?.business_name || campaignData?.business_name || null;
		const businessAbout =
			collectedData?.business_about || campaignData?.business_about || campaignData?.businessSummary || null;
		const website = collectedData?.website || campaignData?.website || null;

		if (businessName) {
			details.push(`Business Name: ${businessName}`);
		}
		if (businessAbout) {
			details.push(`Business Description: ${businessAbout}`);
		}
		if (website && website !== 'N/A') {
			details.push(`Website: ${website}`);
		}

		const requirements: string[] = [];
		const influencerLocation =
			collectedData?.influencer_location || campaignData?.influencer_location || campaignData?.locations || null;
		if (influencerLocation) {
			requirements.push(`Influencer Location: ${influencerLocation}`);
		}

		const typeOfInfluencer =
			collectedData?.type_of_influencer || campaignData?.type_of_influencer || campaignData?.influencer_type || null;
		if (typeOfInfluencer) {
			requirements.push(`Influencer Type: ${typeOfInfluencer}`);
		}

		const platformValue = collectedData?.platform || campaignData?.platform || null;
		if (platformValue) {
			requirements.push(`Platform: ${platformValue}`);
		}

		const followerMin = collectedData?.min_followers || campaignData?.min_followers || null;
		const followerMax = collectedData?.max_followers || campaignData?.max_followers || null;
		if (followerMin || followerMax) {
			requirements.push(`Follower Range: ${followerMin || 0}-${followerMax || 'any'}`);
		}

		if (requirements.length > 0) {
			details.push(`Influencer Requirements: ${requirements.join(', ')}`);
		}

		if (details.length === 0) {
			return business_description;
		}

		return `${business_description}\n\n${details.join('\n')}`;
	} catch (error) {
		descriptionLogger.warn('campaign_description_failed', { error });
		return business_description;
	}
}

async function createBatch(jobId: string, batch: Omit<PipelineBatchRecord, 'created_at' | 'updated_at'>) {
	const now = Timestamp.now();
	await getBatchRef(jobId, batch.batch_id).set({
		...batch,
		started_at: null,
		triggered_at: null,
		completed_at: null,
		created_at: now,
		updated_at: now,
	});
}

async function claimBatch(jobId: string, batchId: number): Promise<PipelineBatchRecord | null> {
	return db.runTransaction(async (tx) => {
		const ref = getBatchRef(jobId, batchId);
		const doc = await tx.get(ref);
		if (!doc.exists) {
			return null;
		}
		const data = doc.data() as PipelineBatchRecord;
		if (data.status !== 'pending') {
			return data;
		}

		const now = Timestamp.now();
		const updates: Partial<PipelineBatchRecord> = { status: 'running', updated_at: now };
		if (!data.started_at) {
			updates.started_at = now;
		}

		tx.update(ref, updates);
		return { ...data, ...updates, status: 'running' };
	});
}

async function updateBatch(jobId: string, batchId: number, updates: Partial<PipelineBatchRecord>) {
	const now = Timestamp.now();
	const nextUpdates: Record<string, unknown> = {
		...updates,
		updated_at: now,
	};

	if (typeof updates.status === 'string') {
		if (updates.status === 'triggered') {
			nextUpdates.triggered_at = now;
		}
		if (updates.status === 'completed' || updates.status === 'failed' || updates.status === 'skipped') {
			nextUpdates.completed_at = now;
		}
	}

	await getBatchRef(jobId, batchId).update(nextUpdates);
}

async function incrementJobCounters(jobId: string, updates: Record<string, number>): Promise<void> {
	const payload: Record<string, unknown> = { updated_at: Timestamp.now() };
	for (const [key, value] of Object.entries(updates)) {
		payload[key] = FieldValue.increment(value);
	}
	await db.collection(PIPELINE_COLLECTION).doc(jobId).update(payload);
}

async function updateGoodFitCount(jobId: string, incrementBy: number): Promise<{ count: number; target: number }> {
	return db.runTransaction(async (tx) => {
		const ref = db.collection(PIPELINE_COLLECTION).doc(jobId);
		const doc = await tx.get(ref);
		if (!doc.exists) {
			return { count: incrementBy, target: incrementBy };
		}
		const data = doc.data() as any;
		const current = Number.isFinite(data.good_fit_count) ? data.good_fit_count : 0;
		const target = Number.isFinite(data.llm_top_n) ? data.llm_top_n : data.top_n || 0;
		const next = current + incrementBy;
		const stopRequested = target > 0 && next >= target;

		tx.update(ref, {
			good_fit_count: next,
			stop_requested: stopRequested || data.stop_requested === true,
			updated_at: Timestamp.now(),
		});

		return { count: next, target };
	});
}

async function tryStartFinalization(jobId: string): Promise<boolean> {
	return db.runTransaction(async (tx) => {
		const ref = db.collection(PIPELINE_COLLECTION).doc(jobId);
		const doc = await tx.get(ref);
		if (!doc.exists) {
			return false;
		}
		const data = doc.data() as any;
		if (data.finalization_started) {
			return false;
		}
		tx.update(ref, { finalization_started: true, updated_at: Timestamp.now() });
		return true;
	});
}

async function finalizePipelineIfReady(jobId: string): Promise<void> {
	const job = await getPipelineJob(jobId);
	if (!job) {
		return;
	}

	if (job.status === 'completed' || job.status === 'error' || job.status === 'cancelled') {
		return;
	}

	const totalBatches = job.brightdata_collection?.total_batches || 0;
	const completed = job.brightdata_collection?.batches_completed || 0;
	const failed = job.brightdata_collection?.batches_failed || 0;
	const stopRequested = job.stop_requested === true;

	if (!stopRequested && completed + failed < totalBatches) {
		return;
	}

	const claimed = await tryStartFinalization(jobId);
	if (!claimed) {
		return;
	}

	const mergedProfiles = await mergeBatchResults(jobId, totalBatches);
	mergedProfiles.sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));

	const llmTopN = job.llm_top_n || job.top_n || 0;
	const finalProfiles = llmTopN > 0 ? mergedProfiles.slice(0, llmTopN) : mergedProfiles;
	const remainingProfiles = llmTopN > 0 ? mergedProfiles.slice(llmTopN) : [];

	try {
		await finalizeProgressiveResults(jobId);
	} catch (error) {
		logger.warn('tasks_progressive_finalize_failed', { job_id: jobId, error });
	}

	if (remainingProfiles.length > 0) {
		try {
			await storeRemainingProfiles(jobId, remainingProfiles);
		} catch (error) {
			logger.warn('tasks_store_remaining_profiles_failed', { job_id: jobId, error });
		}
	}

	const cacheHits = job.brightdata_collection?.cache_hits || 0;
	const apiCalls = job.brightdata_collection?.api_calls || 0;
	const brightdataCost = apiCalls * 0.0015;
	const openaiCost = mergedProfiles.length * 0.0015;
	const totalCost = brightdataCost + openaiCost;

	const pipelineStats = {
		queries_generated: job.query_expansion?.queries?.length || 0,
		total_search_results: job.weaviate_search?.total_results || 0,
		deduplicated_results: job.weaviate_search?.deduplicated_results || 0,
		profiles_collected: finalProfiles.length,
		profiles_analyzed: mergedProfiles.length,
		cache_hits: cacheHits,
		api_calls: apiCalls,
		brightdata_cost: brightdataCost,
		openai_cost: openaiCost,
		total_cost: totalCost,
	};

	await updateBrightDataStage(jobId, 'completed', job.brightdata_collection?.profiles_requested, mergedProfiles.length, null, cacheHits, apiCalls);
	await completeStage(jobId, 'brightdata_collection');
	await updateLLMAnalysisStage(jobId, 'completed', mergedProfiles.length);
	await completeStage(jobId, 'llm_analysis');
	await storePipelineResults(jobId, finalProfiles, pipelineStats);
	await updatePipelineJobStatus(jobId, 'completed');
	await updateProgress(jobId, null);
	await finalizePipelineProgress(jobId);
	await writeSummarySafe(jobId, 'completed');
}

async function processProfilesBatch(options: {
	jobId: string;
	batchId: number;
	platform: BrightDataPlatform;
	profiles: BrightDataProfile[];
	campaignDescription: string;
	strictLocationMatching: boolean;
}) {
	const { jobId, batchId, platform, profiles, campaignDescription, strictLocationMatching } = options;

	if (!profiles || !Array.isArray(profiles)) {
		throw new Error(`Batch ${batchId} profiles is not an array: ${typeof profiles}`);
	}

	const normalizedProfiles = normalizeProfiles(profiles as any);
	const maxConcurrentLLM = getMaxConcurrentLLMRequests();
	const analysisResults = await analyzeProfileFitBatch(
		normalizedProfiles,
		campaignDescription,
		maxConcurrentLLM,
		strictLocationMatching
	);

	const analyzedProfiles: Array<
		BrightDataUnifiedProfile & { fit_score: number; fit_rationale: string; fit_summary: string }
	> = normalizedProfiles.map((profile, index) => ({
		...profile,
		fit_score: analysisResults[index]?.fit_score || 0,
		fit_rationale: analysisResults[index]?.fit_rationale || 'Analysis failed',
		fit_summary: analysisResults[index]?.fit_summary || 'Unable to analyze',
	}));

	const goodInBatch = analyzedProfiles.filter(isGoodFit).length;
	await updateGoodFitCount(jobId, goodInBatch);

	analyzedProfiles.sort((a, b) => b.fit_score - a.fit_score);
	await appendBatchResults(jobId, batchId, analyzedProfiles);
	const refreshedJob = await getPipelineJob(jobId);
	const batchesCompleted = refreshedJob?.brightdata_collection?.batches_completed ?? 0;
	const totalBatches = refreshedJob?.brightdata_collection?.total_batches ?? 0;
	const llmTopN = refreshedJob?.llm_top_n ?? 0;

	if (llmTopN > 0) {
		try {
			await updateProgressiveTopN(jobId, batchesCompleted, llmTopN);
		} catch (error) {
			logger.warn('tasks_progressive_topn_failed', { job_id: jobId, batch_id: batchId + 1, error });
		}
	}

	if (totalBatches > 0) {
		await updateProgress(jobId, 'brightdata_collection', undefined, {
			completed: batchesCompleted,
			total: totalBatches,
		});
	}

	logger.debug('tasks_batch_complete', {
		job_id: jobId,
		batch_id: batchId + 1,
		platform,
		analyzed_profiles: analyzedProfiles.length,
		good_fits: goodInBatch,
		good_fit_threshold: getGoodFitThreshold(),
	});
}

async function tryAcquireBrightdataSlot(jobId: string): Promise<boolean> {
	const maxInFlight = getMaxInFlightBatches();
	return db.runTransaction(async (tx) => {
		const ref = db.collection(PIPELINE_COLLECTION).doc(jobId);
		const doc = await tx.get(ref);
		if (!doc.exists) return false;
		const data = doc.data() as any;
		if (data.stop_requested === true || data.status === 'cancelled') {
			return false;
		}
		const cacheTotal = Number.isFinite(data.cache_batches_total) ? data.cache_batches_total : 0;
		const cacheDone = Number.isFinite(data.cache_batches_completed) ? data.cache_batches_completed : 0;
		const cacheFailed = Number.isFinite(data.cache_batches_failed) ? data.cache_batches_failed : 0;
		if (cacheTotal > 0 && cacheDone + cacheFailed < cacheTotal) {
			return false;
		}
		const current = Number.isFinite(data.brightdata_in_flight) ? data.brightdata_in_flight : 0;
		if (current >= maxInFlight) {
			return false;
		}
		tx.update(ref, {
			brightdata_in_flight: current + 1,
			'brightdata_collection.batches_processing': FieldValue.increment(1),
			updated_at: Timestamp.now(),
		});
		return true;
	});
}

async function releaseBrightdataSlot(jobId: string): Promise<void> {
	await db.collection(PIPELINE_COLLECTION).doc(jobId).update({
		brightdata_in_flight: FieldValue.increment(-1),
		'brightdata_collection.batches_processing': FieldValue.increment(-1),
		updated_at: Timestamp.now(),
	});
}

async function markBatchFailed(jobId: string, batchId: number, error: string, processingDelta = 0) {
	await updateBatch(jobId, batchId, { status: 'failed', last_error: error });
	const updates: Record<string, number> = { 'brightdata_collection.batches_failed': 1 };
	if (processingDelta !== 0) {
		updates['brightdata_collection.batches_processing'] = processingDelta;
	}
	await incrementJobCounters(jobId, updates);
}

async function markBatchSkipped(jobId: string, batchId: number, reason: string, processingDelta = 0) {
	await updateBatch(jobId, batchId, { status: 'skipped', last_error: reason });
	if (processingDelta !== 0) {
		await incrementJobCounters(jobId, {
			'brightdata_collection.batches_processing': processingDelta,
		});
	}
}

async function schedulePollTask(jobId: string, batchId: number, delaySeconds: number) {
	await enqueueTask({
		kind: 'poll',
		path: '/tasks/pipeline-poll',
		payload: { job_id: jobId, batch_id: batchId },
		delaySeconds,
	});
}

export async function handlePipelineStageTask(req: any, res: any): Promise<void> {
	let payload: StageTaskPayload;
	try {
		payload = stageTaskSchema.parse(req.body);
	} catch (error) {
		res.status(400).json({ error: 'INVALID_TASK_PAYLOAD', message: 'Invalid task payload' });
		return;
	}

	const jobId = payload.job_id;
	const existing = await getPipelineJob(jobId);
	if (!existing) {
		res.status(404).json({ error: 'JOB_NOT_FOUND' });
		return;
	}

	if (existing.status === 'completed' || existing.status === 'cancelled' || existing.status === 'error') {
		res.json({ status: 'ignored', reason: `job_${existing.status}` });
		return;
	}

	const alreadyStarted = existing.weaviate_search?.status === 'completed' && existing.brightdata_collection?.total_batches;
	if (alreadyStarted) {
		res.json({ status: 'ignored', reason: 'stage_already_completed' });
		return;
	}

	const fullCampaignDescription = await buildCampaignDescription(payload);

	await updatePipelineJobStatus(jobId, 'running');
	await updatePipelineStage(jobId, 'query_expansion', 0);
	await updateQueryExpansionStage(jobId, 'running');
	await updateProgress(jobId, 'query_expansion');

	if (await isJobCancelled(jobId)) {
		await updatePipelineJobStatus(jobId, 'cancelled');
		await writeSummarySafe(jobId, 'cancelled');
		res.json({ status: 'cancelled' });
		return;
	}

	let queries: string[] = [];
	let prompt: string | undefined;

	try {
		const queryResult = await generateSearchQueriesFromDescription(fullCampaignDescription);
		queries = queryResult.queries;
		prompt = queryResult.prompt;
		await updateQueryExpansionStage(jobId, 'completed', queries, undefined, prompt);
		await completeStage(jobId, 'query_expansion');
		await updateProgress(jobId, 'query_expansion');
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		await updateQueryExpansionStage(jobId, 'error', undefined, message);
		await updatePipelineJobStatus(jobId, 'error', message);
		await writeSummarySafe(jobId, 'query_expansion_error');
		res.status(500).json({ error: 'QUERY_EXPANSION_FAILED', message });
		return;
	}

	await updatePipelineStage(jobId, 'weaviate_search', 10);
	await updateWeaviateSearchStage(jobId, 'running');

	if (await isJobCancelled(jobId)) {
		await updatePipelineJobStatus(jobId, 'cancelled');
		await writeSummarySafe(jobId, 'cancelled');
		res.json({ status: 'cancelled' });
		return;
	}

	const alphaValues = [0.2, 0.8];
	const perSearchLimit = Math.max(
		500,
		Math.ceil((payload.weaviate_top_n * 1.25) / Math.max(1, queries.length))
	);

	let deduplicatedResults: any[] = [];
	let queriesExecuted = 0;
	try {
		const searchResult = await performParallelHybridSearches(
			queries,
			alphaValues,
			perSearchLimit,
			payload.min_followers ?? undefined,
			payload.max_followers ?? undefined,
			payload.platform ?? undefined,
			undefined,
			async (stage) => {
				if (stage === 'embedding_generation') {
					await updateProgress(jobId, 'weaviate_search', 'embedding_generation');
				} else if (stage === 'searches_complete') {
					await updateProgress(jobId, 'weaviate_search', 'searches_complete');
				}
			},
			payload.exclude_profile_urls || undefined
		);

		deduplicatedResults = searchResult.deduplicatedResults;
		queriesExecuted = searchResult.queriesExecuted;

		await updateWeaviateSearchStage(
			jobId,
			'completed',
			deduplicatedResults.length,
			deduplicatedResults.length,
			queriesExecuted
		);
		await completeStage(jobId, 'weaviate_search');
		await updateProgress(jobId, 'weaviate_search', 'searches_complete');
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		await updateWeaviateSearchStage(jobId, 'error', undefined, undefined, queriesExecuted, message);
		await updatePipelineJobStatus(jobId, 'error', message);
		await writeSummarySafe(jobId, 'weaviate_search_error');
		res.status(500).json({ error: 'WEAVIATE_SEARCH_FAILED', message });
		return;
	}

	if (await isJobCancelled(jobId)) {
		await updatePipelineJobStatus(jobId, 'cancelled');
		await writeSummarySafe(jobId, 'cancelled');
		res.json({ status: 'cancelled' });
		return;
	}

	const topCandidates = extractTopCandidates(deduplicatedResults, payload.weaviate_top_n, payload.platform ?? undefined);
		if (topCandidates.length > 0) {
			try {
				await saveWeaviateCandidates(jobId, topCandidates);
			} catch (error) {
				logger.warn('tasks_save_candidates_failed', { job_id: jobId, error });
			}
		}

	const topProfileUrls = topCandidates.map((candidate) => candidate.profile_url);

	if (topProfileUrls.length === 0) {
		await storePipelineResults(jobId, [], {
			queries_generated: queries.length,
			total_search_results: deduplicatedResults.length,
			deduplicated_results: deduplicatedResults.length,
			profiles_collected: 0,
			profiles_analyzed: 0,
		});
		await updatePipelineJobStatus(jobId, 'completed');
		await finalizePipelineProgress(jobId);
		await writeSummarySafe(jobId, 'completed_no_profiles');
		res.json({ status: 'ok', job_id: jobId, batches: 0 });
		return;
	}

	await updateBrightDataStage(jobId, 'running', topProfileUrls.length);
	await updateLLMAnalysisStage(jobId, 'running');
	await updateProgress(jobId, 'brightdata_collection');

	const cachedProfilesMap = await getCachedProfilesBatch(topProfileUrls);
	const cacheHits = cachedProfilesMap.size;
	const cachedUrls = new Set(cachedProfilesMap.keys());
	const uncachedUrls = topProfileUrls.filter((url) => !cachedUrls.has(url));

	const cachedInstagramProfiles: BrightDataProfile[] = [];
	const cachedTikTokProfiles: BrightDataProfile[] = [];

	for (const url of topProfileUrls) {
		const cachedProfile = cachedProfilesMap.get(url);
		if (!cachedProfile) continue;
		const p = detectPlatformFromUrl(url);
		if (p === 'instagram') {
			cachedInstagramProfiles.push(cachedProfile);
		} else {
			cachedTikTokProfiles.push(cachedProfile);
		}
	}

	const batchSize = getBatchSize();
	const cachedInstagramBatches = chunkArray(cachedInstagramProfiles, batchSize);
	const cachedTikTokBatches = chunkArray(cachedTikTokProfiles, batchSize);

	const uncachedInstagramUrls: string[] = [];
	const uncachedTikTokUrls: string[] = [];
	for (const url of uncachedUrls) {
		const p = detectPlatformFromUrl(url);
		if (p === 'instagram') {
			uncachedInstagramUrls.push(url);
		} else {
			uncachedTikTokUrls.push(url);
		}
	}

	const uncachedInstagramBatches = chunkArray(uncachedInstagramUrls, batchSize);
	const uncachedTikTokBatches = chunkArray(uncachedTikTokUrls, batchSize);

	let nextBatchIndex = 0;
	const cacheBatchCount = cachedInstagramBatches.length + cachedTikTokBatches.length;
	const brightdataBatchCount = uncachedInstagramBatches.length + uncachedTikTokBatches.length;
	const totalBatches = cacheBatchCount + brightdataBatchCount;

	await db.collection(PIPELINE_COLLECTION).doc(jobId).update({
		pipeline_description: fullCampaignDescription,
		strict_location_matching: payload.strict_location_matching ?? false,
		tasks_execution_mode: 'tasks',
		cache_batches_total: cacheBatchCount,
		cache_batches_completed: 0,
		cache_batches_failed: 0,
		brightdata_batches_total: brightdataBatchCount,
		brightdata_in_flight: 0,
		good_fit_count: 0,
		stop_requested: false,
		'brightdata_collection.batches_completed': 0,
		'brightdata_collection.batches_failed': 0,
		'brightdata_collection.batches_processing': 0,
		'brightdata_collection.total_batches': totalBatches,
		'brightdata_collection.cache_hits': cacheHits,
		'brightdata_collection.api_calls': 0,
		updated_at: Timestamp.now(),
	});

	for (const batchProfiles of cachedInstagramBatches) {
		await createBatch(jobId, {
			batch_id: nextBatchIndex,
			type: 'cache',
			platform: 'instagram',
			status: 'pending',
			urls: batchProfiles.map((profile) => extractProfileUrl(profile, 'instagram')),
		});
		nextBatchIndex += 1;
	}

	for (const batchProfiles of cachedTikTokBatches) {
		await createBatch(jobId, {
			batch_id: nextBatchIndex,
			type: 'cache',
			platform: 'tiktok',
			status: 'pending',
			urls: batchProfiles.map((profile) => extractProfileUrl(profile, 'tiktok')),
		});
		nextBatchIndex += 1;
	}

	for (const urls of uncachedInstagramBatches) {
		await createBatch(jobId, {
			batch_id: nextBatchIndex,
			type: 'brightdata',
			platform: 'instagram',
			status: 'pending',
			urls,
		});
		nextBatchIndex += 1;
	}

	for (const urls of uncachedTikTokBatches) {
		await createBatch(jobId, {
			batch_id: nextBatchIndex,
			type: 'brightdata',
			platform: 'tiktok',
			status: 'pending',
			urls,
		});
		nextBatchIndex += 1;
	}

	for (let i = 0; i < totalBatches; i += 1) {
		await enqueueTask({
			kind: 'batch',
			path: '/tasks/pipeline-batch',
			payload: { job_id: jobId, batch_id: i },
		});
	}

	res.json({ status: 'ok', job_id: jobId, batches: totalBatches });
}

export async function handlePipelineBatchTask(req: any, res: any): Promise<void> {
	let payload: z.infer<typeof batchTaskSchema>;
	try {
		payload = batchTaskSchema.parse(req.body);
	} catch (error) {
		res.status(400).json({ error: 'INVALID_TASK_PAYLOAD', message: 'Invalid batch task payload' });
		return;
	}

	const { job_id: jobId, batch_id: batchId } = payload;

	if (await isJobCancelled(jobId)) {
		await updatePipelineJobStatus(jobId, 'cancelled');
		await writeSummarySafe(jobId, 'cancelled');
		res.json({ status: 'cancelled' });
		return;
	}

	const batch = await claimBatch(jobId, batchId);
	if (!batch) {
		res.json({ status: 'ignored', reason: 'batch_missing' });
		return;
	}

	if (batch.status !== 'running') {
		res.json({ status: 'ignored', reason: `batch_${batch.status}` });
		return;
	}

	const job = await getPipelineJob(jobId);
	if (!job) {
		res.status(404).json({ error: 'JOB_NOT_FOUND' });
		return;
	}

	if (job.stop_requested) {
		await markBatchSkipped(jobId, batchId, 'stop_requested');
		res.json({ status: 'skipped' });
		return;
	}

	let brightdataSlotAcquired = false;
	try {
		if (batch.type === 'cache') {
			await incrementJobCounters(jobId, { 'brightdata_collection.batches_processing': 1 });
			const cachedProfilesMap = await getCachedProfilesBatch(batch.urls);
			const cachedProfiles = batch.urls
				.map((url) => cachedProfilesMap.get(url))
				.filter(Boolean) as BrightDataProfile[];

			await processProfilesBatch({
				jobId,
				batchId,
				platform: batch.platform,
				profiles: cachedProfiles,
				campaignDescription: job.pipeline_description || job.business_description,
				strictLocationMatching: job.strict_location_matching ?? false,
			});

			await updateBatch(jobId, batchId, { status: 'completed' });
			await incrementJobCounters(jobId, {
				cache_batches_completed: 1,
				'brightdata_collection.batches_processing': -1,
			});

			await finalizePipelineIfReady(jobId);
			res.json({ status: 'completed', type: 'cache' });
			return;
		}

		const acquired = await tryAcquireBrightdataSlot(jobId);
		if (!acquired) {
			await updateBatch(jobId, batchId, { status: 'pending' });
			await enqueueTask({
				kind: 'batch',
				path: '/tasks/pipeline-batch',
				payload: { job_id: jobId, batch_id: batchId },
				delaySeconds: getPollingInterval(),
			});
			res.json({ status: 'delayed' });
			return;
		}
		brightdataSlotAcquired = true;

		const apiKey = getBrightDataApiKey();
		const baseUrl = getBrightDataBaseUrl();
		const snapshotResults = await triggerCollection(batch.urls, apiKey, baseUrl);
		const snapshot = snapshotResults.find((result) => result.platform === batch.platform);

		if (!snapshot) {
			await releaseBrightdataSlot(jobId);
			await markBatchFailed(jobId, batchId, 'No snapshot returned from BrightData');
			res.json({ status: 'failed' });
			return;
		}

		await updateBatch(jobId, batchId, {
			status: 'triggered',
			snapshot_id: snapshot.snapshot_id,
			poll_attempts: 0,
		});

		await schedulePollTask(jobId, batchId, getPollingInterval());
		res.json({ status: 'triggered', snapshot_id: snapshot.snapshot_id });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		if (batch.type === 'cache') {
			await markBatchFailed(jobId, batchId, message, -1);
			await incrementJobCounters(jobId, { cache_batches_failed: 1 });
		} else {
			if (brightdataSlotAcquired) {
				await releaseBrightdataSlot(jobId);
			}
			await markBatchFailed(jobId, batchId, message);
		}
		await finalizePipelineIfReady(jobId);
		res.status(500).json({ status: 'failed', message });
	}
}

export async function handlePipelinePollTask(req: any, res: any): Promise<void> {
	let payload: z.infer<typeof batchTaskSchema>;
	try {
		payload = batchTaskSchema.parse(req.body);
	} catch (error) {
		res.status(400).json({ error: 'INVALID_TASK_PAYLOAD', message: 'Invalid poll task payload' });
		return;
	}

	const { job_id: jobId, batch_id: batchId } = payload;
	const batchDoc = await getBatchRef(jobId, batchId).get();
	if (!batchDoc.exists) {
		res.json({ status: 'ignored', reason: 'batch_missing' });
		return;
	}

	const batch = batchDoc.data() as PipelineBatchRecord;
	if (batch.status === 'completed' || batch.status === 'failed' || batch.status === 'skipped') {
		res.json({ status: 'ignored', reason: `batch_${batch.status}` });
		return;
	}

	if (await isJobCancelled(jobId)) {
		await updatePipelineJobStatus(jobId, 'cancelled');
		await writeSummarySafe(jobId, 'cancelled');
		await markBatchSkipped(jobId, batchId, 'cancelled');
		await releaseBrightdataSlot(jobId);
		res.json({ status: 'cancelled' });
		return;
	}

	const job = await getPipelineJob(jobId);
	if (!job) {
		res.status(404).json({ error: 'JOB_NOT_FOUND' });
		return;
	}

	if (job.stop_requested) {
		await markBatchSkipped(jobId, batchId, 'stop_requested');
		await releaseBrightdataSlot(jobId);
		await finalizePipelineIfReady(jobId);
		res.json({ status: 'skipped' });
		return;
	}

	const snapshotId = batch.snapshot_id;
	if (!snapshotId) {
		res.json({ status: 'ignored', reason: 'missing_snapshot' });
		return;
	}

	try {
		const apiKey = getBrightDataApiKey();
		const baseUrl = getBrightDataBaseUrl();
		const progress = await checkProgress(snapshotId, apiKey, baseUrl);

		if (progress.status === 'failed') {
			await releaseBrightdataSlot(jobId);
			await markBatchFailed(jobId, batchId, 'BrightData snapshot failed');
			await finalizePipelineIfReady(jobId);
			res.json({ status: 'failed' });
			return;
		}

		if (progress.status !== 'ready' && progress.status !== 'completed') {
			const attempts = (batch.poll_attempts || 0) + 1;
			const maxWait = getMaxWaitTime();
			if (attempts * getPollingInterval() > maxWait) {
				await releaseBrightdataSlot(jobId);
				await markBatchFailed(jobId, batchId, 'BrightData snapshot timed out');
				await finalizePipelineIfReady(jobId);
				res.json({ status: 'failed' });
				return;
			}

			await updateBatch(jobId, batchId, { poll_attempts: attempts });
			await schedulePollTask(jobId, batchId, getPollingInterval());
			res.json({ status: 'polling', attempts });
			return;
		}

		const profiles = await downloadResults(snapshotId, apiKey, baseUrl);
		await incrementJobCounters(jobId, { 'brightdata_collection.api_calls': profiles.length });

		if (profiles.length > 0) {
			const profilesToCache = profiles.map((profile) => ({
				url: extractProfileUrl(profile, batch.platform),
				platform: batch.platform,
				data: profile,
			}));
			setCachedProfilesBatch(profilesToCache).catch((err) => {
				logger.warn('tasks_batch_cache_failed', { job_id: jobId, batch_id: batchId + 1, error: err });
			});
		}

		await processProfilesBatch({
			jobId,
			batchId,
			platform: batch.platform,
			profiles,
			campaignDescription: job.pipeline_description || job.business_description,
			strictLocationMatching: job.strict_location_matching ?? false,
		});

		await updateBatch(jobId, batchId, { status: 'completed' });
		await releaseBrightdataSlot(jobId);
		await finalizePipelineIfReady(jobId);

		res.json({ status: 'completed' });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		await releaseBrightdataSlot(jobId);
		await markBatchFailed(jobId, batchId, message);
		await finalizePipelineIfReady(jobId);
		res.status(500).json({ status: 'failed', message });
	}
}
