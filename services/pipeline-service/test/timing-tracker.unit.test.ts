import { beforeEach, describe, expect, it, vi } from 'vitest';

const update = vi.fn(async () => {});
const doc = vi.fn(() => ({ update }));
const collection = vi.fn(() => ({ doc }));
const getFirestoreInstance = vi.fn(() => ({ collection }));

vi.mock('../dist/utils/firebase-admin.js', () => ({
	getFirestoreInstance: () => getFirestoreInstance()
}));

describe('PipelineTimingTracker (unit)', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it('tracks stages, sub-stages, batches, and saves to Firestore', async () => {
		const { PipelineTimingTracker } = await import('../dist/utils/timing-tracker.js');
		const tracker = new PipelineTimingTracker('job_timing_1');

		tracker.startStage('query_expansion');
		tracker.startSubStage('query_expansion', 'prompt_build');
		tracker.endSubStage('query_expansion', 'prompt_build');
		tracker.endStage('query_expansion');

		tracker.addBatchTiming('brightdata_collection', 0, 1.0, 2.5);
		tracker.addBatchTiming('brightdata_collection', 1, 3.0);
		// Updating an existing batch entry should overwrite start and compute duration.
		tracker.addBatchTiming('brightdata_collection', 1, 4.0, 5.0);

		tracker.endPipeline();

		const timing = tracker.getTimingData();
		expect(timing.pipeline_start).toBeTypeOf('number');
		expect(timing.pipeline_end).toBeTypeOf('number');
		expect(timing.pipeline_duration).toBeTypeOf('number');
		expect(timing.stages.query_expansion?.duration).toBeTypeOf('number');

		const batches = (timing.stages.brightdata_collection?.sub_stages?.batches as any[]) || [];
		expect(batches).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ batch_index: 0, start: 1.0, end: 2.5, duration: 1.5 }),
				expect.objectContaining({ batch_index: 1, start: 4.0, end: 5.0, duration: 1.0 })
			])
		);

		await tracker.saveToFirestore();
		expect(getFirestoreInstance).toHaveBeenCalledTimes(1);
		expect(collection).toHaveBeenCalledWith('pipeline_jobs');
		expect(doc).toHaveBeenCalledWith('job_timing_1');
		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				timing: expect.any(Object),
				updated_at: expect.any(Object)
			})
		);

		expect(typeof tracker.getPipelineStartTime()).toBe('number');
	});

	it('supports restarting stages and creating stages/sub-stages defensively', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const { PipelineTimingTracker } = await import('../dist/utils/timing-tracker.js');
		const tracker = new PipelineTimingTracker('job_timing_restart');

		tracker.startStage('weaviate_search');
		tracker.endStage('weaviate_search');
		// Restart the same stage (resets end/duration).
		tracker.startStage('weaviate_search');

		// Force the "stage missing on endStage" defensive branch.
		delete (tracker as any).timing.stages.weaviate_search;
		tracker.endStage('weaviate_search');

		// Start a sub-stage without starting the stage first (defensive stage creation).
		const tracker2 = new PipelineTimingTracker('job_timing_substage');
		tracker2.startSubStage('llm_analysis', 'prompt_build');

		// Force "sub-stage timing not found" branch.
		tracker2.startSubStage('llm_analysis', 'missing');
		delete (tracker2 as any).timing.stages.llm_analysis.sub_stages.missing;
		tracker2.endSubStage('llm_analysis', 'missing');

		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	it('saveToFirestore surfaces update failures', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { PipelineTimingTracker } = await import('../dist/utils/timing-tracker.js');
		const tracker = new PipelineTimingTracker('job_timing_fail');

		update.mockRejectedValueOnce(new Error('firestore down'));
		await expect(tracker.saveToFirestore()).rejects.toThrow(/firestore down/);

		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it('warns when ending stages/sub-stages that were not started', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { PipelineTimingTracker } = await import('../dist/utils/timing-tracker.js');
		const tracker = new PipelineTimingTracker('job_timing_2');

		tracker.endStage('weaviate_search');
		tracker.endSubStage('weaviate_search', 'embedding_generation');

		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});
