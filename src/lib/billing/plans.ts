/**
 * Centralized plan definitions - Single source of truth for all subscription data
 */

export type PlanKey = 'free' | 'starter' | 'growth' | 'event';

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
		name: 'Free Plan',
		price: '$0',
		cadence: 'forever',
		description: 'Perfect for trying out Penny with basic features.',
		estimatedAttendance: 'Great for testing',
		features: [
			'Access to 10 influencer profiles',
			'Up to 10 influencer searches per month',
			'10 outreach emails & 1 connected inbox'
		],
		oneTime: false
	},
	{
		key: 'starter',
		name: 'Starter Plan',
		price: '$99',
		cadence: 'per month after trial',
		description: 'Local businesses and pop-ups who need a fast boost of RSVPs.',
		badge: 'Includes free trial',
		estimatedAttendance: 'Estimated 10-60 attendees',
		trialCopy: '3-day free trial • 20 influencers • 10 emails • paywall on CSV export',
		features: [
			'Access to 300 influencer profiles per month',
			'1 connected outreach inbox',
			'Send up to 200 outreach emails per month'
		],
		oneTime: false
	},
	{
		key: 'growth',
		name: 'Growth Plan',
		price: '$299',
		cadence: 'per month',
		description: 'Agencies and scaling brands managing several concurrent launches.',
		badge: 'Most popular',
		estimatedAttendance: 'Estimated 50-120 attendees',
		features: [
			'Access to 1,000 influencer profiles per month',
			'3 connected outreach inboxes',
			'Send up to 700 outreach emails per month',
			'CSV export capabilities'
		],
		oneTime: false
	},
	{
		key: 'event',
		name: 'Event Special',
		price: '$999',
		cadence: 'one-time activation',
		description: 'Festivals, launches, or venue takeovers that need instant reach and concierge help.',
		estimatedAttendance: 'Designed for 500-1,500 attendees / interest',
		features: [
			'Access to 5,000 influencer profiles (one-time)',
			'5 connected outreach inboxes',
			'Send up to 5,000 outreach messages',
			'Full CSV export + CRM sync included'
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
