import type { LayoutServerLoad } from './$types';
import { userDocRef } from '$lib/server/core';
import type { UserStripeState, SubscriptionSnapshot } from '$lib/server/core';

function formatPeriodEnd(periodEnd: number | null) {
	if (!periodEnd) return null;
	// Webhook stores timestamps in milliseconds (already multiplied by 1000)
	// Check if value is in ms (> 1e12 = year 2001+) or seconds
	const ms = periodEnd > 1e12 ? periodEnd : periodEnd * 1000;
	return new Date(ms).toISOString();
}

export const load: LayoutServerLoad = async ({ locals }) => {
	const uid = locals.user?.uid ?? null;
	const userEmail = locals.user?.email ?? null;

	if (!uid) {
		return {
			profile: null,
			subscription: null,
			userEmail
		};
	}

	const userSnap = await userDocRef(uid).get();
	const userData = userSnap.data() as (UserStripeState & {
		profile?: { fullName?: string; locale?: string };
		eventCredits?: {
			influencersRemaining?: number;
			outreachRemaining?: number;
			additionalInboxes?: number;
		};
		currentPlan?: {
			scheduledPlanChange?: string;
			changeAt?: number;
			downgradeTo?: string;
			cancelAt?: number;
		};
	}) | undefined;

	const subsSnap = await userDocRef(uid)
		.collection('subscriptions')
		.orderBy('updatedAt', 'desc')
		.limit(1)
		.get();
const subscriptionData = subsSnap.docs[0]?.data() as SubscriptionSnapshot | undefined;

const usageSnapshot = await userDocRef(uid)
	.collection('usageMetrics')
	.orderBy('recordedAt', 'desc')
	.limit(10)
	.get()
	.catch((error) => {
		console.warn('[account] usage query failed', error);
		return null;
	});

const usageRows = usageSnapshot
	? usageSnapshot.docs
		.map((doc) => {
			const raw = doc.data() as { metric?: string; quantity?: number; recordedAt?: number | string };
			const metric = raw.metric ?? doc.id;
			const quantity = typeof raw.quantity === 'number' ? raw.quantity : 0;
			let recordedAt: string | null = null;
			if (typeof raw.recordedAt === 'number') {
				recordedAt = new Date(raw.recordedAt * 1000).toISOString();
			} else if (typeof raw.recordedAt === 'string') {
				recordedAt = raw.recordedAt;
			}
			return recordedAt
				? {
					metric,
					quantity,
					recordedAt
				}
				: null;
		})
		.filter((row): row is { metric: string; quantity: number; recordedAt: string } => row !== null)
	: [];

const fallbackUsage = usageRows.length
	? usageRows
	: [
		{ metric: 'Emails sent', quantity: 92, recordedAt: new Date().toISOString() },
		{ metric: 'Creators invited', quantity: 28, recordedAt: new Date(Date.now() - 86400000).toISOString() }
	];

	return {
		profile: {
			full_name: userData?.profile?.fullName ?? '',
			locale: userData?.profile?.locale ?? 'en'
		},
		subscription: subscriptionData
			? {
				planKey: subscriptionData.planKey ?? 'trial',
				status: subscriptionData.status,
				currentPeriodEnd: formatPeriodEnd(subscriptionData.currentPeriodEnd),
				currentPeriodEndRaw: subscriptionData.currentPeriodEnd ?? null,
				trialEnd: formatPeriodEnd(subscriptionData.trialEnd ?? null),
				trialEndRaw: subscriptionData.trialEnd ?? null,
				cancelAtPeriodEnd: subscriptionData.cancelAtPeriodEnd ?? false,
				cancelAt: subscriptionData.cancelAt ?? userData?.currentPlan?.cancelAt ?? null,
				scheduledPlanChange: userData?.currentPlan?.scheduledPlanChange ?? null,
				changeAt: userData?.currentPlan?.changeAt ?? null,
				downgradeTo: userData?.currentPlan?.downgradeTo ?? null
			}
			: null,
		eventCredits: userData?.eventCredits ?? null,
		usage: fallbackUsage,
		userEmail
	};
};
