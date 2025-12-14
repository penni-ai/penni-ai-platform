/**
 * Centralized plan definitions - Single source of truth for all subscription data
 */

export type PlanKey = 'free' | 'starter' | 'growth' | 'event';

/**
 * Plan limits - SINGLE SOURCE OF TRUTH for all numeric limits
 * Use this constant everywhere instead of hardcoding values
 */
export const PLAN_LIMITS = {
	free: {
		influencerProfiles: 10,
		outreachEmails: 10,
		connectedInboxes: 1,
		csvExport: false
	},
	starter: {
		influencerProfiles: 300,
		outreachEmails: 200,
		connectedInboxes: 1,
		csvExport: false
	},
	growth: {
		influencerProfiles: 1000,
		outreachEmails: 700,
		connectedInboxes: 3,
		csvExport: true
	},
	event: {
		influencerProfiles: 5000,
		outreachEmails: 5000,
		connectedInboxes: 5,
		csvExport: true
	}
} as const;

/**
 * Event Boost credit amounts - one-time credits added on top of any subscription
 */
export const EVENT_BOOST_CREDITS = {
	influencers: PLAN_LIMITS.event.influencerProfiles,
	outreach: PLAN_LIMITS.event.outreachEmails,
	inboxes: 4, // Additional inboxes (added to current plan)
	csvExport: true
} as const;

/**
 * Get plan limits for a given plan key
 */
export function getPlanLimits(planKey: PlanKey | string | null | undefined) {
	if (!planKey || planKey === 'free') return PLAN_LIMITS.free;
	if (planKey === 'starter') return PLAN_LIMITS.starter;
	if (planKey === 'growth') return PLAN_LIMITS.growth;
	if (planKey === 'event') return PLAN_LIMITS.event;
	return PLAN_LIMITS.free;
}

/**
 * Event credits structure stored in user document
 */
export interface EventCredits {
	influencersRemaining: number;
	outreachRemaining: number;
	additionalInboxes: number;
	purchasedAt: number;
	paymentIntentId: string;
}

export interface Plan {
	key: PlanKey;
	name: string;
	price: string;
	cadence: string;
	description: string;
	badge?: string;
	features: string[];
	estimatedAttendance?: string;
	trialCopy?: string;
	oneTime: boolean;
}

/**
 * All available plans - canonical source of truth
 * Update this array to change plan details across the entire app
 */
export const plans: Plan[] = [
	{
		key: 'free',
		name: 'Free',
		price: '$0',
		cadence: 'forever',
		description: 'Try Penny with basic features.',
		estimatedAttendance: 'Great for testing',
		features: [
			'10 influencer profiles',
			'10 searches per month',
			'10 outreach emails',
			'1 connected inbox'
		],
		oneTime: false
	},
	{
		key: 'starter',
		name: 'Starter',
		price: '$99',
		cadence: 'per month',
		description: 'Local businesses and pop-ups who need a fast boost of RSVPs.',
		estimatedAttendance: '10-60 attendees',
		features: [
			'300 influencer profiles',
			'1 connected inbox',
			'200 outreach emails'
		],
		oneTime: false
	},
	{
		key: 'growth',
		name: 'Growth',
		price: '$299',
		cadence: 'per month',
		description: 'Agencies and scaling brands managing several concurrent launches.',
		badge: 'recommended',
		estimatedAttendance: '50-120 attendees',
		features: [
			'1,000 influencer profiles',
			'3 connected inboxes',
			'700 outreach emails',
			'CSV export'
		],
		oneTime: false
	},
	{
		key: 'event',
		name: 'Event Boost',
		price: '$999',
		cadence: 'one-time',
		description: 'One-time credit boost for your current plan. Perfect for launches and events.',
		estimatedAttendance: 'Add to any plan',
		features: [
			'+5,000 influencer credits',
			'+5,000 outreach credits',
			'+4 connected inboxes',
			'CSV export enabled'
		],
		oneTime: true
	}
];

/**
 * Plan lookup map for O(1) access
 */
export const planMap: Record<PlanKey, Plan> = plans.reduce(
	(acc, plan) => {
		acc[plan.key] = plan;
		return acc;
	},
	{} as Record<PlanKey, Plan>
);

/**
 * Get only paid plans (excludes free)
 */
export const paidPlans: Plan[] = plans.filter((p) => p.key !== 'free');

/**
 * Get feature color based on feature text for consistent styling
 */
export function getFeatureColor(feature: string): string {
	const lower = feature.toLowerCase();
	if (lower.includes('influencer profile') || lower.includes('profile')) {
		return 'text-blue-500';
	}
	if (lower.includes('connected outreach inbox') || lower.includes('connected inbox')) {
		return 'text-purple-500';
	}
	if (
		lower.includes('outreach email') ||
		lower.includes('email outreach') ||
		lower.includes('email')
	) {
		return 'text-orange-500';
	}
	if (lower.includes('search')) {
		return 'text-pink-500';
	}
	if (lower.includes('csv') || lower.includes('export') || lower.includes('reporting')) {
		return 'text-indigo-500';
	}
	return 'text-gray-500';
}

/**
 * Format currency amount from cents
 */
export function formatCurrency(amount: number, currency: string): string {
	return new Intl.NumberFormat(undefined, {
		style: 'currency',
		currency
	}).format(amount / 100);
}

/**
 * Format timestamp to readable date
 */
export function formatTimestamp(seconds: number | null): string | null {
	if (!seconds) return null;
	return new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	}).format(new Date(seconds * 1000));
}
