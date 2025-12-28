import { FakeFirestore, FakeStorage } from '../../services/pipeline-service/test/helpers/fake-firebase';

export { FakeFirestore, FakeStorage };

export function createFirebaseAdminMock(options?: {
	firestore?: FakeFirestore;
	storage?: FakeStorage;
	projectId?: string;
	storageBucket?: string;
	verifySessionCookie?: (cookie: string) => Promise<any>;
}) {
	const projectId = options?.projectId ?? process.env.FIREBASE_PROJECT_ID ?? 'penni-ai-platform';
	const storageBucket = options?.storageBucket ?? `${projectId}.firebasestorage.app`;
	const firestore = options?.firestore ?? new FakeFirestore();
	const storage = options?.storage ?? new FakeStorage(storageBucket);

	const adminApp = { options: { projectId, storageBucket } };
	const adminAuth = {
		verifySessionCookie: options?.verifySessionCookie ?? (async () => ({ uid: 'user_test' }))
	};
	const adminDb = Object.assign(firestore, { app: adminApp });
	const adminStorage = Object.assign(storage, { app: adminApp });

	return { adminApp, adminAuth, adminDb, adminStorage };
}

