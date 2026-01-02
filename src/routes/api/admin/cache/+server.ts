import { apiOk, handleApiRoute } from '$lib/server/core';
import { requireAdmin } from '$lib/server/core';
import { listBrightdataCacheEntries } from '$lib/server/admin/brightdata-cache';

export const GET = handleApiRoute(async (event) => {
	requireAdmin(event);

	const cursor = event.url.searchParams.get('cursor') ?? undefined;
	const limitRaw = event.url.searchParams.get('limit');
	const limit = limitRaw ? Number(limitRaw) : undefined;

	const result = await listBrightdataCacheEntries({ cursor, limit });
	return apiOk(result);
});
