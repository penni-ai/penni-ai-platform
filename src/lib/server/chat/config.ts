import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

/**
 * Environment modes for chatbot service
 */
export type ChatbotEnv = 'local' | 'emulator' | 'production';

/**
 * Check if we're running with Firebase emulators
 */
export function isUsingEmulator(): boolean {
	return Boolean(
		process.env.FIREBASE_AUTH_EMULATOR_HOST ||
		publicEnv.PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ||
		process.env.FIRESTORE_EMULATOR_HOST
	);
}

/**
 * Determine the chatbot environment mode
 */
export function getChatbotEnv(): ChatbotEnv {
	if (isUsingEmulator()) {
		return 'emulator';
	}
	// If we have a configured production URL, assume production
	if (privateEnv.CHATBOT_SERVICE_URL || process.env.CHATBOT_SERVICE_URL) {
		return 'production';
	}
	// Otherwise, assume local development
	return 'local';
}

/**
 * Get the chatbot service URL, with fallback for local development
 * 
 * Precedence:
 * 1. If using emulator, use CHATBOT_SERVICE_URL or default to localhost:8080
 * 2. Otherwise, use configured CHATBOT_SERVICE_URL (from private or process env)
 * 3. Fallback to localhost:8080 for local development
 */
export function getChatbotServiceUrl(): string {
	const env = getChatbotEnv();
	
	// If using emulator, always use local chatbot service
	if (env === 'emulator') {
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

