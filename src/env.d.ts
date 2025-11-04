/// <reference types="svelte" />
/// <reference types="vite/client" />

declare module '$env/static/private' {
	export const FIREBASE_PROJECT_ID: string;
	export const FIREBASE_CLIENT_EMAIL: string;
	export const FIREBASE_PRIVATE_KEY: string;
	export const FIREBASE_AUTH_EMULATOR_HOST: string;
}

declare module '$env/static/public' {
	export const PUBLIC_FIREBASE_API_KEY: string;
	export const PUBLIC_FIREBASE_AUTH_DOMAIN: string;
	export const PUBLIC_FIREBASE_PROJECT_ID: string;
	export const PUBLIC_FIREBASE_STORAGE_BUCKET: string;
	export const PUBLIC_FIREBASE_MESSAGING_SENDER_ID: string;
	export const PUBLIC_FIREBASE_APP_ID: string;
	export const PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: string;
	export const PUBLIC_SITE_URL: string;
}

declare module '$env/dynamic/private' {
	export const env: {
		FIREBASE_PROJECT_ID?: string;
		FIREBASE_CLIENT_EMAIL?: string;
		FIREBASE_PRIVATE_KEY?: string;
		FIREBASE_AUTH_EMULATOR_HOST?: string;
		[key: string]: string | undefined;
	};
}

declare module '$env/dynamic/public' {
	export const env: {
		PUBLIC_FIREBASE_API_KEY?: string;
		PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
		PUBLIC_FIREBASE_PROJECT_ID?: string;
		PUBLIC_FIREBASE_STORAGE_BUCKET?: string;
		PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string;
		PUBLIC_FIREBASE_APP_ID?: string;
		PUBLIC_FIREBASE_AUTH_EMULATOR_HOST?: string;
		PUBLIC_SITE_URL?: string;
		[key: string]: string | undefined;
	};
}
