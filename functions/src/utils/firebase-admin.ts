import { initializeApp, getApps, getApp, type App, type AppOptions } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

const isFunctionsEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

if (!isFunctionsEmulator) {
  const storageEmulatorKeys = [
    'FIREBASE_STORAGE_EMULATOR_HOST',
    'STORAGE_EMULATOR_HOST',
    'GCLOUD_STORAGE_EMULATOR_HOST',
  ] as const;

  for (const key of storageEmulatorKeys) {
    if (process.env[key]) {
      console.warn('[FirebaseAdmin] Ignoring storage emulator host in production', {
        key,
        value: process.env[key],
      });
      delete process.env[key];
    }
  }
}

interface FirebaseEnvConfig {
  projectId?: string;
  storageBucket?: string;
}

function parseFirebaseEnvConfig(): FirebaseEnvConfig {
  const rawConfig = process.env.FIREBASE_CONFIG;
  if (!rawConfig) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawConfig);
    return {
      projectId: parsed.projectId || parsed.project_id,
      storageBucket: parsed.storageBucket || parsed.storage_bucket,
    };
  } catch (error) {
    console.warn('[FirebaseAdmin] Failed to parse FIREBASE_CONFIG', error);
    return {};
  }
}

const firebaseEnvConfig = parseFirebaseEnvConfig();
const resolvedProjectId =
  process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || firebaseEnvConfig.projectId;

const fallbackBucket = resolvedProjectId ? `${resolvedProjectId}.appspot.com` : 'penni-ai-platform.firebasestorage.app';
const resolvedStorageBucket =
  process.env.STORAGE_BUCKET ||
  process.env.FIREBASE_STORAGE_BUCKET ||
  firebaseEnvConfig.storageBucket ||
  fallbackBucket;

if (!process.env.STORAGE_BUCKET) {
  process.env.STORAGE_BUCKET = resolvedStorageBucket;
}

if (!process.env.FIREBASE_STORAGE_BUCKET) {
  process.env.FIREBASE_STORAGE_BUCKET = resolvedStorageBucket;
}

let hasLoggedConfig = false;
let hasLoggedApiKeys = false;

/**
 * Safely log first few characters of an API key for verification
 */
function maskApiKey(key: string | undefined, prefixLength = 6): string {
  if (!key) return 'NOT SET';
  const trimmed = key.trim();
  if (trimmed.length <= prefixLength) return 'SET (too short to mask)';
  return `${trimmed.substring(0, prefixLength)}...${trimmed.substring(trimmed.length - 4)} (length: ${trimmed.length})`;
}

/**
 * Validate and log API key configuration status
 */
function logApiKeyStatus(): void {
  if (hasLoggedApiKeys) return;
  hasLoggedApiKeys = true;

  const apiKeys = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    DEEPINFRA_API_KEY: process.env.DEEPINFRA_API_KEY,
    BRIGHTDATA_API_KEY: process.env.BRIGHTDATA_API_KEY,
    WEAVIATE_API_KEY: process.env.WEAVIATE_API_KEY,
    WEAVIATE_URL: process.env.WEAVIATE_URL,
  };

  const status: Record<string, string> = {};
  const missing: string[] = [];

  for (const [key, value] of Object.entries(apiKeys)) {
    if (value) {
      if (key === 'WEAVIATE_URL') {
        // URL is not a secret, show first part
        const url = value.trim();
        const match = url.match(/^https?:\/\/([^/]+)/);
        status[key] = match ? `${match[1]}...` : url.substring(0, 30) + '...';
      } else {
        status[key] = maskApiKey(value);
      }
    } else {
      status[key] = 'NOT SET';
      missing.push(key);
    }
  }

  console.info('[FirebaseAdmin] API Key Configuration Status', status);

  if (missing.length > 0) {
    console.warn(`[FirebaseAdmin] ⚠️  Missing required API keys: ${missing.join(', ')}`);
  } else {
    console.info('[FirebaseAdmin] ✅ All API keys are configured');
  }
}

export function getOrInitAdminApp(): App {
  if (!getApps().length) {
    const options: AppOptions = {};
    if (resolvedProjectId) {
      options.projectId = resolvedProjectId;
    }
    if (resolvedStorageBucket) {
      options.storageBucket = resolvedStorageBucket;
    }
    initializeApp(options);
  }

  const app = getApp();
  if (!hasLoggedConfig) {
    hasLoggedConfig = true;
    const isEmulator = Boolean(
      process.env.FIRESTORE_EMULATOR_HOST ||
      process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
      process.env.FIREBASE_AUTH_EMULATOR_HOST
    );
    console.info('[FirebaseAdmin] Initialized functions admin app', {
      projectId: app.options.projectId,
      storageBucket: app.options.storageBucket,
      envProject: process.env.GOOGLE_CLOUD_PROJECT,
      bucketEnv: process.env.STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET,
      isEmulator,
      emulators: {
        firestore: process.env.FIRESTORE_EMULATOR_HOST || 'none',
        storage: process.env.FIREBASE_STORAGE_EMULATOR_HOST || 'none',
        auth: process.env.FIREBASE_AUTH_EMULATOR_HOST || 'none',
      },
    });
    logApiKeyStatus();
  }
  return app;
}

export function getFirestoreInstance() {
  return getFirestore(getOrInitAdminApp());
}

export function getAuthInstance() {
  return getAuth(getOrInitAdminApp());
}

export function getStorageInstance() {
  return getStorage(getOrInitAdminApp());
}

export const resolvedFirebaseProjectId = resolvedProjectId;
export const resolvedStorageBucketName = resolvedStorageBucket;
