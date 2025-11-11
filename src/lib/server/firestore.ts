import { adminDb } from '$lib/firebase/admin';
import {
	FieldValue,
	type Firestore,
	type DocumentReference,
	type CollectionReference,
	type DocumentSnapshot
} from 'firebase-admin/firestore';
import {
	PIPELINE_RUN_STATUSES,
	PIPELINE_STAGE_STATUSES,
	STAGE_NAMES,
	isPipelineStageDocument,
	isPipelineStatus
} from '$lib/types/search';
import type { PipelineStageDocument, PipelineStatus, StageName } from '$lib/types/search';

export const firestore: Firestore = adminDb;
const PIPELINE_COLLECTION = 'search_pipeline_runs';

const pipelineRunsCollection = () => firestore.collection(PIPELINE_COLLECTION);

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

export function pipelineStatusDocRef(pipelineId: string): DocumentReference {
	return pipelineRunsCollection().doc(pipelineId);
}

function pipelineStageDocRef(pipelineId: string, stage: StageName): DocumentReference {
	return pipelineRunsCollection().doc(stageDocumentId(pipelineId, stage));
}

const stageDocumentId = (pipelineId: string, stage: StageName) => `${pipelineId}_${stage}`;

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
	influencerTypes?: string | null;
	locations?: string | null;
	followers?: string | null;
	followersMin?: number | null;
	followersMax?: number | null;
	keywords?: string[];
	businessSummary?: string | null;
	sourceConversationId: string;
}

export async function* watchPipelineStatus(
	pipelineId: string,
	signal?: AbortSignal
): AsyncGenerator<PipelineStatus> {
	const docRef = pipelineStatusDocRef(pipelineId);
	const queue: PipelineStatus[] = [];
	const abortError = new Error('Pipeline status watch aborted');
	abortError.name = 'AbortError';
	let pendingResolve: ((value: PipelineStatus) => void) | null = null;
	let pendingReject: ((reason?: unknown) => void) | null = null;
	let closed = false;
	let terminalError: unknown = null;

	const emit = (status: PipelineStatus) => {
		if (pendingResolve) {
			pendingResolve(status);
			pendingResolve = null;
			pendingReject = null;
		} else {
			queue.push(status);
		}
	};

	const fail = (error: unknown) => {
		terminalError = error;
		closed = true;
		if (pendingReject) {
			pendingReject(error);
			pendingResolve = null;
			pendingReject = null;
		}
	};

	const shift = (): Promise<PipelineStatus> => {
		if (queue.length) {
			return Promise.resolve(queue.shift()!);
		}
		if (closed) {
			return Promise.reject(terminalError ?? abortError);
		}
		return new Promise<PipelineStatus>((resolve, reject) => {
			pendingResolve = resolve;
			pendingReject = reject;
		});
	};

	const unsubscribe = docRef.onSnapshot(
		(snapshot) => {
			const status = coercePipelineStatus(snapshot, pipelineId);
			if (status) {
				emit(status);
			}
		},
		(error) => {
			fail(error);
		}
	);

	const abortListener = () => {
		fail(abortError);
		unsubscribe();
	};

	if (signal) {
		if (signal.aborted) {
			abortListener();
		} else {
			signal.addEventListener('abort', abortListener, { once: true });
		}
	}

	try {
		while (true) {
			const next = await shift();
			yield next;
		}
	} catch (error) {
		if (error !== abortError) {
			throw error;
		}
	} finally {
		closed = true;
		unsubscribe();
		if (signal) {
			signal.removeEventListener('abort', abortListener);
		}
	}
}

export async function readPipelineStageResults(
	pipelineId: string,
	stage: StageName
): Promise<PipelineStageDocument | null> {
	const snapshot = await pipelineStageDocRef(pipelineId, stage).get();
	return coercePipelineStageDocument(snapshot, pipelineId, stage);
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);

const normalizeStageName = (value: unknown): StageName | null => {
	if (typeof value !== 'string') {
		return null;
	}
	const upper = value.toUpperCase();
	return STAGE_NAMES.includes(upper as StageName) ? (upper as StageName) : null;
};

const normalizeStatus = <T extends readonly string[]>(
	value: unknown,
	allowed: T,
	fallback: T[number]
): T[number] => {
	if (typeof value === 'string') {
		const normalized = value.toLowerCase();
		const match = allowed.find((candidate) => candidate === normalized);
		if (match) {
			return match as T[number];
		}
	}
	return fallback;
};

const coercePipelineStatus = (
	snapshot: DocumentSnapshot,
	pipelineId: string
): PipelineStatus | null => {
	if (!snapshot.exists) {
		return null;
	}
	const raw = (snapshot.data() ?? {}) as Record<string, unknown>;
	const currentStage = normalizeStageName(raw.current_stage) ?? null;
	const completedRaw = Array.isArray(raw.completed_stages) ? raw.completed_stages : [];
	const completedStages = completedRaw
		.map((stage) => normalizeStageName(stage))
		.filter((stage): stage is StageName => Boolean(stage));
	const normalized: Record<string, unknown> = {
		...raw,
		pipeline_id:
			typeof raw.pipeline_id === 'string' && raw.pipeline_id ? raw.pipeline_id : pipelineId,
		userId: typeof raw.userId === 'string' ? raw.userId : '',
		status: normalizeStatus(raw.status, PIPELINE_RUN_STATUSES, 'running'),
		current_stage: currentStage,
		completed_stages: completedStages,
		overall_progress: typeof raw.overall_progress === 'number' ? raw.overall_progress : 0,
		error_message:
			raw.error_message === undefined || raw.error_message === null
				? null
				: String(raw.error_message)
	};
	return isPipelineStatus(normalized) ? (normalized as PipelineStatus) : null;
};

const coercePipelineStageDocument = (
	snapshot: DocumentSnapshot,
	pipelineId: string,
	fallbackStage: StageName
): PipelineStageDocument | null => {
	if (!snapshot.exists) {
		return null;
	}
	const raw = (snapshot.data() ?? {}) as Record<string, unknown>;
	const stage = normalizeStageName(raw.stage) ?? fallbackStage;
	const profiles = Array.isArray(raw.profiles) ? raw.profiles.filter(isPlainRecord) : [];
	const normalized: Record<string, unknown> = {
		...raw,
		pipeline_id: typeof raw.pipeline_id === 'string' ? raw.pipeline_id : pipelineId,
		userId: typeof raw.userId === 'string' ? raw.userId : '',
		stage,
		status: normalizeStatus(raw.status, PIPELINE_STAGE_STATUSES, 'completed'),
		profiles,
		debug: isPlainRecord(raw.debug) ? raw.debug : {},
		metadata: isPlainRecord(raw.metadata) ? raw.metadata : {},
		error_message:
			raw.error_message === undefined || raw.error_message === null
				? null
				: String(raw.error_message)
	};
	return isPipelineStageDocument(normalized) ? (normalized as PipelineStageDocument) : null;
};
