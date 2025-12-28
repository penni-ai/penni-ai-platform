import { describe, expect, it } from 'vitest';

import {
	PIPELINE_RUN_STATUSES,
	PIPELINE_STAGE_STATUSES,
	STAGE_NAMES,
	isPipelineStageDocument,
	isPipelineStatus,
	isSearchPipelineAcknowledgment,
	isSearchPipelineRequest,
	isSearchPipelineResponse
} from '../../src/lib/types/search';

describe('types/search runtime constants', () => {
	it('exports stage + status arrays', () => {
		expect(STAGE_NAMES).toEqual(['SEARCH', 'LIVE_ANALYSIS']);
		expect(PIPELINE_RUN_STATUSES).toEqual(['running', 'completed', 'error', 'cancelled']);
		expect(PIPELINE_STAGE_STATUSES).toEqual(['pending', 'running', 'completed', 'error']);
	});

	it('validates pipeline status payloads', () => {
		const base = {
			pipeline_id: 'p1',
			userId: 'u1',
			status: 'running',
			current_stage: 'SEARCH',
			completed_stages: ['SEARCH'],
			overall_progress: 50
		};

		expect(isPipelineStatus(base)).toBe(true);
		expect(isPipelineStatus({ ...base, pipeline_id: 1 })).toBe(false);
		expect(isPipelineStatus({ ...base, userId: null })).toBe(false);
		expect(isPipelineStatus({ ...base, status: 'nope' })).toBe(false);
		expect(isPipelineStatus({ ...base, current_stage: 'NOPE' })).toBe(false);
		expect(isPipelineStatus({ ...base, completed_stages: ['NOPE'] })).toBe(false);
		expect(isPipelineStatus({ ...base, overall_progress: '50' })).toBe(false);

		expect(isPipelineStatus({ ...base, flow_metrics: { initial_count: 1 } })).toBe(false);
		expect(
			isPipelineStatus({
				...base,
				flow_metrics: {
					initial_count: 1,
					deduped_kept: 1,
					deduped_discarded: 0,
					brightdata_success: 1,
					brightdata_dead: 0,
					llm_above_5: 1,
					llm_below_5: 0,
					completed_batches: 1,
					total_batches: 1
				}
			})
		).toBe(true);

		expect(isPipelineStatus({ ...base, cancel_requested: 'nope' })).toBe(false);
		expect(isPipelineStatus({ ...base, cancel_requested: true })).toBe(true);

		expect(isPipelineStatus({ ...base, failed_batches: { brightdata: ['x'], llm: [] } })).toBe(false);
		expect(isPipelineStatus({ ...base, failed_batches: { brightdata: [1], llm: [2] } })).toBe(true);
	});

	it('validates pipeline stage documents', () => {
		const base = {
			pipeline_id: 'p1',
			userId: 'u1',
			stage: 'SEARCH',
			status: 'completed',
			profiles: [{ profile_url: 'x' }],
			debug: {},
			metadata: {}
		};

		expect(isPipelineStageDocument(base)).toBe(true);
		expect(isPipelineStageDocument({ ...base, stage: 'NOPE' })).toBe(false);
		expect(isPipelineStageDocument({ ...base, status: 'nope' })).toBe(false);
		expect(isPipelineStageDocument({ ...base, profiles: ['x'] })).toBe(false);
		expect(isPipelineStageDocument({ ...base, debug: null })).toBe(false);
		expect(isPipelineStageDocument({ ...base, metadata: null })).toBe(false);
		expect(isPipelineStageDocument({ ...base, metadata: { expanded_queries: [1] } })).toBe(false);
		expect(isPipelineStageDocument({ ...base, error_message: 1 })).toBe(false);

		expect(
			isPipelineStageDocument({
				...base,
				artifacts: {
					profiles: { name: 'profiles.json', bucket: 'b', size_bytes: 1, updated: 'now' }
				}
			})
		).toBe(true);
		expect(isPipelineStageDocument({ ...base, artifacts: { profiles: { name: 1 } } })).toBe(false);
		expect(isPipelineStageDocument({ ...base, artifacts: { debug: 1 } })).toBe(false);

		expect(
			isPipelineStageDocument({
				...base,
				profiles_snapshot: [{ profile_url: 'x', fit_score: 1, combined_score: 2, email_address: null }]
			})
		).toBe(true);
		expect(isPipelineStageDocument({ ...base, profiles_snapshot: [{ fit_score: 'nope' }] })).toBe(false);
		expect(isPipelineStageDocument({ ...base, profiles_snapshot: [{ profile_url: 123 }] })).toBe(false);
	});

	it('validates pipeline request/ack/response payloads', () => {
		expect(isSearchPipelineRequest(null)).toBe(false);
		expect(isSearchPipelineRequest({ search: null, business_fit_query: 'x' })).toBe(false);
		expect(isSearchPipelineRequest({ search: { query: 'find creators' }, business_fit_query: 123 })).toBe(false);
		expect(isSearchPipelineRequest({ search: {}, business_fit_query: '' })).toBe(false);
		expect(isSearchPipelineRequest({ search: { query: ' ' }, business_fit_query: 'x' })).toBe(false);
		expect(isSearchPipelineRequest({ search: { query: 'find creators' }, business_fit_query: 'fit' })).toBe(true);

		expect(isSearchPipelineAcknowledgment({ pipeline_id: 'p1', pipeline_status_path: 'x', status: 'running' })).toBe(true);
		expect(isSearchPipelineAcknowledgment({ pipeline_id: 'p1', pipeline_status_path: 'x', status: 'done' })).toBe(false);

		expect(isSearchPipelineResponse({ success: true, results: [], count: 0 })).toBe(true);
		expect(isSearchPipelineResponse({ success: true, results: 'nope', count: 0 })).toBe(false);
	});
});
