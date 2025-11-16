// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Logger } from '$lib/server/core';

declare global {
	namespace App {
	interface Locals {
		user: DecodedIdToken | null;
		requestId: string;
		logger: Logger;
	}

		interface PageData {
			user?: {
				uid: string;
				email: string | null;
			} | null;
		}
	}
}

export {};
