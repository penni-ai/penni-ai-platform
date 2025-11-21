import type { ConversationSnapshot } from './chatbot-client';

/**
 * UI-ready conversation shape with derived fields for frontend consumption
 */
export interface UIConversation {
	id: string;
	status: ConversationSnapshot['status'];
	collected: {
		website?: string;
		business_name?: string;
		business_location?: string;
		business_about?: string;
		locations?: string;
		platform?: string | string[];
		type_of_influencer?: string;
		followers?: string;
	};
	messages: ConversationSnapshot['messages'];
	followerRange: {
		min: number | null | undefined;
		max: number | null | undefined;
	};
}

/**
 * Maps a ConversationSnapshot from the chatbot service to UI-ready format.
 * Derives UI-only fields like `followers` string and `followerRange` from the collected data.
 */
export function mapConversationToUi(conversation: ConversationSnapshot): UIConversation {
	const { collected, messages, ...rest } = conversation;

	// Derive followers string from min/max
	const followers =
		collected.min_followers !== null || collected.max_followers !== null
			? `${collected.min_followers ?? ''}-${collected.max_followers ?? ''}`
			: undefined;

	return {
		...rest,
		collected: {
			website: collected.website ?? undefined,
			business_name: collected.business_name ?? undefined,
			business_location: collected.business_location ?? undefined,
			business_about: collected.business_about ?? undefined,
			locations: collected.influencer_location ?? undefined,
			platform: collected.platform ?? undefined,
			type_of_influencer: collected.type_of_influencer ?? undefined,
			followers,
		},
		messages,
		followerRange: {
			min: collected.min_followers,
			max: collected.max_followers,
		},
	};
}

