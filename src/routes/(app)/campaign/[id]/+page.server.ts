import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { campaignDocRef } from '$lib/server/core';
import { serializeCampaignRecord } from '$lib/server/campaigns';

const CAMPAIGN_LOAD_TIMEOUT_MS = 8000; // 8 second timeout for campaign load

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout>;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
	});
	try {
		const result = await Promise.race([promise, timeoutPromise]);
		clearTimeout(timeoutId!);
		return result;
	} catch (err) {
		clearTimeout(timeoutId!);
		throw err;
	}
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const campaignId = params.id;
	if (!campaignId) {
		throw error(400, 'Campaign ID is required');
	}

	const user = locals.user;
	if (!user) {
		throw error(401, 'Unauthorized');
	}

	try {
		const doc = await withTimeout(
			campaignDocRef(user.uid, campaignId).get(),
			CAMPAIGN_LOAD_TIMEOUT_MS
		);
		if (!doc.exists) {
			redirect(302, '/dashboard');
		}

		const campaignData = doc.data() ?? {};
		const campaign = await serializeCampaignRecord(campaignData, doc.id, user.uid);

		return {
			campaign
		};
	} catch (err) {
		// Preserve framework control-flow errors (redirects / HttpError).
		if (
			typeof err === 'object' &&
			err !== null &&
			'status' in err &&
			(typeof (err as { status?: unknown }).status === 'number') &&
			(('location' in err && typeof (err as { location?: unknown }).location === 'string') || 'body' in err)
		) {
			throw err;
		}

		console.error('[campaign] Failed to load campaign', { campaignId, error: err });
		throw error(500, 'Failed to load campaign. Please try again.');
	}
};
