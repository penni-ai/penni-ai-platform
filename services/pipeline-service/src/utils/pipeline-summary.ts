import { Timestamp } from 'firebase-admin/firestore';
import { getFirestoreInstance } from './firebase-admin.js';
import type { PipelineJobDocument } from './firestore-tracker.js';
import { createLogger } from './logger.js';

const db = getFirestoreInstance();
const PIPELINE_COLLECTION = 'pipeline_jobs';
const logger = createLogger({ component: 'pipeline_summary' });

type StageKey = 'query_expansion' | 'weaviate_search' | 'brightdata_collection' | 'llm_analysis';

const STAGE_LABELS: Record<StageKey, string> = {
	query_expansion: 'Query Expansion',
	weaviate_search: 'Weaviate Search',
	brightdata_collection: 'BrightData Collection',
	llm_analysis: 'LLM Analysis',
};

type StageWindow = {
	key: StageKey;
	label: string;
	start: number;
	end: number;
	duration: number;
};

function toSeconds(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (value instanceof Date) return value.getTime() / 1000;
	if (typeof value === 'object' && value !== null) {
		if ('seconds' in value && typeof (value as { seconds?: number }).seconds === 'number') {
			const seconds = (value as { seconds: number }).seconds;
			const nanos = (value as { nanoseconds?: number }).nanoseconds || 0;
			return seconds + nanos / 1e9;
		}
		if (value instanceof Timestamp) {
			return value.toMillis() / 1000;
		}
	}
	return null;
}

function formatSeconds(seconds: number): string {
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = Math.floor(seconds / 60);
	const remainder = Math.round(seconds % 60);
	return `${minutes}m ${remainder}s`;
}

function formatTimestamp(value: unknown): string {
	const seconds = toSeconds(value);
	if (seconds === null) return '—';
	return new Date(seconds * 1000).toISOString();
}

function formatCost(value: unknown): string {
	if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
	const decimals = value < 1 ? 4 : 2;
	return `$${value.toFixed(decimals)}`;
}

function buildStageWindows(job: PipelineJobDocument): StageWindow[] {
	const stages: StageKey[] = ['query_expansion', 'weaviate_search', 'brightdata_collection', 'llm_analysis'];
	const timing = job.timing as any;

	if (timing?.pipeline_start && timing?.stages) {
		return stages
			.map((stage) => {
				const entry = timing.stages?.[stage];
				if (!entry || typeof entry.start !== 'number') return null;
				const start = entry.start;
				const end = typeof entry.end === 'number' ? entry.end : start + (entry.duration || 0);
				const duration = Math.max(0, end - start);
				return {
					key: stage,
					label: STAGE_LABELS[stage],
					start,
					end,
					duration,
				};
			})
			.filter(Boolean) as StageWindow[];
	}

	const baseStart =
		toSeconds(job.start_time) ??
		toSeconds(job.created_at) ??
		toSeconds(job.updated_at) ??
		Date.now() / 1000;

	return stages
		.map((stage) => {
			const stageData = (job as any)[stage];
			if (!stageData) return null;
			const startedAt = toSeconds(stageData.started_at ?? stageData.start_time);
			const completedAt = toSeconds(stageData.completed_at ?? stageData.end_time);
			if (startedAt === null || completedAt === null) return null;
			const start = Math.max(0, startedAt - baseStart);
			const end = Math.max(start, completedAt - baseStart);
			return {
				key: stage,
				label: STAGE_LABELS[stage],
				start,
				end,
				duration: Math.max(0, end - start),
			};
		})
		.filter(Boolean) as StageWindow[];
}

