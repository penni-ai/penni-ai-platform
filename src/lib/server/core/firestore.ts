import { adminDb } from '$lib/firebase/admin';
import {
	FieldValue,
	type Firestore,
	type DocumentReference,
	type CollectionReference
} from 'firebase-admin/firestore';

export const firestore: Firestore = adminDb;

// Log Firestore configuration on module load (once)
let firestoreConfigLogged = false;
if (!firestoreConfigLogged) {
	firestoreConfigLogged = true;
	const firestoreProjectId = (adminDb as any).app?.options?.projectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'unknown';
	const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST || 'none';
	console.info('[Firestore] Initialized Firestore client', {
		projectId: firestoreProjectId,
		emulatorHost: firestoreEmulatorHost,
		isEmulator: firestoreEmulatorHost !== 'none'
	});
}

export function userDocRef(uid: string) {
	return firestore.collection('users').doc(uid);
}

export function subscriptionDocRef(uid: string, subscriptionId: string) {
	return userDocRef(uid).collection('subscriptions').doc(subscriptionId);
}

export function outreachStateDocRef(uid: string, campaignId: string) {
	return userDocRef(uid).collection('campaigns').doc(campaignId).collection('outreach_state').doc('current');
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

// Outreach contacts collection - stores contact objects for outgoing outreach
export function outreachContactsCollectionRef(uid: string, campaignId: string): CollectionReference {
	return campaignDocRef(uid, campaignId).collection('outreach_contacts');
}

// Removed: searchUsageDocRef and outreachUsageDocRef
// Usage is now stored in user document as a field, not a subcollection

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
		priceId?: string;
		status: string;
		currentPeriodEnd?: number | null;
		trialEnd?: number | null;
		cancelAtPeriodEnd?: boolean;
		refreshDate: number; // First day of next month - when monthly limits reset
		// Note: Feature limits/flags are in feature_capabilities, not here
	};
	usage?: UserUsage; // Usage tracking (outreach and search)
	// Removed: entitlements field (redundant, use feature_capabilities instead)
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
	business_name: string | null;
	business_location: string | null;
	platform: string | null;
	type_of_influencer: string | null;
	min_followers: number | null;
	max_followers: number | null;
	influencer_location: string | null;
	business_about: string | null;
	fieldStatus?: {
		// Only explicit fields that require user confirmation have status tracking
		website?: FieldStatus;
		business_name?: FieldStatus;
		business_location?: FieldStatus;
		business_about?: FieldStatus;
		influencer_location?: FieldStatus;
		min_followers?: FieldStatus;
		max_followers?: FieldStatus;
	};
	updatedAt: number;
}

/**
 * Usage tracking stored in user document
 * Replaces the old subcollection structure
 */
export interface UsageRecord {
	month: string; // Format: "YYYY-MM" (e.g., "2025-01")
	count: number;
	updatedAt: number;
	}

export interface UserUsage {
	outreachSent: UsageRecord; // Number of outreach messages sent
	influencersFound: UsageRecord; // Number of influencers found via search
}

/**
 * Feature capabilities stored in user document
 * See buildFeatureCapabilities() in billing-utils.ts for structure
 */
export interface UserFeatureCapabilities {
	outreach: boolean;
	search: boolean;
	csvExport: boolean;
	connectedInboxes: number;
	maxActiveCampaigns: number;
	influencerSearchResults: number;
	monthlyOutreachEmails: number;
	planKey: string | null;
	updatedAt: number;
}

/**
 * Platform types for outreach contacts
 */
export type OutreachPlatform = 'email' | 'instagram' | 'tiktok';

/**
 * User email settings for customizing outreach emails
 */
export interface UserEmailSettings {
	footer?: {
		enabled: boolean;
		html?: string;
		text?: string;
	};
	branding?: {
		logoUrl?: string;
		logoAlt?: string;
		companyName?: string;
		website?: string;
		socialLinks?: {
			instagram?: string;
			twitter?: string;
			linkedin?: string;
		};
	};
	directSend?: boolean; // If true, send emails directly instead of creating drafts
	updatedAt: number;
}

/**
 * Send status for outreach contacts
 */
export type OutreachSendStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

/**
 * Outreach panel state persisted in Firestore
 */
export interface OutreachState {
	campaignId: string;
	currentStage: 'select-methods' | 'draft-messages' | 'review';
	editingPlatform: 'email' | 'instagram' | 'tiktok' | null;
	selectedInfluencerIds: string[]; // IDs of selected influencers for outreach
	selectedMethods: Record<string, string[]>; // influencerKey -> ContactMethod[]
	messageContents: {
		email: string;
		instagram: string;
		tiktok: string;
	};
	selectedGmailConnectionId: string | null;
	updatedAt: number;
	createdAt: number;
	version: number; // For future migrations
}

/**
 * Outreach contact object stored in campaigns/{campaignId}/outreach_contacts/{contactId}
 * Contains information for outgoing outreach from a campaign
 */
export interface OutreachContact {
	platform: OutreachPlatform; // Platform type: email, instagram, or tiktok
	destination: string; // Email address if platform is 'email', username if platform is 'instagram' or 'tiktok'
	message: string; // The personalized outreach message content (with variables filled in)
	template?: string | null; // Optional: Original template with variables (for future editing/personalization)
	sendStatus: OutreachSendStatus; // Current send status
	createdAt: number; // Timestamp when contact was created
	updatedAt: number; // Timestamp when contact was last updated
	sentAt?: number | null; // Timestamp when message was successfully sent (if sent)
	failedAt?: number | null; // Timestamp when message failed (if failed)
	errorMessage?: string | null; // Error message if send failed
	// Optional metadata
	influencerId?: string | null; // Reference to influencer profile if available
	influencerName?: string | null; // Display name of influencer
	senderConnectionId?: string | null; // Gmail connection ID used to send this message
	draftId?: string | null; // Gmail draft ID if created as draft
	contactMethods?: string[]; // Array of contact methods used (e.g., ['email', 'instagram']) - for tracking which methods were used per influencer
}
