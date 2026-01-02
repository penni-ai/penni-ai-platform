import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAdminUser } from '$lib/server/core';
import { getPipelineRun } from '$lib/server/admin/pipeline-runs';
import { adminStorage } from '$lib/firebase/admin';

type InfluencerRow = {
	rank: number;
	fit_score: number | null;
	profile_url: string | null;
	display_name: string | null;
	platform: string | null;
	followers: number | null;
	fit_summary: string | null;
};

function resolveBucketName(): string {
	const resolvedProjectId =
		process.env.GOOGLE_CLOUD_PROJECT ||
		process.env.FIREBASE_PROJECT_ID ||
		adminStorage.app.options.projectId ||
		'penni-ai-platform';
	const fallbackBucket = `${resolvedProjectId}.firebasestorage.app`;
	return (
		process.env.STORAGE_BUCKET ||
		process.env.FIREBASE_STORAGE_BUCKET ||
		adminStorage.app.options.storageBucket ||
		fallbackBucket
	);
}

async function loadJsonArray(storagePath: string): Promise<any[]> {
	const bucketName = resolveBucketName();
	const bucket = adminStorage.bucket(bucketName);
	const file = bucket.file(storagePath);

	const [exists] = await file.exists();
	if (!exists) return [];

	const [contents] = await file.download();
	const parsed = JSON.parse(contents.toString('utf-8'));
	return Array.isArray(parsed) ? parsed : [];
}

function toNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toString(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function extractInfluencerRow(profile: any, index: number): InfluencerRow {
	const fitScore = toNumber(profile?.fit_score);
	const followers = toNumber(profile?.followers);
	return {
		rank: index + 1,
		fit_score: fitScore,
		profile_url: toString(profile?.profile_url),
		display_name: toString(profile?.display_name) ?? toString(profile?.name),
		platform: toString(profile?.platform),
		followers,
		fit_summary: toString(profile?.fit_summary)
	};
}

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) {
		throw error(401, 'Authentication required.');
	}
	if (!isAdminUser(user)) {
		throw error(403, 'Admin access required.');
	}

	const pipelineId = event.params.pipelineId;
	if (!pipelineId) {
		throw error(400, 'Pipeline ID is required.');
	}

	const run = await getPipelineRun(pipelineId);
	if (!run) {
		throw error(404, 'Pipeline run not found.');
	}

	const finalPath = run.storage?.profiles_storage_path ?? null;
	const remainingPath = run.storage?.remaining_profiles_storage_path ?? null;
	const progressivePath = run.storage?.progressive_profiles_storage_path ?? null;

	const shouldUseProgressive = !finalPath && Boolean(progressivePath);
	const primaryPath = shouldUseProgressive ? progressivePath : finalPath;

	if (!primaryPath) {
		return json({
			source: 'none',
			total: 0,
			profiles: [] as InfluencerRow[]
		});
	}

	const profiles = await loadJsonArray(primaryPath);
	const remainingProfiles = !shouldUseProgressive && remainingPath ? await loadJsonArray(remainingPath) : [];
	const combined = [...profiles, ...remainingProfiles];

	combined.sort((a, b) => (toNumber(b?.fit_score) ?? 0) - (toNumber(a?.fit_score) ?? 0));
	const rows = combined.map((profile, index) => extractInfluencerRow(profile, index));

	return json({
		source: shouldUseProgressive ? 'progressive' : 'final',
		total: rows.length,
		profiles: rows
	});
};

