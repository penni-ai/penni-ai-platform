/**
 * BrightData profile cache service
 * Caches raw profile data in Firestore to avoid redundant API calls
 */

import { createHash } from 'crypto';
import { getFirestoreInstance } from './firebase-admin.js';
import type {
  BrightDataCacheDoc,
  BrightDataPlatform,
  BrightDataProfile,
  BrightDataInstagramProfile,
  BrightDataTikTokProfile,
} from '../types/brightdata.js';

/** Cache TTL in milliseconds (14 days) */
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Firestore collection name for cache */
const CACHE_COLLECTION = 'brightdata_cache';

/**
 * Normalize a profile URL for consistent cache keys
 * - Lowercase
 * - Remove trailing slash
 * - Standardize domain (www.instagram.com -> instagram.com)
 */
export function normalizeUrlForCache(url: string): string {
  let normalized = url.toLowerCase().trim();

  // Remove trailing slash
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  // Standardize Instagram domains
  normalized = normalized.replace('www.instagram.com', 'instagram.com');

  // Standardize TikTok domains
  normalized = normalized.replace('www.tiktok.com', 'tiktok.com');

  return normalized;
}

/**
 * Convert a URL to a valid Firestore document ID
 * Uses SHA-256 hash (first 40 chars) since URLs contain invalid characters
 */
export function urlToDocId(url: string): string {
  const normalized = normalizeUrlForCache(url);
  const hash = createHash('sha256').update(normalized).digest('hex');
  return hash.substring(0, 40);
}

/**
 * Detect platform from URL
 */
export function detectPlatformFromUrl(url: string): BrightDataPlatform {
  const lower = url.toLowerCase();
  if (lower.includes('tiktok.com')) {
    return 'tiktok';
  }
  return 'instagram';
}

/**
 * Get a single cached profile by URL
 * Returns null if not cached or expired
 */
export async function getCachedProfile(
  profileUrl: string
): Promise<BrightDataProfile | null> {
  const db = getFirestoreInstance();
  const docId = urlToDocId(profileUrl);

  try {
    const docRef = db.collection(CACHE_COLLECTION).doc(docId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return null;
    }

    const data = doc.data() as BrightDataCacheDoc;
    const now = Date.now();

    // Check if expired
    if (data.expires_at < now) {
      // Optionally delete expired doc (async, don't await)
      docRef.delete().catch(() => {});
      return null;
    }

    return data.raw_data;
  } catch (error) {
    console.warn('[BrightDataCache] Error getting cached profile:', {
      url: profileUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Get multiple cached profiles by URLs (batch lookup)
 * Returns a Map of URL -> Profile for cache hits only
 */
export async function getCachedProfilesBatch(
  urls: string[]
): Promise<Map<string, BrightDataProfile>> {
  if (urls.length === 0) {
    return new Map();
  }

  const db = getFirestoreInstance();
  const results = new Map<string, BrightDataProfile>();
  const now = Date.now();

  // Create URL to docId mapping
  const urlToDocIdMap = new Map<string, string>();
  const docIdToUrlMap = new Map<string, string>();

  for (const url of urls) {
    const docId = urlToDocId(url);
    urlToDocIdMap.set(url, docId);
    docIdToUrlMap.set(docId, url);
  }

  // Firestore getAll has a limit of 100 docs per call
  const docIds = Array.from(urlToDocIdMap.values());
  const batchSize = 100;

  try {
    for (let i = 0; i < docIds.length; i += batchSize) {
      const batchDocIds = docIds.slice(i, i + batchSize);
      const docRefs = batchDocIds.map(id => db.collection(CACHE_COLLECTION).doc(id));

      const docs = await db.getAll(...docRefs);

      for (const doc of docs) {
        if (doc.exists) {
          const data = doc.data() as BrightDataCacheDoc;

          // Check if expired
          if (data.expires_at >= now) {
            const originalUrl = docIdToUrlMap.get(doc.id);
            if (originalUrl) {
              results.set(originalUrl, data.raw_data);
            }
          }
        }
      }
    }

    console.info('[BrightDataCache] Batch lookup complete:', {
      requested: urls.length,
      cacheHits: results.size,
      cacheMisses: urls.length - results.size,
    });

    return results;
  } catch (error) {
    console.warn('[BrightDataCache] Error in batch lookup:', {
      error: error instanceof Error ? error.message : String(error),
    });
    return results;
  }
}

/**
 * Cache a single profile
 */
export async function setCachedProfile(
  profileUrl: string,
  platform: BrightDataPlatform,
  rawData: BrightDataProfile
): Promise<void> {
  const db = getFirestoreInstance();
  const docId = urlToDocId(profileUrl);
  const now = Date.now();

  const cacheDoc: BrightDataCacheDoc = {
    profile_url: normalizeUrlForCache(profileUrl),
    platform,
    raw_data: rawData,
    cached_at: now,
    expires_at: now + CACHE_TTL_MS,
  };

  try {
    await db.collection(CACHE_COLLECTION).doc(docId).set(cacheDoc);
  } catch (error) {
    console.warn('[BrightDataCache] Error caching profile:', {
      url: profileUrl,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Cache multiple profiles (batch write)
 */
export async function setCachedProfilesBatch(
  profiles: Array<{ url: string; platform: BrightDataPlatform; data: BrightDataProfile }>
): Promise<void> {
  if (profiles.length === 0) {
    return;
  }

  const db = getFirestoreInstance();
  const now = Date.now();

  // Firestore batch has a limit of 500 writes
  const batchSize = 500;

  try {
    for (let i = 0; i < profiles.length; i += batchSize) {
      const batchProfiles = profiles.slice(i, i + batchSize);
      const batch = db.batch();

      for (const profile of batchProfiles) {
        const docId = urlToDocId(profile.url);
        const docRef = db.collection(CACHE_COLLECTION).doc(docId);

        const cacheDoc: BrightDataCacheDoc = {
          profile_url: normalizeUrlForCache(profile.url),
          platform: profile.platform,
          raw_data: profile.data,
          cached_at: now,
          expires_at: now + CACHE_TTL_MS,
        };

        batch.set(docRef, cacheDoc);
      }

      await batch.commit();
    }

    console.info('[BrightDataCache] Batch cache write complete:', {
      profilesCached: profiles.length,
    });
  } catch (error) {
    console.warn('[BrightDataCache] Error in batch cache write:', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Extract profile URL from raw BrightData profile data
 */
export function extractProfileUrl(profile: BrightDataProfile, platform: BrightDataPlatform): string {
  if (platform === 'instagram') {
    const igProfile = profile as BrightDataInstagramProfile;
    return igProfile.profile_url || igProfile.url || `https://instagram.com/${igProfile.account}/`;
  } else {
    const tkProfile = profile as BrightDataTikTokProfile;
    return tkProfile.url || `https://tiktok.com/@${tkProfile.account_id}`;
  }
}
