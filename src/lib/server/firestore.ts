import { adminDb } from '$lib/firebase/admin';
import { FieldValue, type Firestore, type DocumentReference, type CollectionReference } from 'firebase-admin/firestore';

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

export function conversationCollectionRef(uid: string): CollectionReference {
	return userDocRef(uid).collection('conversations');
}

export function conversationDocRef(uid: string, conversationId: string): DocumentReference {
	return conversationCollectionRef(uid).doc(conversationId);
}

export function conversationMessagesCollectionRef(uid: string, conversationId: string): CollectionReference {
	return conversationDocRef(uid, conversationId).collection('messages');
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

export interface CampaignRecord {
	id: string;
	createdAt: number;
	website?: string | null;
	audience?: string | null;
	locations?: string | null;
	followers?: string | null;
	businessSummary?: string | null;
	sourceConversationId: string;
}
