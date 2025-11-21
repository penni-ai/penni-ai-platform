/**
 * Client for calling the Cloud Run chatbot service
 */

import { mintIdToken, getServiceAccountAccessToken } from '$lib/server/firebase/functions-client';
import { ApiProblem } from '../core';
import type { Logger } from '../core';
import { getChatbotServiceUrl, isUsingEmulator } from './config';

export interface ConversationSnapshot {
	id: string;
	status: 'collecting' | 'ready' | 'complete' | 'error';
	collected: {
		website?: string | null;
		business_name?: string | null;
		business_location?: string | null;
		business_about?: string | null;
		influencer_location?: string | null;
		platform?: string[] | string | null;
		type_of_influencer?: string | null;
		min_followers?: number | null;
		max_followers?: number | null;
		campaign_title?: string | null;
		updatedAt?: number;
	};
	messages: Array<{
		id: string;
		role: 'assistant' | 'user' | 'system' | 'tool';
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
		timeout?: number; // Optional timeout in milliseconds
	}
): Promise<T> {
	const { method = 'GET', body, uid, logger, signal, timeout = 15000 } = options;
	const serviceUrl = getChatbotServiceUrl();
	const url = `${serviceUrl}${endpoint}`;
	
	// Create abort controller for timeout
	const timeoutController = new AbortController();
	const timeoutId = setTimeout(() => {
		timeoutController.abort();
	}, timeout);
	
	// Combine signals: create a combined controller that aborts when either signal aborts
	const combinedController = new AbortController();
	
	// Abort combined controller when timeout triggers
	timeoutController.signal.addEventListener('abort', () => {
		clearTimeout(timeoutId);
		combinedController.abort();
	});
	
	// Abort combined controller when external signal aborts
	if (signal) {
		signal.addEventListener('abort', () => {
			clearTimeout(timeoutId);
			combinedController.abort();
		});
	}
	
	const combinedSignal = combinedController.signal;

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
			// If service account token creation fails, we need to allow unauthenticated access
			// on the chatbot function, OR fix the GoogleAuth initialization
			// For now, log the error and throw - this will surface the issue
			logger?.error('Failed to get service account token for chatbot function', { 
				error: error instanceof Error ? error.message : String(error),
				serviceUrl,
				hint: 'The chatbot function may need to allow unauthenticated access, or GoogleAuth needs to be configured to use App Hosting service account'
			});
			// Still try with Firebase token as fallback (won't work if IAM is enforced)
			headers.Authorization = `Bearer ${firebaseToken}`;
		}
	} else {
		// In emulator, use Firebase token directly
		headers.Authorization = `Bearer ${firebaseToken}`;
	}

	const fetchOptions: RequestInit = {
		method,
		headers,
		signal: combinedSignal
	};

	if (body && method === 'POST') {
		fetchOptions.body = JSON.stringify(body);
	}

	logger?.debug('Calling chatbot service', { url, method });

	try {
		const response = await fetch(url, fetchOptions);

		// Clear timeout if request succeeded
		if (timeoutId) {
			clearTimeout(timeoutId);
		}

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

			// Handle both FastAPI format ({detail: "..."}) and Flask format ({error: "..."})
			const errorObj = errorBody as { detail?: string; error?: string; message?: string };
			const errorMessage = errorObj.detail || errorObj.error || errorObj.message || response.statusText;

			throw new ChatbotClientError(
				errorMessage || `Chatbot service returned ${response.status}`,
				response.status,
				errorMessage,
				errorBody
			);
		}

		// Parse JSON from the text we already read
		const data = JSON.parse(responseText);
		return data as T;
	} catch (error) {
		// Clear timeout on error
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		
		if (error instanceof ChatbotClientError) {
			throw error;
		}
		if (error instanceof Error && error.name === 'AbortError') {
			// Check if timeout was the cause (timeout controller aborted but external signal didn't)
			const isTimeout = timeoutController.signal.aborted && (!signal || !signal.aborted);
			throw new ApiProblem({
				status: 504,
				code: isTimeout ? 'REQUEST_TIMEOUT' : 'REQUEST_CANCELLED',
				message: isTimeout ? 'Request timed out. Please try again.' : 'Request was cancelled',
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
		timeout?: number;
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

