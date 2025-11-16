/**
 * Utility functions for campaign-related functionality
 */

import type { Influencer, InfluencerProfile, FollowerRange, CollectedData } from '$lib/types/campaign';

/**
 * Simple hash function for creating unique keys
 */
export function simpleHash(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash; // Convert to 32-bit integer
	}
	return Math.abs(hash).toString(36);
}

/**
 * Generate a unique ID for a profile based on its properties
 */
export function getProfileId(profile: Influencer | InfluencerProfile): string {
	// Use existing _id if available
	if (profile._id) {
		return profile._id;
	}
	// Use profile_url if available, otherwise create a composite key
	if (profile.profile_url) {
		return profile.profile_url;
	}
	// Include email in key to ensure uniqueness
	const email = profile.email_address || profile.business_email || '';
	const baseKey = `${profile.platform ?? 'unknown'}_${profile.display_name ?? 'unknown'}_${profile.followers ?? 0}_${email}`;
	
	// If we still might have duplicates (no email), create a hash of the entire profile
	// to ensure uniqueness
	if (!email) {
		const profileStr = JSON.stringify(profile);
		return `${baseKey}_${simpleHash(profileStr)}`;
	}
	
	return baseKey;
}

/**
 * Format follower range for display
 */
export function formatFollowerRange(range: FollowerRange | null | undefined): string {
	if (!range) return '—';
	const { min, max } = range;
	const numberFormatter = new Intl.NumberFormat('en-US');
	const formatValue = (value: number) => numberFormatter.format(Math.round(value));
	if (typeof min === 'number' && typeof max === 'number') {
		return `${formatValue(min)} – ${formatValue(max)}`;
	}
	if (typeof min === 'number') {
		return `${formatValue(min)}+`;
	}
	if (typeof max === 'number') {
		return `Up to ${formatValue(max)}`;
	}
	return '—';
}

/**
 * Get platform logo SVG string
 */
export function getPlatformLogo(platform: string | null | undefined): string {
	if (!platform) return '';
	const platformLower = platform.toLowerCase();
	if (platformLower === 'instagram') {
		return `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>`;
	}
	if (platformLower === 'tiktok') {
		return `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/></svg>`;
	}
	return '';
}

/**
 * Get platform color class
 */
export function getPlatformColor(platform: string | null | undefined): string {
	if (!platform) return 'text-gray-400';
	const platformLower = platform.toLowerCase();
	if (platformLower === 'instagram') {
		return 'text-[#E4405F]';
	}
	if (platformLower === 'tiktok') {
		return 'text-black';
	}
	return 'text-gray-500';
}

/**
 * Calculate progress based on collected campaign data
 * Required fields: website, business_location, influencer_location, min_followers, max_followers, platform, type_of_influencer
 * Note: business_about is optional (implied field)
 */
export function calculateProgress(collected: CollectedData, followerRange: FollowerRange): number {
	const requiredFields = ['website', 'business_location', 'influencer_location', 'platform', 'type_of_influencer', 'followers'];
	let collectedCount = 0;
	
	// Check website - collected if not null (including "N/A")
	if (collected.website !== null && collected.website !== undefined) collectedCount++;
	
	// Check business_location - collected if not null (including "N/A")
	if (collected.business_location !== null && collected.business_location !== undefined) collectedCount++;
	
	// Check influencer_location - collected if not null
	if (collected.locations !== null && collected.locations !== undefined) collectedCount++;
	
	// Check platform - collected if not null
	if (collected.platform !== null && collected.platform !== undefined) collectedCount++;
	
	// Check type_of_influencer - collected if not null
	if (collected.type_of_influencer !== null && collected.type_of_influencer !== undefined) collectedCount++;
	
	// Check followers - both min and max must be collected
	if (followerRange.min !== null && followerRange.max !== null) collectedCount++;
	
	return Math.round((collectedCount / requiredFields.length) * 100);
}

