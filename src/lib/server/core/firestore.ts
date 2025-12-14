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

// Pipelines subcollection under a campaign
export function pipelinesCollectionRef(uid: string, campaignId: string): CollectionReference {
	return campaignDocRef(uid, campaignId).collection('pipelines');
}

export function pipelineDocRef(uid: string, campaignId: string, pipelineId: string): DocumentReference {
	return pipelinesCollectionRef(uid, campaignId).doc(pipelineId);
}

// Per-pipeline profile references (lightweight edges to profiles)
export function pipelineProfileRefsCollectionRef(uid: string, campaignId: string, pipelineId: string): CollectionReference {
	return pipelineDocRef(uid, campaignId, pipelineId).collection('profile_refs');
}

// Aggregated profile index for a campaign
export function campaignProfilesCollectionRef(uid: string, campaignId: string): CollectionReference {
	return campaignDocRef(uid, campaignId).collection('profiles');
}

export function gmailConnectionsCollectionRef(uid: string): CollectionReference {
	return userDocRef(uid).collection('gmailConnections');
}

export function gmailConnectionDocRef(uid: string, connectionId: string): DocumentReference {
	return gmailConnectionsCollectionRef(uid).doc(connectionId);
}

// Daily usage tracking per Gmail inbox
export function gmailConnectionDailyUsageRef(
	uid: string,
	connectionId: string,
	dateKey: string
): DocumentReference {
	return gmailConnectionDocRef(uid, connectionId).collection('dailyUsage').doc(dateKey);
}

// Email queue collection for a user
export function emailQueueCollectionRef(uid: string): CollectionReference {
	return userDocRef(uid).collection('emailQueue');
}

export function emailQueueDocRef(uid: string, queueId: string): DocumentReference {
	return emailQueueCollectionRef(uid).doc(queueId);
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

// New unified contacts collection (multi-channel outreach state)
export function contactsCollectionRef(uid: string, campaignId: string): CollectionReference {
	return campaignDocRef(uid, campaignId).collection('contacts');
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
	onboarding?: {
		tutorialCompleted: boolean;
		tutorialCompletedAt?: number | null;
		tutorialSkipped?: boolean;
	};
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

// Pipeline run record for tracking multiple searches
export interface PipelineRunRecord {
	pipeline_id: string;
	started_at: number;
	completed_at?: number | null;
	status: 'running' | 'completed' | 'error';
	profiles_count?: number;
}

export interface PipelineDoc {
	user_id: string;
	campaign_id: string;
	pipeline_id: string;
	created_at: number;
	started_at?: number | null;
	completed_at?: number | null;
	status: 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
	params: {
		business_description: string;
		top_n: number;
		min_followers: number | null;
		max_followers: number | null;
		platforms?: string[];
		locations?: string[] | string | null;
		exclude_profile_urls?: number; // count only
	};
	counts?: {
		prelim_count?: number;
		dedup_count?: number;
		final_count?: number;
		contactable_count?: number;
	};
	storage?: {
		profiles_path?: string | null;
		prelim_path?: string | null;
		remaining_path?: string | null;
	};
	stage_meta?: Record<string, unknown>;
	metrics?: Record<string, unknown>;
	ingested?: boolean; // whether profiles were synced into campaign profile index
}

// Minimal campaign metadata - all detailed data is in subcollections
export interface CampaignRecord {
	id: string;
	title: string | null;
	status: 'collecting' | 'ready' | 'searching' | 'complete' | 'needs_config' | 'error';
	createdAt: number;
	updatedAt: number;
	pipeline_id?: string | null; // Current pipeline job ID
	pipeline_runs?: PipelineRunRecord[]; // History of pipeline runs for this campaign
	accumulated_profile_urls?: string[]; // Deprecated: use profiles collection
}

// Chat collected data structure
export type FieldStatus = 'not_collected' | 'collected' | 'confirmed';

export interface ChatCollectedData {
	website: string | null;
	business_name: string | null;
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
	influencerSearchResults: number;
	monthlyOutreachEmails: number;
	planKey: string | null;
	updatedAt: number;
}

/**
 * Daily usage tracking per Gmail inbox
 * Stored at: users/{uid}/gmailConnections/{connectionId}/dailyUsage/{YYYY-MM-DD}
 */
export interface DailyInboxUsage {
	date: string; // Format: "YYYY-MM-DD" (UTC)
	sendCount: number; // Emails sent today via this inbox
	lastSentAt: number | null; // Timestamp of last successful send
	resetAt: number; // Timestamp when this day's limit resets (next midnight UTC)
	updatedAt: number;
}

/**
 * Email queue status
 */
export type EmailQueueStatus = 'queued' | 'processing' | 'sent' | 'failed' | 'cancelled';

/**
 * Queued email document
 * Stored at: users/{uid}/emailQueue/{queueItemId}
 */
export interface QueuedEmail {
	id: string;
	// Campaign & recipient info
	campaignId: string | null;
	influencerId: string | null;
	influencerName: string | null;
	// Email content
	to: string; // Recipient email address
	subject: string;
	htmlBody: string; // Already-processed HTML (template vars filled)
	// Sender info
	senderConnectionId: string; // Gmail connection to use
	senderEmail: string; // Sender's email (for display)
	// Queue status
	status: EmailQueueStatus;
	priority: number; // Lower = higher priority (default: 100)
	// Timing
	createdAt: number;
	scheduledFor: number; // When eligible to send (daily reset time)
	processedAt: number | null; // When processing started
	sentAt: number | null; // When successfully sent
	// Error handling
	attempts: number; // Number of send attempts
	maxAttempts: number; // Max retry attempts (default: 3)
	lastError: string | null;
	lastAttemptAt: number | null;
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

export interface ContactChannelStatus {
	status: OutreachSendStatus;
	sentAt?: number | null;
	repliedAt?: number | null;
	openedAt?: number | null;
	errorMessage?: string | null;
}

export interface ContactDoc {
	profile_id: string;
	pipeline_id?: string | null;
	platform: OutreachPlatform;
	destination: string;
	message: string;
	sendStatus: OutreachSendStatus;
	channels: Record<string, ContactChannelStatus>; // keyed by platform or method, e.g., email/instagram/tiktok
	template_id?: string | null;
	senderConnectionId?: string | null;
	draftId?: string | null;
	createdAt: number;
	updatedAt: number;
	sentAt?: number | null;
	repliedAt?: number | null;
	openedAt?: number | null;
}

export interface CampaignProfileDoc {
	profile_url: string | null;
	platform: string | null;
	display_name: string | null;
	followers: number | null;
	bio?: string | null;
	email_address?: string | null;
	business_email?: string | null;
	first_seen_at: number;
	last_seen_at: number;
	first_pipeline_id: string | null;
	last_pipeline_id: string | null;
	times_seen: number;
	best_fit_score?: number | null;
	contactable: boolean;
	suppressed?: boolean;
}
