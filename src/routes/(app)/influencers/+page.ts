import {
	isSearchPipelineResponse,
	type CreatorProfile,
	type SearchPipelineRequest
} from '$lib/types/search';
import type { PageLoad } from './$types';

const DEFAULT_SEARCH_QUERY = 'beauty and lifestyle influencers';
const DEFAULT_BUSINESS_QUERY =
	"Looking for authentic creators who engage their audience with lifestyle and beauty content";

const mockCampaigns = [
	{ id: 'cmp-001', name: 'Student AI Campaign' },
	{ id: 'cmp-002', name: 'Spring Pop-Up' }
];

const parseNumberParam = (value: string | null): number | null => {
	if (!value) return null;
	const parsed = parseInt(value, 10);
	return Number.isNaN(parsed) ? null : parsed;
};

const stopStageValues = ['SEARCH', 'BRIGHTDATA', 'LLM_FIT'] as const;
type StopStage = (typeof stopStageValues)[number];

const parseStopStage = (value: string | null): StopStage | null => {
	if (!value) return null;
	return stopStageValues.includes(value as StopStage) ? (value as StopStage) : null;
};

export const load: PageLoad = async ({ fetch, url }) => {
	const query = url.searchParams.get('query')?.trim() || DEFAULT_SEARCH_QUERY;
	const businessQuery = url.searchParams.get('business_query')?.trim() || DEFAULT_BUSINESS_QUERY;
	const minFollowers = parseNumberParam(url.searchParams.get('min_followers'));
	const maxFollowers = parseNumberParam(url.searchParams.get('max_followers'));
	const location = url.searchParams.get('location')?.trim() || null;
	const category = url.searchParams.get('category')?.trim() || null;
	const stopAtStage = parseStopStage(url.searchParams.get('stop_at_stage'));

	const search: SearchPipelineRequest['search'] = {
		query,
		method: 'hybrid',
		limit: 50
	};

	if (minFollowers !== null) search.min_followers = minFollowers;
	if (maxFollowers !== null) search.max_followers = maxFollowers;
	if (location) search.location = location;
	if (category) search.category = category;

	const payload: SearchPipelineRequest = {
		search,
		business_fit_query: businessQuery,
		debug_mode: false,
		stop_at_stage: stopAtStage
	};

	try {
		const response = await fetch('/api/search', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			let errorMessage = 'Unable to fetch creators. Please try again.';
			try {
				const errorPayload = (await response.json()) as { message?: string; error?: string };
				errorMessage = errorPayload.message ?? errorPayload.error ?? errorMessage;
			} catch (err) {
				console.error('Failed to parse error payload', err);
			}

			return {
				influencers: [] as CreatorProfile[],
				campaigns: mockCampaigns,
				profile: { full_name: 'Avery Demo' },
				error: errorMessage,
				isLoading: false,
				searchParams: {
					query,
					business_query: businessQuery,
					min_followers: minFollowers,
					max_followers: maxFollowers,
					stop_at_stage: stopAtStage
				}
			};
		}

		const data = (await response.json()) as unknown;
		if (!isSearchPipelineResponse(data)) {
			console.error('Unexpected search response shape', data);
			return {
				influencers: [] as CreatorProfile[],
				campaigns: mockCampaigns,
				profile: { full_name: 'Avery Demo' },
				error: 'Received an unexpected response from the search service.',
				isLoading: false,
				searchParams: {
					query,
					business_query: businessQuery,
					min_followers: minFollowers,
					max_followers: maxFollowers,
					stop_at_stage: stopAtStage
				}
			};
		}

		const influencers = Array.isArray(data.results) ? data.results : [];

		return {
			influencers,
			campaigns: mockCampaigns,
			profile: { full_name: 'Avery Demo' },
			error: null,
			isLoading: false,
			searchParams: {
				query,
				business_query: businessQuery,
				min_followers: minFollowers,
				max_followers: maxFollowers,
				stop_at_stage: stopAtStage
			}
		};
	} catch (error) {
		console.error('Search request failed', error);
		const errorMessage =
			error instanceof Error ? error.message : 'Something went wrong fetching creators.';

		return {
			influencers: [] as CreatorProfile[],
			campaigns: mockCampaigns,
			profile: { full_name: 'Avery Demo' },
			error: errorMessage,
			isLoading: false,
			searchParams: {
				query,
				business_query: businessQuery,
				min_followers: minFollowers,
				max_followers: maxFollowers,
				stop_at_stage: stopAtStage
			}
		};
	}
};