function buildWaterfall(windows: StageWindow[], totalDuration: number): string {
	if (windows.length === 0 || totalDuration <= 0) {
		return 'No timing data available.';
	}

	const width = 60;
	const axisTicks = 6;
	const axisStep = totalDuration / axisTicks;

	const axisLabels = Array.from({ length: axisTicks + 1 }, (_, i) => formatSeconds(i * axisStep));
	const axisLine = axisLabels
		.map((label, index) => {
			const position = Math.round((index / axisTicks) * width);
			return { label, position };
		})
		.reduce((line, tick) => {
			const trimmed = line.padEnd(tick.position, ' ');
			return `${trimmed}|${tick.label}`;
		}, '');

	const header = `0s${' '.repeat(Math.max(0, width - 2))} ${formatSeconds(totalDuration)}`;
	const timeline = `${'-'.repeat(width + 2)}`;

	const lines = windows.map((window) => {
		const offset = Math.round((window.start / totalDuration) * width);
		const length = Math.max(1, Math.round((window.duration / totalDuration) * width));
		const bar = `${' '.repeat(offset)}${'#'.repeat(length)}`;
		return `${window.label.padEnd(22)} |${bar.padEnd(width)}| ${formatSeconds(window.duration)}`;
	});

	return [
		header,
		timeline,
		...lines,
		'',
		axisLine.trimEnd(),
	].join('\n');
}

function buildSummary(job: PipelineJobDocument, windows: StageWindow[], totalDuration: number): string {
	const stats = job.pipeline_stats || {};
	const status = job.status || 'unknown';
	const jobId = job.job_id || 'unknown';
	const batchesCompleted = job.brightdata_collection?.batches_completed ?? 0;
	const batchesFailed = job.brightdata_collection?.batches_failed ?? 0;
	const totalBatches = job.brightdata_collection?.total_batches ?? 0;
	const stageStatuses = [
		{ key: 'query_expansion', label: 'Query Expansion' },
		{ key: 'weaviate_search', label: 'Weaviate Search' },
		{ key: 'brightdata_collection', label: 'BrightData Collection' },
		{ key: 'llm_analysis', label: 'LLM Analysis' },
	]
		.map((stage) => {
			const statusValue = (job as any)[stage.key]?.status ?? '—';
			return `${stage.label}=${statusValue}`;
		})
		.join(' | ');
	const stageDurations = windows.map((w) => `${w.label} ${formatSeconds(w.duration)}`).join(' | ');
	const errorMessage = job.error_message ? `Error: ${job.error_message}` : null;

	return [
		`Pipeline Summary`,
		`Status: ${status}`,
		`Job ID: ${jobId}`,
		`Started: ${formatTimestamp(job.start_time)}`,
		`Ended: ${formatTimestamp(job.end_time)}`,
		`Duration: ${totalDuration > 0 ? formatSeconds(totalDuration) : '—'}`,
		errorMessage,
		`Profiles Collected: ${job.profiles_count ?? '—'}`,
		`Profiles Analyzed: ${(stats as any).profiles_analyzed ?? '—'}`,
		`BrightData Calls: ${(stats as any).api_calls ?? '—'}`,
		`Costs: BrightData ${formatCost((stats as any).brightdata_cost)} | OpenAI ${formatCost((stats as any).openai_cost)} | Total ${formatCost((stats as any).total_cost)}`,
		`Batches: ${batchesCompleted}/${totalBatches} completed, ${batchesFailed} failed`,
		`Stage Status: ${stageStatuses || '—'}`,
		`Stage Durations: ${stageDurations || '—'}`,
	]
		.filter(Boolean)
		.join('\n');
}

export async function writePipelineSummary(jobId: string): Promise<void> {
	const doc = await db.collection(PIPELINE_COLLECTION).doc(jobId).get();
	if (!doc.exists) return;
	const job = doc.data() as PipelineJobDocument;

	const windows = buildStageWindows(job);
	const totalDuration =
		(job.timing as any)?.pipeline_duration ??
		windows.reduce((max, w) => Math.max(max, w.end), 0);

	const summary = buildSummary(job, windows, totalDuration || 0);
	const waterfall = buildWaterfall(windows, totalDuration || 0);

	await doc.ref.update({
		pipeline_summary: summary,
		pipeline_waterfall: waterfall,
		updated_at: Timestamp.now(),
	});

	logger.info('pipeline_summary_written', {
		job_id: jobId,
		pipeline_summary: summary,
		pipeline_waterfall: waterfall,
	});
}
