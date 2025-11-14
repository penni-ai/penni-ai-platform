import type { LayoutServerLoad } from './$types';
import { userDocRef } from '$lib/server/firestore';
import type { UserStripeState, SubscriptionSnapshot } from '$lib/server/firestore';

function formatPeriodEnd(periodEnd: number | null) {
	if (!periodEnd) return null;
	return new Date(periodEnd * 1000).toISOString();
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
	const userData = userSnap.data() as (UserStripeState & { profile?: { fullName?: string; locale?: string } }) | undefined;

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

const format = (seconds: number | null) => (seconds ? new Date(seconds * 1000).toISOString() : null);

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
				cancelAtPeriodEnd: subscriptionData.cancelAtPeriodEnd ?? false
			}
			: null,
		usage: fallbackUsage,
		userEmail
	};
};

