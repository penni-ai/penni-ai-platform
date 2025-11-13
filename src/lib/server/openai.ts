import OpenAI from 'openai';
import { env as privateEnv } from '$env/dynamic/private';

let openaiClientInstance: OpenAI | null = null;

/**
 * Get OpenAI client instance (lazy-loaded to avoid initialization during build)
 */
export function getOpenAIClient(): OpenAI {
	if (!openaiClientInstance) {
		const apiKey = privateEnv.OPENAI_API_KEY;
		if (!apiKey) {
			throw new Error('OPENAI_API_KEY is not set. Assistant features require an API key.');
		}
		openaiClientInstance = new OpenAI({
			apiKey
		});
	}
	return openaiClientInstance;
}

/**
 * Get OpenAI client instance, or null if API key is not configured
 */
export function getOpenAIClientOrNull(): OpenAI | null {
	const apiKey = privateEnv.OPENAI_API_KEY;
	if (!apiKey) {
		return null;
	}
	return getOpenAIClient();
}

// For backward compatibility - but will throw if API key is missing
export const openaiClient = new Proxy({} as OpenAI, {
	get(_target, prop) {
		return getOpenAIClient()[prop as keyof OpenAI];
	}
});

export const DEFAULT_MODEL = privateEnv.OPENAI_MODEL ?? 'gpt-4o-mini';
