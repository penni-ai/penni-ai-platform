import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

export type SerializedCampaign = {
	id: string | null;
	createdAt: number | null;
	updatedAt: number | null;
	website: string | null;
	influencerTypes: string | null;
	locations: string | null;
	followers: string | null;
	followersMin: number | null;
	followersMax: number | null;
	keywords: string[];
	businessSummary: string | null;
	sourceConversationId: string | null;
	lastUpdatedTurnId: string | null;
};

const KEYWORD_LIMIT = 20;

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

function normalizeKeywordList(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const keywords: string[] = [];
	for (const item of raw) {
		if (typeof item !== 'string') continue;
		const trimmed = item.trim().toLowerCase();
		if (!trimmed) continue;
		if (seen.has(trimmed)) continue;
		seen.add(trimmed);
		keywords.push(trimmed);
		if (keywords.length >= KEYWORD_LIMIT) break;
	}
	return keywords;
}

export function serializeCampaignRecord(
	data: Record<string, unknown>,
	fallbackId?: string
): SerializedCampaign {
	const id =
		typeof data.id === 'string' && data.id.trim().length > 0
			? data.id
			: typeof fallbackId === 'string'
				? fallbackId
				: null;

	const influencerTypes =
		typeof data.influencerTypes === 'string'
			? data.influencerTypes
			: typeof data.audience === 'string'
				? data.audience
				: null;

	return {
		id,
		createdAt: toMillis(data.createdAt) ?? (typeof data.createdAtMs === 'number' ? data.createdAtMs : null),
		updatedAt: toMillis(data.updatedAt) ?? (typeof data.updatedAtMs === 'number' ? data.updatedAtMs : null),
		website: typeof data.website === 'string' ? data.website : null,
		influencerTypes,
		locations: typeof data.locations === 'string' ? data.locations : null,
		followers: typeof data.followers === 'string' ? data.followers : null,
		followersMin: followerBound(data.followersMin),
		followersMax: followerBound(data.followersMax),
		keywords: normalizeKeywordList(data.keywords),
		businessSummary: typeof data.businessSummary === 'string' ? data.businessSummary : null,
		sourceConversationId: typeof data.sourceConversationId === 'string' ? data.sourceConversationId : null,
		lastUpdatedTurnId: typeof data.lastUpdatedTurnId === 'string' ? data.lastUpdatedTurnId : null
	};
}

export function serializeCampaignSnapshot(doc: QueryDocumentSnapshot): SerializedCampaign {
	return serializeCampaignRecord(doc.data() ?? {}, doc.id);
}
