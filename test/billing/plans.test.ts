import { describe, expect, it } from 'vitest';

import { formatCurrency, formatTimestamp, getFeatureColor, getPlanLimits, plans } from '../../src/lib/billing/plans';

describe('billing/plans', () => {
	it('getPlanLimits falls back to free and returns known plan limits', () => {
		expect(getPlanLimits(undefined)).toEqual(getPlanLimits('free'));
		expect(getPlanLimits('unknown')).toEqual(getPlanLimits('free'));
		expect(getPlanLimits('starter').influencerProfiles).toBeGreaterThan(0);
		expect(getPlanLimits('growth').csvExport).toBe(true);
		expect(getPlanLimits('event').connectedInboxes).toBeGreaterThan(0);
	});

	it('getFeatureColor assigns consistent colors', () => {
		expect(getFeatureColor('10 influencer profiles')).toContain('text-blue');
		expect(getFeatureColor('1 connected inbox')).toContain('text-purple');
		expect(getFeatureColor('200 outreach emails')).toContain('text-orange');
		expect(getFeatureColor('10 searches per month')).toContain('text-pink');
		expect(getFeatureColor('CSV export enabled')).toContain('text-indigo');
		expect(getFeatureColor('something else')).toContain('text-gray');
	});

	it('format helpers return stable types', () => {
		expect(typeof formatCurrency(1234, 'USD')).toBe('string');
		expect(formatTimestamp(null)).toBeNull();
		expect(formatTimestamp(0)).toBeNull();
		expect(typeof formatTimestamp(1)).toBe('string');
	});

	it('plans array contains canonical keys', () => {
		const keys = plans.map((p) => p.key);
		expect(keys).toContain('free');
		expect(keys).toContain('starter');
		expect(keys).toContain('growth');
		expect(keys).toContain('event');
	});
});

