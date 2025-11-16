import { firestore, userDocRef, type UserUsage } from '../core';

/**
 * Get the monthly search limit for a user based on their plan
 */
export function getSearchLimit(planKey: string | null | undefined): number {
	if (planKey === 'starter') {
		return 300; // Starter plan: 300 searches/month
	}
	if (planKey === 'growth') {
		return 1000; // Growth plan: 1000 searches/month
	}
	if (planKey === 'event') {
		return 5000; // Event plan: 5000 searches (one-time)
	}
	// Free plan (or no plan): 30 searches/month
	return 30;
}

/**
 * Get current month key in format "YYYY-MM"
 */
function getCurrentMonthKey(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	return `${year}-${month}`;
}

/**
 * Get the reset date (first day of next month) as a timestamp
 */
function getResetDate(): number {
	const now = new Date();
	const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
	return nextMonth.getTime();
}

/**
 * Get user's current search usage for this month
 */
export async function getSearchUsage(uid: string): Promise<{ count: number; limit: number; remaining: number; resetDate: number }> {
	const userDoc = await userDocRef(uid).get();
	const userData = userDoc.data();
	const usage = userData?.usage as UserUsage | undefined;
	const currentMonth = getCurrentMonthKey();
	
	// If no usage record or different month, reset to 0
	const count = usage?.influencersFound?.month === currentMonth ? (usage.influencersFound.count ?? 0) : 0;
	
	// Get user's plan to determine limit
	const planKey = (userData?.currentPlan as { planKey?: string | null } | undefined)?.planKey ?? null;
	const limit = getSearchLimit(planKey);
	const remaining = Math.max(0, limit - count);
	const resetDate = getResetDate();
	
	return { count, limit, remaining, resetDate };
}

/**
 * Increment user's search usage count for current month
 */
export async function incrementSearchUsage(uid: string, amount: number = 1): Promise<void> {
	const userRef = userDocRef(uid);
	const currentMonth = getCurrentMonthKey();
	const now = Date.now();
	
	await firestore.runTransaction(async (tx) => {
		const userDoc = await tx.get(userRef);
		const userData = userDoc.data();
		
		// Get existing usage or initialize with defaults
		let usage = userData?.usage as UserUsage | undefined;
		if (!usage) {
			usage = {
				outreachSent: { month: currentMonth, count: 0, updatedAt: now },
				influencersFound: { month: currentMonth, count: 0, updatedAt: now }
			};
		}
		
		// Ensure outreachSent usage exists (preserve it)
		if (!usage.outreachSent) {
			usage.outreachSent = { month: currentMonth, count: 0, updatedAt: now };
		}
		
		// Ensure influencersFound usage exists (preserve it)
		if (!usage.influencersFound) {
			usage.influencersFound = { month: currentMonth, count: 0, updatedAt: now };
		}
		
		// If different month, reset to 0
		if (usage.influencersFound.month !== currentMonth) {
			usage.influencersFound = {
				month: currentMonth,
				count: amount,
				updatedAt: now
			};
		} else {
			// Increment existing count
			usage.influencersFound.count = (usage.influencersFound.count ?? 0) + amount;
			usage.influencersFound.updatedAt = now;
		}
		
		tx.update(userRef, {
			usage,
				updatedAt: now
			});
	});
}
