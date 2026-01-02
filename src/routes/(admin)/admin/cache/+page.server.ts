import type { PageServerLoad } from './$types';
import { getBrightdataCacheEntryByUrl, listBrightdataCacheEntries } from '$lib/server/admin/brightdata-cache';

export const load: PageServerLoad = async ({ url, locals }) => {
	const lookupUrl = url.searchParams.get('url')?.trim() ?? '';

	let lookup: Awaited<ReturnType<typeof getBrightdataCacheEntryByUrl>> | null = null;
	if (lookupUrl) {
		try {
			lookup = await getBrightdataCacheEntryByUrl(lookupUrl);
		} catch (err) {
			locals.logger?.error('Failed to lookup cache entry', {
				error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
				lookupUrl
			});
			lookup = null;
		}
	}

	const { entries, nextCursor } = await listBrightdataCacheEntries({ limit: 50 });

	return {
		lookupUrl,
		lookup,
		entries,
		nextCursor
	};
};

