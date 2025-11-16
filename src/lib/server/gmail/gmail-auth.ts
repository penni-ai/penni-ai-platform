import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';
import { firestore, gmailConnectionsCollectionRef, serverTimestamp } from '../core';
import { env } from '$env/dynamic/private';
import { createLogger } from '$lib/server/core';

function getGmailConfig() {
	const clientId = env.GMAIL_OAUTH_CLIENT_ID;
	const clientSecret = env.GMAIL_OAUTH_CLIENT_SECRET;
	const redirectUri = env.GMAIL_OAUTH_REDIRECT_URI;
	const encryptionKeyB64 = env.GMAIL_TOKEN_ENCRYPTION_KEY;

	if (!clientId || !clientSecret || !redirectUri) {
		throw new Error(
			'Missing Gmail OAuth configuration. Please set GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, and GMAIL_OAUTH_REDIRECT_URI environment variables.'
		);
	}

	if (!encryptionKeyB64) {
		throw new Error('Missing Gmail token encryption key. Set GMAIL_TOKEN_ENCRYPTION_KEY to a base64-encoded 32-byte key.');
	}

	const encryptionKey = Buffer.from(encryptionKeyB64, 'base64');
	if (encryptionKey.length !== 32) {
		throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
	}

	return { clientId, clientSecret, redirectUri, encryptionKey };
}

const gmailLogger = createLogger({ component: 'gmail_oauth' });

export type GmailAccountType = 'draft' | 'send';

interface GmailConnectionDoc {
	access_token: string;
	expires_at: number;
	email: string;
	connected_at: number;
	last_refreshed_at?: number;
	primary?: boolean;
	accountType?: GmailAccountType; // 'draft' for compose only, 'send' for send + compose
	refresh_token_encrypted?: string;
	refresh_token_iv?: string;
	refresh_token_tag?: string;
	refresh_token?: string; // Legacy plaintext storage
}

export interface GmailTokens {
	access_token: string;
	refresh_token: string;
	expiry_date: number;
	token_type: string;
	scope: string;
}

export interface GmailConnection {
	id: string;
	email: string;
	access_token: string;
	refresh_token: string;
	expires_at: number;
	connected_at: number;
	last_refreshed_at?: number | null;
	primary: boolean;
	accountType?: GmailAccountType;
}

export interface GmailConnectionPublic {
	id: string;
	email: string;
	connected_at: number;
	last_refreshed_at?: number | null;
	expires_at: number;
	primary: boolean;
	accountType?: GmailAccountType;
}

function encryptSecret(value: string) {
	const { encryptionKey } = getGmailConfig();
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
	const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return {
		ciphertext: encrypted.toString('base64'),
		iv: iv.toString('base64'),
		tag: authTag.toString('base64')
	};
}

function decryptSecret(ciphertext: string, iv: string, tag: string): string {
	const { encryptionKey } = getGmailConfig();
	const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64'));
	decipher.setAuthTag(Buffer.from(tag, 'base64'));
	const decrypted = Buffer.concat([
		decipher.update(Buffer.from(ciphertext, 'base64')),
		decipher.final()
	]);
	return decrypted.toString('utf8');
}

function extractRefreshToken(data: GmailConnectionDoc): string {
	if (data.refresh_token) {
		return data.refresh_token;
	}
	if (data.refresh_token_encrypted && data.refresh_token_iv && data.refresh_token_tag) {
		return decryptSecret(data.refresh_token_encrypted, data.refresh_token_iv, data.refresh_token_tag);
	}
	throw new Error('Stored Gmail refresh token is missing. Please reconnect this Gmail account.');
}

function deriveConnectionId(email: string): string {
	const base = email.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'gmail';
	return base.slice(0, 40);
}

async function resolveConnectionId(uid: string, email: string, preferred?: string | null): Promise<string> {
	if (preferred) return preferred;
	const base = deriveConnectionId(email);
	let candidate = base;
	let suffix = 1;
	while (true) {
		const doc = await gmailConnectionsCollectionRef(uid).doc(candidate).get();
		if (!doc.exists) return candidate;
		candidate = `${base}-${suffix++}`;
	}
}

async function hasAnyConnection(uid: string): Promise<boolean> {
	const snapshot = await gmailConnectionsCollectionRef(uid).limit(1).get();
	return !snapshot.empty;
}

async function hasPrimaryConnection(uid: string): Promise<boolean> {
	const snapshot = await gmailConnectionsCollectionRef(uid).where('primary', '==', true).limit(1).get();
	return !snapshot.empty;
}

