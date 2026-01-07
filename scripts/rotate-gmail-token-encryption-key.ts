import crypto from 'crypto';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';

import { adminDb } from '../src/lib/firebase/admin';

type Args = {
	dryRun: boolean;
	uid: string | null;
	batchSize: number;
	maxDocs: number | null;
};

function parseArgs(argv: string[]): Args {
	const args = argv.slice(2);
	const dryRun = args.includes('--dry-run');

	const getValue = (flag: string): string | null => {
		const idx = args.indexOf(flag);
		if (idx === -1) return null;
		const value = args[idx + 1];
		if (!value || value.startsWith('--')) return null;
		return value;
	};

	const uid = getValue('--uid');
	const batchSizeRaw = getValue('--batch-size');
	const maxDocsRaw = getValue('--max-docs');

	const batchSizeParsed = batchSizeRaw ? Number.parseInt(batchSizeRaw, 10) : 200;
	const batchSize = Number.isFinite(batchSizeParsed) && batchSizeParsed > 0 ? Math.min(500, batchSizeParsed) : 200;

	const maxDocsParsed = maxDocsRaw ? Number.parseInt(maxDocsRaw, 10) : null;
	const maxDocs =
		maxDocsParsed && Number.isFinite(maxDocsParsed) && maxDocsParsed > 0 ? maxDocsParsed : null;

	return { dryRun, uid, batchSize, maxDocs };
}

function parseBase64Key(value: string | undefined, label: string, required: boolean): Buffer | null {
	if (!value) {
		if (required) {
			throw new Error(`${label} must be set (base64-encoded 32-byte key).`);
		}
		return null;
	}
	const key = Buffer.from(value, 'base64');
	if (key.length !== 32) {
		throw new Error(`${label} must be a base64-encoded 32-byte key.`);
	}
	return key;
}

function encryptWithKey(value: string, key: Buffer) {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return {
		ciphertext: encrypted.toString('base64'),
		iv: iv.toString('base64'),
		tag: tag.toString('base64')
	};
}

function decryptWithKey(ciphertextB64: string, ivB64: string, tagB64: string, key: Buffer): string {
	const iv = Buffer.from(ivB64, 'base64');
	const tag = Buffer.from(tagB64, 'base64');
	const ciphertext = Buffer.from(ciphertextB64, 'base64');
	const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(tag);
	const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	return decrypted.toString('utf8');
}

function parseUserAndConnectionIdFromPath(path: string): { uid: string; connectionId: string } | null {
	const parts = path.split('/').filter(Boolean);
	// users/{uid}/gmailConnections/{connectionId}
	if (parts.length !== 4) return null;
	if (parts[0] !== 'users') return null;
	if (parts[2] !== 'gmailConnections') return null;
	return { uid: parts[1], connectionId: parts[3] };
}

type RotationResult = {
	seen: number;
	updated: number;
	rotatedFromPrevious: number;
	skipped: number;
	errors: number;
};

