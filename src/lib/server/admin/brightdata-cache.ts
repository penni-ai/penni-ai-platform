import { createHash } from 'crypto';
import { firestore } from '$lib/server/core';

export type BrightdataPlatform = 'instagram' | 'tiktok';

export type BrightdataCacheRecord = {
	id: string;
	profile_url?: string;
	platform?: BrightdataPlatform | string;
	cached_at?: number | null;
	expires_at?: number | null;
	raw_data?: unknown;
};

export type BrightdataCacheStats = {
	as_of: number;
	total: number;
	active: number;
	expired: number;
	today_utc: number;
	this_week_utc: number;
	this_month_utc: number;
};

const CACHE_COLLECTION = 'brightdata_cache';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const normalizeUrlForCache = (url: string): string => {
	let normalized = url.toLowerCase().trim();
	if (normalized.endsWith('/')) {
		normalized = normalized.slice(0, -1);
	}
	normalized = normalized.replace('www.instagram.com', 'instagram.com');
	normalized = normalized.replace('www.tiktok.com', 'tiktok.com');
	return normalized;
};

const urlToDocId = (url: string): string => {
	const normalized = normalizeUrlForCache(url);
	const hash = createHash('sha256').update(normalized).digest('hex');
	return hash.substring(0, 40);
};

const serializeCacheRecord = (
	id: string,
	data: FirebaseFirestore.DocumentData,
	options?: { includeRawData?: boolean }
): BrightdataCacheRecord => {
	return {
		id,
		profile_url: typeof data.profile_url === 'string' ? data.profile_url : undefined,
		platform: typeof data.platform === 'string' ? data.platform : undefined,
		cached_at: typeof data.cached_at === 'number' ? data.cached_at : null,
		expires_at: typeof data.expires_at === 'number' ? data.expires_at : null,
		raw_data: options?.includeRawData === true && 'raw_data' in data ? data.raw_data : undefined
	};
};

export async function listBrightdataCacheEntries(options: {
	limit?: number;
	cursor?: string;
}): Promise<{ entries: BrightdataCacheRecord[]; nextCursor: string | null }> {
	let query = firestore.collection(CACHE_COLLECTION).orderBy('cached_at', 'desc');

	if (options.cursor) {
		const cursorSnap = await firestore.collection(CACHE_COLLECTION).doc(options.cursor).get();
		if (cursorSnap.exists) {
			query = query.startAfter(cursorSnap);
		}
	}

	const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
	const snapshot = await query.limit(limit).get();
	const entries = snapshot.docs.map((doc) => serializeCacheRecord(doc.id, doc.data()));
	const nextCursor = snapshot.size === limit ? snapshot.docs[snapshot.docs.length - 1]?.id ?? null : null;

	return { entries, nextCursor };
}

export async function getBrightdataCacheEntry(cacheId: string): Promise<BrightdataCacheRecord | null> {
	const snap = await firestore.collection(CACHE_COLLECTION).doc(cacheId).get();
	if (!snap.exists) return null;
	const data = snap.data();
	if (!data) return null;
	return serializeCacheRecord(snap.id, data, { includeRawData: true });
}

export async function getBrightdataCacheEntryByUrl(profileUrl: string): Promise<BrightdataCacheRecord | null> {
	if (!profileUrl.trim()) return null;
	const docId = urlToDocId(profileUrl);
	return getBrightdataCacheEntry(docId);
}

export async function getBrightdataCacheStats(): Promise<BrightdataCacheStats> {
	const now = Date.now();
	const date = new Date(now);
	const startOfTodayUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
	const weekdayUtc = date.getUTCDay();
	const daysSinceMondayUtc = (weekdayUtc + 6) % 7;
	const startOfWeekUtc = startOfTodayUtc - daysSinceMondayUtc * 24 * 60 * 60 * 1000;
	const startOfMonthUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);

	const col = firestore.collection(CACHE_COLLECTION);

	const [totalSnap, activeSnap, todaySnap, weekSnap, monthSnap] = await Promise.all([
		col.count().get(),
		col.where('expires_at', '>', now).count().get(),
		col.where('cached_at', '>=', startOfTodayUtc).count().get(),
		col.where('cached_at', '>=', startOfWeekUtc).count().get(),
		col.where('cached_at', '>=', startOfMonthUtc).count().get()
	]);

	const total = totalSnap.data().count;
	const active = activeSnap.data().count;
	return {
		as_of: now,
		total,
		active,
		expired: Math.max(0, total - active),
		today_utc: todaySnap.data().count,
		this_week_utc: weekSnap.data().count,
		this_month_utc: monthSnap.data().count
	};
}
