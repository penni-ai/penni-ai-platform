import OpenAI from 'openai';
import { env as privateEnv } from '$env/dynamic/private';

const apiKey = privateEnv.OPENAI_API_KEY;

if (!apiKey) {
	console.warn('[openai] OPENAI_API_KEY is not set. Assistant features will return fallback copy.');
}

export const openaiClient = new OpenAI({
	apiKey
});

export const DEFAULT_MODEL = privateEnv.OPENAI_MODEL ?? 'gpt-4o-mini';