async function main() {
	const { dryRun, uid, batchSize, maxDocs } = parseArgs(process.argv);

	if (process.argv.includes('--help') || process.argv.includes('-h')) {
		console.log(`Usage: tsx scripts/rotate-gmail-token-encryption-key.ts [options]

Options:
  --dry-run              Print what would change without writing
  --uid <uid>            Limit to a single user's gmailConnections
  --batch-size <n>       Page size for collectionGroup scans (default 200, max 500)
  --max-docs <n>         Stop after processing N documents

Environment:
  GMAIL_TOKEN_ENCRYPTION_KEY           (required) base64 32-byte key, new primary key
  GMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS  (optional) base64 32-byte key, old key during rotation
`);
		return;
	}

	const primaryKey = parseBase64Key(process.env.GMAIL_TOKEN_ENCRYPTION_KEY, 'GMAIL_TOKEN_ENCRYPTION_KEY', true)!;
	const previousKey = parseBase64Key(
		process.env.GMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS,
		'GMAIL_TOKEN_ENCRYPTION_KEY_PREVIOUS',
		false
	);

	const result: RotationResult = { seen: 0, updated: 0, rotatedFromPrevious: 0, skipped: 0, errors: 0 };

	const handleDoc = async (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
		result.seen++;
		const parsed = parseUserAndConnectionIdFromPath(doc.ref.path);
		if (!parsed) {
			result.skipped++;
			return;
		}

		const data = doc.data() as Record<string, unknown>;

		const refreshTokenLegacy = typeof data.refresh_token === 'string' ? data.refresh_token : null;
		const refreshEncrypted = typeof data.refresh_token_encrypted === 'string' ? data.refresh_token_encrypted : null;
		const refreshIv = typeof data.refresh_token_iv === 'string' ? data.refresh_token_iv : null;
		const refreshTag = typeof data.refresh_token_tag === 'string' ? data.refresh_token_tag : null;

		const accessTokenLegacy = typeof data.access_token === 'string' ? data.access_token : null;
		const accessEncrypted = typeof data.access_token_encrypted === 'string' ? data.access_token_encrypted : null;
		const accessIv = typeof data.access_token_iv === 'string' ? data.access_token_iv : null;
		const accessTag = typeof data.access_token_tag === 'string' ? data.access_token_tag : null;

		let refreshToken: string | null = null;
		let refreshUsedPrevious = false;

		if (refreshTokenLegacy) {
			refreshToken = refreshTokenLegacy;
		} else if (refreshEncrypted && refreshIv && refreshTag) {
			try {
				refreshToken = decryptWithKey(refreshEncrypted, refreshIv, refreshTag, primaryKey);
			} catch (primaryError) {
				if (!previousKey) {
					result.errors++;
					console.warn('[rotate-gmail-token-key] refresh decrypt failed (no previous key)', {
						uid: parsed.uid,
						connectionId: parsed.connectionId,
						error: primaryError instanceof Error ? primaryError.message : String(primaryError)
					});
					return;
				}
				try {
					refreshToken = decryptWithKey(refreshEncrypted, refreshIv, refreshTag, previousKey);
					refreshUsedPrevious = true;
				} catch (prevError) {
					result.errors++;
					console.warn('[rotate-gmail-token-key] refresh decrypt failed (primary+previous)', {
						uid: parsed.uid,
						connectionId: parsed.connectionId,
						error: prevError instanceof Error ? prevError.message : String(prevError)
					});
					return;
				}
			}
		} else {
			result.skipped++;
			console.warn('[rotate-gmail-token-key] connection missing refresh token fields', {
				uid: parsed.uid,
				connectionId: parsed.connectionId
			});
			return;
		}

		let accessToken: string | null = null;
		let accessUsedPrevious = false;

		if (accessTokenLegacy) {
			accessToken = accessTokenLegacy;
		} else if (accessEncrypted && accessIv && accessTag) {
			try {
				accessToken = decryptWithKey(accessEncrypted, accessIv, accessTag, primaryKey);
			} catch {
				if (previousKey) {
					try {
						accessToken = decryptWithKey(accessEncrypted, accessIv, accessTag, previousKey);
						accessUsedPrevious = true;
					} catch {
						accessToken = null;
					}
				}
			}
		}

		const shouldRotateRefresh = Boolean(refreshTokenLegacy) || refreshUsedPrevious;
		const shouldRotateAccess = Boolean(accessTokenLegacy) || accessUsedPrevious;
		if (!shouldRotateRefresh && !shouldRotateAccess) {
			return;
		}

		const update: Record<string, unknown> = {};

		if (shouldRotateRefresh && refreshToken) {
			const enc = encryptWithKey(refreshToken, primaryKey);
			update.refresh_token_encrypted = enc.ciphertext;
			update.refresh_token_iv = enc.iv;
			update.refresh_token_tag = enc.tag;
			update.refresh_token = FieldValue.delete();
		}

		if (shouldRotateAccess && accessToken) {
			const enc = encryptWithKey(accessToken, primaryKey);
			update.access_token_encrypted = enc.ciphertext;
			update.access_token_iv = enc.iv;
			update.access_token_tag = enc.tag;
			update.access_token = FieldValue.delete();
		}

		if (Object.keys(update).length === 0) {
			return;
		}

		if (dryRun) {
			console.log('[rotate-gmail-token-key] would update', {
				uid: parsed.uid,
				connectionId: parsed.connectionId,
				rotateRefresh: shouldRotateRefresh,
				rotateAccess: shouldRotateAccess
			});
		} else {
			await doc.ref.set(update, { merge: true });
		}

		result.updated++;
		if (refreshUsedPrevious || accessUsedPrevious) {
			result.rotatedFromPrevious++;
		}
	};

	if (uid) {
		const snapshot = await adminDb.collection('users').doc(uid).collection('gmailConnections').get();
		for (const doc of snapshot.docs) {
			await handleDoc(doc as any);
		}
	} else {
		let query = adminDb
			.collectionGroup('gmailConnections')
			.orderBy(FieldPath.documentId())
			.limit(batchSize);
		let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;

		while (true) {
			const snapshot = last ? await query.startAfter(last).get() : await query.get();
			if (snapshot.empty) break;

			for (const doc of snapshot.docs) {
				await handleDoc(doc);
				if (maxDocs && result.seen >= maxDocs) {
					break;
				}
			}

			last = snapshot.docs[snapshot.docs.length - 1]!;
			if (maxDocs && result.seen >= maxDocs) break;
			if (snapshot.size < batchSize) break;
		}
	}

	console.log('[rotate-gmail-token-key] complete', result);
}

main().catch((error) => {
	console.error('[rotate-gmail-token-key] failed', {
		message: error instanceof Error ? error.message : String(error)
	});
	process.exitCode = 1;
});

