import { initializeApp, getApps, getApp, type App, type AppOptions, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

const isFunctionsEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
const isDevelopment = process.env.NODE_ENV === 'development';

// Only ignore storage emulator in production (not in development or Functions emulator)
if (!isFunctionsEmulator && !isDevelopment) {
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

const fallbackBucket = resolvedProjectId ? `${resolvedProjectId}.firebasestorage.app` : 'penni-ai-platform.firebasestorage.app';
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

/**
 * Get credential based on environment
 * - Production (Cloud Run): Uses Application Default Credentials (automatically available)
 * - Local Docker: Uses Application Default Credentials (mounted from host)
 * - Local with service account: Uses service account key file if GOOGLE_APPLICATION_CREDENTIALS is set
 * - Emulator: No credentials needed (emulator handles auth)
 */
function getCredential() {
  // Check if we're using emulator (no credentials needed)
  const isEmulator = Boolean(
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST
  );

  if (isEmulator) {
    // Emulator doesn't require credentials
    return undefined;
  }

  // Check if service account key file is provided (for local development)
  // Note: In ES modules, we can't use require() dynamically
  // If GOOGLE_APPLICATION_CREDENTIALS points to a JSON file, Firebase Admin SDK
  // will automatically use it via applicationDefault()
  // For explicit service account, use FIREBASE_SERVICE_ACCOUNT env var with JSON content
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountJson) {
    try {
      // Parse service account from environment variable (JSON string)
      const serviceAccount = JSON.parse(serviceAccountJson);
      return cert(serviceAccount);
    } catch (error) {
      console.warn('[FirebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT, falling back to Application Default Credentials', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Use Application Default Credentials (works in Cloud Run and local Docker with mounted credentials)
  try {
    return applicationDefault();
  } catch (error) {
    console.warn('[FirebaseAdmin] Failed to get Application Default Credentials, initializing without explicit credentials', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Fall back to no explicit credentials (Firebase Admin SDK will try to auto-discover)
    return undefined;
  }
}

export function getOrInitAdminApp(): App {
  if (!getApps().length) {
    const credential = getCredential();
    const options: AppOptions = {};
    
    if (credential) {
      options.credential = credential;
    }
    
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
  const app = getOrInitAdminApp();
  const storage = getStorage(app);
  
  // Configure storage client for emulator if needed
  // The underlying Google Cloud Storage client should automatically use HTTP
  // when STORAGE_EMULATOR_HOST or FIREBASE_STORAGE_EMULATOR_HOST is set
  // But we ensure both are set for compatibility
  const storageEmulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST;
  if (storageEmulatorHost && !storageEmulatorHost.startsWith('http')) {
    // Ensure the underlying client uses HTTP for emulator
    // The Google Cloud Storage client should detect STORAGE_EMULATOR_HOST automatically
    // This is just for logging/debugging
    console.log('[FirebaseAdmin] Storage emulator configured:', { storageEmulatorHost });
  }
  
  return storage;
}

export const resolvedFirebaseProjectId = resolvedProjectId;
export const resolvedStorageBucketName = resolvedStorageBucket;