async function setPrimaryFlag(uid: string, connectionId: string): Promise<void> {
	await firestore.runTransaction(async (tx) => {
		const colRef = gmailConnectionsCollectionRef(uid);
		const snapshot = await tx.get(colRef);
		snapshot.forEach((doc) => {
			const primary = doc.id === connectionId;
			tx.update(doc.ref, { primary });
		});
	});
	gmailLogger.info('gmail_primary_set', { uid, connectionId });
}

async function ensurePrimaryAfterDisconnect(uid: string): Promise<void> {
	const snapshot = await gmailConnectionsCollectionRef(uid).orderBy('connected_at').get();
	const docs = snapshot.docs;
	if (docs.length === 0) {
		return;
	}
	const existingPrimary = docs.find((doc) => doc.data().primary);
	if (existingPrimary) {
		return;
	}
	await setPrimaryFlag(uid, docs[0].id);
}

async function listConnectionDocs(uid: string): Promise<GmailConnection[]> {
	const snapshot = await gmailConnectionsCollectionRef(uid).orderBy('connected_at').get();
	return snapshot.docs.map((doc) => {
		const data = doc.data() as GmailConnectionDoc;
		return {
			id: doc.id,
			email: data.email,
			access_token: data.access_token,
			refresh_token: extractRefreshToken(data),
			expires_at: data.expires_at,
			connected_at: data.connected_at,
			last_refreshed_at: data.last_refreshed_at ?? data.connected_at ?? null,
			primary: Boolean(data.primary),
			accountType: data.accountType || 'send' // Default to 'send' for backward compatibility
		};
	});
}

function toPublic(conn: GmailConnection): GmailConnectionPublic {
	return {
		id: conn.id,
		email: conn.email,
		connected_at: conn.connected_at,
		last_refreshed_at: conn.last_refreshed_at ?? null,
		expires_at: conn.expires_at,
		primary: conn.primary,
		accountType: conn.accountType || 'send' // Default to 'send' for backward compatibility
	};
}

export async function listGmailConnections(uid: string): Promise<GmailConnectionPublic[]> {
	const connections = await listConnectionDocs(uid);
	return connections.map(toPublic);
}

async function findConnection(uid: string, connectionId?: string | null): Promise<GmailConnection | null> {
	const connections = await listConnectionDocs(uid);
	if (connections.length === 0) return null;
	if (connectionId) {
		return connections.find((c) => c.id === connectionId) ?? null;
	}
	return connections.find((c) => c.primary) ?? connections[0];
}

async function deleteConnectionDoc(uid: string, connectionId: string): Promise<void> {
	await gmailConnectionsCollectionRef(uid).doc(connectionId).delete();
}

export function createOAuth2Client(): OAuth2Client {
	const { clientId, clientSecret, redirectUri } = getGmailConfig();
	return new OAuth2Client(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(state?: string, accountType: GmailAccountType = 'send'): string {
	const oauth2Client = createOAuth2Client();
	const scopes = [
		'https://www.googleapis.com/auth/gmail.compose', // Required for creating drafts
		...(accountType === 'send' ? ['https://www.googleapis.com/auth/gmail.send'] : []), // Only for send accounts
		'https://www.googleapis.com/auth/userinfo.email'
	];

	return oauth2Client.generateAuthUrl({
		access_type: 'offline',
		scope: scopes,
		prompt: 'consent',
		state: state || undefined
	});
}

export async function exchangeCodeForTokens(code: string): Promise<GmailTokens> {
	const oauth2Client = createOAuth2Client();
	const { tokens } = await oauth2Client.getToken(code);

	if (!tokens.access_token) {
		throw new Error('Google did not provide an access token. Please try again.');
	}

	if (!tokens.refresh_token) {
		throw new Error(
			'Google did not grant offline access. Remove Penny from https://myaccount.google.com/permissions and reconnect, ensuring you allow access.'
		);
	}

	return {
		access_token: tokens.access_token,
		refresh_token: tokens.refresh_token,
		expiry_date: tokens.expiry_date || Date.now() + 3600000,
		token_type: tokens.token_type || 'Bearer',
		scope: tokens.scope || ''
	};
}

export async function getUserEmail(accessToken: string): Promise<string> {
	const oauth2Client = createOAuth2Client();
	oauth2Client.setCredentials({ access_token: accessToken });

	const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
		headers: {
			Authorization: `Bearer ${accessToken}`
		}
	});

	if (!userInfoResponse.ok) {
		throw new Error('Failed to fetch user email from Google');
	}

	const userInfo = await userInfoResponse.json();
	return userInfo.email;
}

