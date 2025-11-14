import { adminDb } from '$lib/firebase/admin';
import {
	FieldValue,
	type Firestore,
	type DocumentReference,
	type CollectionReference
} from 'firebase-admin/firestore';

export const firestore: Firestore = adminDb;

export function userDocRef(uid: string) {
	return firestore.collection('users').doc(uid);
}

export function subscriptionDocRef(uid: string, subscriptionId: string) {
	return userDocRef(uid).collection('subscriptions').doc(subscriptionId);
}

export function addonDocRef(uid: string, addonId: string) {
	return userDocRef(uid).collection('addons').doc(addonId);
}

export function checkoutSessionDocRef(sessionId: string) {
	return firestore.collection('checkoutSessions').doc(sessionId);
}

export function webhookEventDocRef(eventId: string) {
	return firestore.collection('webhookEvents').doc(eventId);
}

export function stripeCustomerDocRef(customerId: string) {
	return firestore.collection('stripeCustomers').doc(customerId);
}

export function siteDocRef(uid: string, hostname: string) {
	return userDocRef(uid).collection('sites').doc(hostname);
}

export function campaignDocRef(uid: string, campaignId: string) {
	return userDocRef(uid).collection('campaigns').doc(campaignId);
}

export function gmailConnectionsCollectionRef(uid: string): CollectionReference {
	return userDocRef(uid).collection('gmailConnections');
}

// Campaign structure:
// - campaigns/{campaignId}/collected (document) - collected data
// - campaigns/{campaignId}/chat/{messageId} (collection) - messages
export function chatCollectedDocRef(uid: string, campaignId: string): DocumentReference {
	return campaignDocRef(uid, campaignId).collection('collected').doc('data');
}

export function chatMessagesCollectionRef(uid: string, campaignId: string): CollectionReference {
	// Messages collection: campaigns/{campaignId}/chat/{messageId}
	return campaignDocRef(uid, campaignId).collection('chat');
}

// New organized structure: Outreach collection
export function outreachCollectionRef(uid: string, campaignId: string): CollectionReference {
	return campaignDocRef(uid, campaignId).collection('outreach');
}

// New organized structure: Search collection
export function searchCollectionRef(uid: string, campaignId: string): CollectionReference {
	return campaignDocRef(uid, campaignId).collection('search');
}

export function searchUsageDocRef(uid: string): DocumentReference {
	return userDocRef(uid).collection('usage').doc('searches');
}

export const serverTimestamp = () => FieldValue.serverTimestamp();

export interface SubscriptionSnapshot {
	stripeSubscriptionId: string;
	planKey: string | null;
	priceId: string;
	productId: string;
	status: string;
	stripeCustomerId: string;
	currentPeriodStart: number | null;
	currentPeriodEnd: number | null;
	trialStart: number | null;
	trialEnd: number | null;
	cancelAtPeriodEnd: boolean;
	cancelAt: number | null;
	canceledAt: number | null;
	latestInvoiceId: string | null;
	defaultPaymentMethodId: string | null;
	items: Array<{
		id: string;
		priceId: string;
		productId: string;
		quantity: number | null;
		planNickname: string | null;
	}>;
	updatedAt: number;
	source?: string;
	invoiceStatus?: string;
	amountDue?: number;
	amountPaid?: number;
	hostedInvoiceUrl?: string | null;
	trialEndingSoon?: boolean;
}

export interface UserStripeState {
	stripeCustomerId: string;
	email: string | null;
	currentPlan?: {
		planKey: string | null;
		priceId: string;
		status: string;
		currentPeriodEnd: number | null;
		trialEnd: number | null;
		cancelAtPeriodEnd: boolean;
	};
	entitlements?: Record<string, boolean>;
	addons?: Record<string, unknown>;
	updatedAt: number;
}

export interface AddonRecord {
	addonId: string;
	priceId: string;
	productId: string;
	status: 'purchased' | 'fulfilled';
	stripeCustomerId: string;
	paymentIntentId: string | null;
	invoiceId: string | null;
	purchasedAt: number;
	expiresAt: number | null;
}

// Minimal campaign metadata - all detailed data is in subcollections
export interface CampaignRecord {
	id: string;
	title: string | null;
	status: 'collecting' | 'ready' | 'searching' | 'complete' | 'needs_config' | 'error';
	createdAt: number;
	updatedAt: number;
	pipeline_id?: string | null; // Pipeline job ID for influencer searches
}

// Chat collected data structure
export type FieldStatus = 'not_collected' | 'collected' | 'confirmed';

export interface ChatCollectedData {
	website: string | null;
	business_location: string | null;
	keywords: string[];
	min_followers: number | null;
	max_followers: number | null;
	influencer_location: string | null;
	influencerTypes: string | null; // Legacy field name, maps to influencer_location
	business_about: string | null;
	influencer_search_query: string | null; // 1-2 sentence description of business and desired influencers (no follower counts)
	fieldStatus?: {
		// Only explicit fields that require user confirmation have status tracking
		website?: FieldStatus;
		business_location?: FieldStatus;
		business_about?: FieldStatus;
		influencer_location?: FieldStatus;
		min_followers?: FieldStatus;
		max_followers?: FieldStatus;
	};
	updatedAt: number;
}

export interface SearchUsageRecord {
	month: string; // Format: "YYYY-MM" (e.g., "2025-01")
	count: number;
	updatedAt: number;
	}

export function outreachUsageDocRef(uid: string): DocumentReference {
	return userDocRef(uid).collection('usage').doc('outreach');
}

export interface OutreachUsageRecord {
	month: string; // Format: "YYYY-MM" (e.g., "2025-01")
	count: number;
	updatedAt: number;
}
