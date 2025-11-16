import { randomUUID } from 'crypto';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { campaignDocRef, chatCollectedDocRef, type ChatCollectedData } from './core';
import type { Logger } from './core';

export type SerializedCampaign = {
	id: string | null;
	createdAt: number | null;
	updatedAt: number | null;
	title: string | null;
	website: string | null;
	business_name: string | null;
	type_of_influencer: string | null;
	locations: string | null;
	followers: string | null;
	business_location: string | null;
	platform: string | null;
	followersMin: number | null;
	followersMax: number | null;
	businessSummary: string | null;
	lastUpdatedTurnId: string | null;
	pipeline_id: string | null;
	influencerTypes?: string | null;
	influencerSearchQuery?: string | null;
	// Detailed fields for info panel
	status?: 'collecting' | 'ready' | 'searching' | 'complete' | 'needs_config' | 'error';
	collected?: Record<string, string | undefined>;
	missing?: string[];
	fieldStatus?: {
		website?: 'not_collected' | 'collected' | 'confirmed';
		business_name?: 'not_collected' | 'collected' | 'confirmed';
		business_location?: 'not_collected' | 'collected' | 'confirmed';
		business_about?: 'not_collected' | 'collected' | 'confirmed';
		influencer_location?: 'not_collected' | 'collected' | 'confirmed';
		min_followers?: 'not_collected' | 'collected' | 'confirmed';
		max_followers?: 'not_collected' | 'collected' | 'confirmed';
	};
	search?: {
		status: 'idle' | 'pending' | 'complete' | 'error' | 'needs_config';
		results?: unknown;
		lastError?: string | null;
		completedAt?: string | null;
	};
	followerRange?: { min: number | null; max: number | null };
	messageSequence?: number;
};

function toMillis(value: unknown): number | null {
	if (typeof value === 'number') return value;
	if (value && typeof value === 'object' && 'toMillis' in value) {
		try {
			const result = (value as { toMillis: () => number }).toMillis();
			return typeof result === 'number' ? result : null;
		} catch {
			return null;
		}
	}
	return null;
}

function followerBound(value: unknown): number | null {
	if (typeof value !== 'number') return null;
	if (!Number.isFinite(value)) return null;
	return Math.round(value);
}

export async function serializeCampaignRecord(
	data: Record<string, unknown>,
	docId: string,
	uid?: string
): Promise<SerializedCampaign> {
	const id = docId;

	// Read collected data from new structure if uid and id are available
	let collectedData: ChatCollectedData | null = null;
	if (uid && id) {
		try {
			const collectedRef = chatCollectedDocRef(uid, id);
			const collectedDoc = await collectedRef.get();
			if (collectedDoc.exists) {
				collectedData = collectedDoc.data() as ChatCollectedData;
			}
		} catch (error) {
			console.warn('[campaigns] Failed to read chat/collected data', error);
		}
	}

	const typeOfInfluencer = collectedData?.type_of_influencer ?? null;
	const website = collectedData?.website ?? null;
	const businessName = collectedData?.business_name ?? null;
	const businessLocation = collectedData?.business_location ?? null;
	const locations = collectedData?.influencer_location ?? null;
	const platform = collectedData?.platform ?? null;
	const followersMin = collectedData?.min_followers ?? null;
	const followersMax = collectedData?.max_followers ?? null;
	const businessSummary = collectedData?.business_about ?? null;

	// Build collected record for backward compatibility
	const collected: Record<string, string | undefined> = {};
	if (collectedData?.website) collected.website = collectedData.website;
	if (collectedData?.business_name) collected.business_name = collectedData.business_name;
	if (collectedData?.business_location) collected.business_location = collectedData.business_location;
	if (collectedData?.influencer_location) collected.locations = collectedData.influencer_location;
	if (collectedData?.platform) collected.platform = collectedData.platform;
	if (collectedData?.type_of_influencer) collected.type_of_influencer = collectedData.type_of_influencer;

	return {
		id,
		createdAt: toMillis(data.createdAt) ?? (typeof data.createdAtMs === 'number' ? data.createdAtMs : null),
		updatedAt: toMillis(data.updatedAt) ?? (typeof data.updatedAtMs === 'number' ? data.updatedAtMs : null),
		title: typeof data.title === 'string' ? data.title : null,
		website,
		business_name: businessName,
		type_of_influencer: typeOfInfluencer,
		locations,
		followers: null, // No longer stored as text, use followersMin/followersMax
		business_location: businessLocation,
		platform,
		followersMin,
		followersMax,
		businessSummary,
		lastUpdatedTurnId: typeof data.lastUpdatedTurnId === 'string' ? data.lastUpdatedTurnId : null,
		pipeline_id: typeof data.pipeline_id === 'string' ? data.pipeline_id : null,
		// Include detailed fields
		status: typeof data.status === 'string' ? data.status as SerializedCampaign['status'] : undefined,
		collected: Object.keys(collected).length > 0 ? collected : undefined,
		missing: Array.isArray(data.missing) ? data.missing.filter((m): m is string => typeof m === 'string') : undefined,
		fieldStatus: collectedData?.fieldStatus,
		search: data.search && typeof data.search === 'object' ? {
			status: typeof (data.search as any).status === 'string' ? (data.search as any).status : 'idle',
			results: (data.search as any).results,
			lastError: typeof (data.search as any).lastError === 'string' ? (data.search as any).lastError : null,
			completedAt: typeof (data.search as any).completedAt === 'string' ? (data.search as any).completedAt : null
		} : undefined,
		followerRange: (followersMin !== null || followersMax !== null) ? {
			min: followersMin,
			max: followersMax
		} : undefined,
		messageSequence: typeof data.messageSequence === 'number' ? data.messageSequence : undefined
	};
}

export async function serializeCampaignSnapshot(doc: QueryDocumentSnapshot, uid?: string): Promise<SerializedCampaign> {
	return serializeCampaignRecord(doc.data() ?? {}, doc.id, uid);
}

/**
 * Create a new campaign document in Firestore.
 * The chatbot service will handle messages and sync collected data.
 */
export async function createCampaign(uid: string, logger?: Logger): Promise<string> {
	const campaignId = randomUUID();
	const now = Date.now();
	
	const campaignRef = campaignDocRef(uid, campaignId);
	
	// Create minimal campaign document
	await campaignRef.set({
		id: campaignId,
		title: 'New Campaign',
		status: 'collecting' as const,
		createdAt: now,
		updatedAt: now
	});

	// Create initial collected data document (will be synced by chatbot service)
	const collectedRef = chatCollectedDocRef(uid, campaignId);
	await collectedRef.set({
		website: null,
		business_name: null,
		business_location: null,
		business_about: null,
		influencer_location: null,
		platform: null,
		type_of_influencer: null,
		min_followers: null,
		max_followers: null,
		campaign_title: null,
		fieldStatus: {},
		updatedAt: now
	});

	logger?.info('Campaign created', { campaignId });

	return campaignId;
}
