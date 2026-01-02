import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBrightdataCacheEntry } from '$lib/server/admin/brightdata-cache';

export const load: PageServerLoad = async ({ params }) => {
	const cacheId = params.cacheId;
	if (!cacheId) throw error(400, 'Cache ID is required.');

	const entry = await getBrightdataCacheEntry(cacheId);
	if (!entry) throw error(404, 'Cache entry not found.');

	return { entry };
};