export async function storeGmailTokens(
	uid: string,
	tokens: GmailTokens,
	options?: { connectionId?: string | null; makePrimary?: boolean; accountType?: GmailAccountType }
): Promise<GmailConnectionPublic> {
	const email = await getUserEmail(tokens.access_token);
	const expiresAt = tokens.expiry_date;
	const now = Date.now();
	const encryptedRefresh = encryptSecret(tokens.refresh_token);
	const hasConnections = await hasAnyConnection(uid);
	const connectionId = await resolveConnectionId(uid, email, options?.connectionId ?? null);

	await gmailConnectionsCollectionRef(uid)
		.doc(connectionId)
		.set(
			{
				email,
				access_token: tokens.access_token,
				expires_at: expiresAt,
				connected_at: now,
				last_refreshed_at: now,
				accountType: options?.accountType || 'send', // Default to 'send' for backward compatibility
				refresh_token_encrypted: encryptedRefresh.ciphertext,
				refresh_token_iv: encryptedRefresh.iv,
				refresh_token_tag: encryptedRefresh.tag,
				refresh_token: FieldValue.delete(),
				primary: FieldValue.delete()
			},
			{ merge: true }
		);

	const shouldBePrimary = options?.makePrimary === true || !hasConnections;
	if (shouldBePrimary) {
		await setPrimaryFlag(uid, connectionId);
	}

	gmailLogger.info('gmail_connected', { uid, email, connectionId });

	const connection = await findConnection(uid, connectionId);
	if (!connection) {
		throw new Error('Failed to load Gmail connection after storing tokens.');
	}
	return toPublic(connection);
}

function isInvalidGrant(error: unknown): boolean {
	const maybe = error as { response?: { data?: { error?: string } } };
	return maybe?.response?.data?.error === 'invalid_grant';
}

export async function getGmailConnection(uid: string, connectionId?: string | null): Promise<GmailConnection> {
	const connection = await findConnection(uid, connectionId ?? null);
	if (!connection) {
		throw new Error('No Gmail connection found');
	}
	return connection;
}

export async function getValidGmailTokens(uid: string, connectionId?: string | null): Promise<GmailConnection> {
	const connection = await getGmailConnection(uid, connectionId ?? null);
	const now = Date.now();
	const buffer = 5 * 60 * 1000;
	if (now >= connection.expires_at - buffer) {
		return await refreshGmailToken(uid, connection.id);
	}
	return connection;
}

export async function refreshGmailToken(uid: string, connectionId: string): Promise<GmailConnection> {
	const connection = await getGmailConnection(uid, connectionId);
	const oauth2Client = createOAuth2Client();
	oauth2Client.setCredentials({ refresh_token: connection.refresh_token });

	try {
		const { credentials } = await oauth2Client.refreshAccessToken();
		if (!credentials.access_token || !credentials.expiry_date) {
			throw new Error('Failed to refresh access token');
		}

		const refreshedToken = credentials.refresh_token ?? connection.refresh_token;
		const encryptedRefresh = encryptSecret(refreshedToken);
		const now = Date.now();

		await gmailConnectionsCollectionRef(uid)
			.doc(connectionId)
			.set(
				{
					access_token: credentials.access_token,
					expires_at: credentials.expiry_date,
					last_refreshed_at: now,
					refresh_token_encrypted: encryptedRefresh.ciphertext,
					refresh_token_iv: encryptedRefresh.iv,
					refresh_token_tag: encryptedRefresh.tag,
					refresh_token: FieldValue.delete()
				},
				{ merge: true }
			);

		gmailLogger.debug('gmail_token_refreshed', { uid, connectionId });

		return {
			...connection,
			access_token: credentials.access_token,
			expires_at: credentials.expiry_date,
			refresh_token: refreshedToken,
			last_refreshed_at: now
		};
	} catch (error) {
		if (isInvalidGrant(error)) {
			await deleteConnectionDoc(uid, connectionId);
			await ensurePrimaryAfterDisconnect(uid);
			gmailLogger.warn('gmail_refresh_invalid_grant', { uid, connectionId });
			throw new Error('Gmail permission was revoked. Please reconnect this Gmail account.');
		}
		throw error instanceof Error ? error : new Error('Failed to refresh Gmail access token');
	}
}

export async function setPrimaryGmailConnection(uid: string, connectionId: string): Promise<void> {
	await setPrimaryFlag(uid, connectionId);
}

export async function revokeGmailTokens(uid: string, connectionId: string): Promise<void> {
	const connection = await findConnection(uid, connectionId);
	if (!connection) {
		return;
	}

	try {
		const oauth2Client = createOAuth2Client();
		await oauth2Client.revokeToken(connection.access_token);
	} catch (error) {
		console.error('Failed to revoke Gmail tokens:', error);
	}

	await deleteConnectionDoc(uid, connectionId);
	await ensurePrimaryAfterDisconnect(uid);
	gmailLogger.info('gmail_disconnected', { uid, connectionId });
}
