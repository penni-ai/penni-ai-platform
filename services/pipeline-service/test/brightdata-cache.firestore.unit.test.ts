import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeFirestore } from './helpers/fake-firebase';

let db: FakeFirestore;

vi.mock('../dist/utils/firebase-admin.js', () => ({
	getFirestoreInstance: () => db
}));

describe('brightdata-cache (Firestore behaviors, unit)', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		db = new FakeFirestore();
	});

	it('setCachedProfile + getCachedProfile roundtrip', async () => {
		const { getCachedProfile, setCachedProfile, urlToDocId } = await import('../dist/utils/brightdata-cache.js');

		const url = 'https://instagram.com/someuser/';
		await setCachedProfile(url, 'instagram', { account: 'someuser', profile_url: url } as any);

		const hit = await getCachedProfile(url);
		expect(hit).toEqual(expect.objectContaining({ account: 'someuser', profile_url: url }));

		const docId = urlToDocId(url);
		const snap = await db.collection('brightdata_cache').doc(docId).get();
		expect(snap.exists).toBe(true);
		expect((snap.data() as any).expires_at).toBeTypeOf('number');
	});

	it('getCachedProfile returns null for missing docs and on read errors', async () => {
		const { getCachedProfile, urlToDocId } = await import('../dist/utils/brightdata-cache.js');

		const url = 'https://instagram.com/missing/';
		expect(await getCachedProfile(url)).toBeNull();

		const docId = urlToDocId(url);
		const originalGet = db._get.bind(db);
		db._get = ((path: string) => {
			if (path === `brightdata_cache/${docId}`) {
				throw new Error('boom');
			}
			return originalGet(path);
		}) as any;

		expect(await getCachedProfile(url)).toBeNull();
	});

	it('getCachedProfile returns null for expired entries', async () => {
		const { getCachedProfile, urlToDocId } = await import('../dist/utils/brightdata-cache.js');

		const url = 'https://tiktok.com/@expired';
		const docId = urlToDocId(url);
		await db.collection('brightdata_cache').doc(docId).set({
			profile_url: url,
			platform: 'tiktok',
			raw_data: { account_id: 'expired', url } as any,
			cached_at: Date.now() - 1000,
			expires_at: Date.now() - 1
		});

		expect(await getCachedProfile(url)).toBeNull();
	});

	it('getCachedProfilesBatch returns a map of only cache hits (chunked getAll)', async () => {
		const { getCachedProfilesBatch, setCachedProfilesBatch } = await import('../dist/utils/brightdata-cache.js');

		const urls = Array.from({ length: 101 }, (_, i) => `https://instagram.com/u${i}/`);
		const cached = urls.slice(0, 3).map((url) => ({ url, platform: 'instagram' as const, data: { url } as any }));
		await setCachedProfilesBatch(cached);

		const hits = await getCachedProfilesBatch(urls);
		expect(hits.size).toBe(3);
		expect(hits.get(urls[0])).toEqual(expect.objectContaining({ url: urls[0] }));
	});

	it('getCachedProfilesBatch returns empty map for empty input and tolerates Firestore errors', async () => {
		const { getCachedProfilesBatch } = await import('../dist/utils/brightdata-cache.js');

		const empty = await getCachedProfilesBatch([]);
		expect(empty.size).toBe(0);

		db.getAll = vi.fn(async () => {
			throw new Error('boom');
		}) as any;

		const out = await getCachedProfilesBatch(['https://instagram.com/a/']);
		expect(out).toBeInstanceOf(Map);
		expect(out.size).toBe(0);
	});

	it('setCachedProfile and setCachedProfilesBatch are best-effort on write errors and accept empty input', async () => {
		const { setCachedProfile, setCachedProfilesBatch } = await import('../dist/utils/brightdata-cache.js');

		await expect(setCachedProfilesBatch([])).resolves.toBeUndefined();

		const originalSet = db._set.bind(db);
		db._set = ((path: string, data: any, options: any) => {
			if (path.startsWith('brightdata_cache/')) {
				throw new Error('boom');
			}
			return originalSet(path, data, options);
		}) as any;

		await expect(setCachedProfile('https://instagram.com/a/', 'instagram', { url: 'x' } as any)).resolves.toBeUndefined();

		db.batch = (() => ({
			set: vi.fn(),
			commit: vi.fn(async () => {
				throw new Error('boom');
			})
		})) as any;
		await expect(
			setCachedProfilesBatch([{ url: 'https://instagram.com/a/', platform: 'instagram', data: { url: 'x' } as any }])
		).resolves.toBeUndefined();
	});

	it('setCachedProfilesBatch writes in chunks of 500', async () => {
		const { setCachedProfilesBatch, urlToDocId } = await import('../dist/utils/brightdata-cache.js');

		const profiles = Array.from({ length: 501 }, (_, i) => ({
			url: `https://instagram.com/batch${i}/`,
			platform: 'instagram' as const,
			data: { account: `batch${i}` } as any
		}));

		await setCachedProfilesBatch(profiles);

		const docId = urlToDocId(profiles[500].url);
		const snap = await db.collection('brightdata_cache').doc(docId).get();
		expect(snap.exists).toBe(true);
	});
});
