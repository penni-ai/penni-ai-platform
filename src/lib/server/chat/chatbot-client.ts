/**
 * Client for calling the Cloud Run chatbot service
 */

import { env as privateEnv } from '$env/dynamic/private';
import { mintIdToken, getServiceAccountAccessToken } from '$lib/server/firebase/functions-client';
import { ApiProblem } from '../core';
import type { Logger } from '../core';
import { env as publicEnv } from '$env/dynamic/public';

export interface ConversationSnapshot {
	id: string;
	status: 'collecting' | 'ready' | 'searching' | 'complete' | 'needs_config' | 'error';
	collected: {
		website?: string | null;
		business_name?: string | null;
		business_location?: string | null;
		business_about?: string | null;
		influencer_location?: string | null;
		platform?: string | null;
		type_of_influencer?: string | null;
		min_followers?: number | null;
		max_followers?: number | null;
		campaign_title?: string | null;
		fieldStatus?: Record<string, 'not_collected' | 'collected' | 'confirmed'>;
		updatedAt?: number;
	};
	missing: string[];
	messages: Array<{
		id: string;
		role: 'assistant' | 'user';
		content: string;
		type?: string | null;
		createdAt: string;
		turnId?: string | null;
		sources?: Array<{ title?: string | null; url: string; query?: string | null }>;
		sequence?: number | null;
	}>;
}

export interface MessageResponse {
	campaignId: string;
	userMessage: {
		id: string;
		role: 'user';
		content: string;
		createdAt: string;
		turnId?: string | null;
	};
	assistantMessages: Array<{
		id: string;
		role: 'assistant';
		content: string;
		type?: string | null;
		createdAt: string;
		turnId?: string | null;
		sources?: Array<{ title?: string | null; url: string; query?: string | null }>;
		sequence?: number | null;
	}>;
	conversation: ConversationSnapshot;
}

export interface ConversationResponse {
	conversation: ConversationSnapshot;
}

class ChatbotClientError extends Error {
	constructor(
		message: string,
		public status: number,
		public code?: string,
		public details?: unknown
	) {
		super(message);
		this.name = 'ChatbotClientError';
	}
}

/**
 * Check if we're running with Firebase emulators
 */
function isUsingEmulator(): boolean {
	return Boolean(
		process.env.FIREBASE_AUTH_EMULATOR_HOST ||
		publicEnv.PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ||
		process.env.FIRESTORE_EMULATOR_HOST
	);
}

/**
 * Get the chatbot service URL, with fallback for local development
 */
function getChatbotServiceUrl(): string {
	// If using emulator, always use local chatbot service
	if (isUsingEmulator()) {
		return process.env.CHATBOT_SERVICE_URL || 'http://localhost:8080';
	}
	
	// Otherwise use configured URL or fallback
	const chatbotUrl = privateEnv.CHATBOT_SERVICE_URL || process.env.CHATBOT_SERVICE_URL;
	if (chatbotUrl) {
		return chatbotUrl;
	}
	
	// Fallback for local development without emulator
	return 'http://localhost:8080';
}

/**
 * Call the chatbot service with authentication
 */
async function callChatbotService<T>(
	endpoint: string,
	options: {
		method?: 'GET' | 'POST';
		body?: unknown;
		uid: string;
		logger?: Logger;
		signal?: AbortSignal;
	}
): Promise<T> {
	const { method = 'GET', body, uid, logger, signal } = options;
	const serviceUrl = getChatbotServiceUrl();
	const url = `${serviceUrl}${endpoint}`;

	// Get Firebase ID token for user authentication (passed to chatbot service)
	const firebaseToken = await mintIdToken(uid);

	// For production (non-emulator), use service account authentication for Cloud Run IAM
	// Pass Firebase token in custom header for chatbot service to validate
	const isEmulator = isUsingEmulator();
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'X-Firebase-Token': firebaseToken // Custom header for Firebase token
	};

	// Use service account authentication for Cloud Run (required for IAM)
	if (!isEmulator) {
		try {
			const cloudRunToken = await getServiceAccountAccessToken(serviceUrl);
			headers.Authorization = `Bearer ${cloudRunToken}`;
		} catch (error) {
			logger?.warn('Failed to get service account token, falling back to Firebase token', { error });
			// Fallback: use Firebase token directly (may not work if Cloud Run IAM is enforced)
			headers.Authorization = `Bearer ${firebaseToken}`;
		}
	} else {
		// In emulator, use Firebase token directly
		headers.Authorization = `Bearer ${firebaseToken}`;
	}

	const fetchOptions: RequestInit = {
		method,
		headers,
		signal
	};

	if (body && method === 'POST') {
		fetchOptions.body = JSON.stringify(body);
	}

	logger?.debug('Calling chatbot service', { url, method });

	try {
		const response = await fetch(url, fetchOptions);

		// Read response body as text first (can only be read once)
		const responseText = await response.text();

		if (!response.ok) {
			let errorBody: unknown;
			try {
				errorBody = JSON.parse(responseText);
			} catch {
				errorBody = { message: responseText || response.statusText };
			}

			logger?.error('Chatbot service error', {
				status: response.status,
				statusText: response.statusText,
				error: errorBody
			});

			throw new ChatbotClientError(
				`Chatbot service returned ${response.status}`,
				response.status,
				(errorBody as { detail?: string })?.detail,
				errorBody
			);
		}

		// Parse JSON from the text we already read
		const data = JSON.parse(responseText);
		return data as T;
	} catch (error) {
		if (error instanceof ChatbotClientError) {
			throw error;
		}
		if (error instanceof Error && error.name === 'AbortError') {
			throw new ApiProblem({
				status: 499,
				code: 'REQUEST_CANCELLED',
				message: 'Request was cancelled',
				cause: error
			});
		}
		logger?.error('Chatbot service request failed', { error });
		throw new ApiProblem({
			status: 500,
			code: 'CHATBOT_SERVICE_ERROR',
			message: 'Failed to communicate with chatbot service',
			cause: error
		});
	}
}

/**
 * Send a message to the chatbot
 */
export async function sendMessage(
	campaignId: string,
	message: string,
	options: {
		uid: string;
		logger?: Logger;
		signal?: AbortSignal;
	}
): Promise<MessageResponse> {
	return callChatbotService<MessageResponse>(
		`/conversations/${encodeURIComponent(campaignId)}/messages`,
		{
			method: 'POST',
			body: { message },
			...options
		}
	);
}

/**
 * Get conversation state
 */
export async function getConversation(
	campaignId: string,
	options: {
		uid: string;
		logger?: Logger;
		signal?: AbortSignal;
	}
): Promise<ConversationResponse> {
	return callChatbotService<ConversationResponse>(
		`/conversations/${encodeURIComponent(campaignId)}`,
		{
			method: 'GET',
			...options
		}
	);
}

