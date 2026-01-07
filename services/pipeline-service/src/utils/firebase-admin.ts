import { initializeApp, getApps, getApp, type App, type AppOptions, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { createLogger } from './logger.js';

const logger = createLogger({ component: 'firebase-admin' });

const isFunctionsEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
const isProduction = process.env.NODE_ENV === 'production';

// Only ignore storage emulator in production (not in development/test or Functions emulator)
if (!isFunctionsEmulator && isProduction) {
  const storageEmulatorKeys = [
    'FIREBASE_STORAGE_EMULATOR_HOST',
    'STORAGE_EMULATOR_HOST',
    'GCLOUD_STORAGE_EMULATOR_HOST',
  ] as const;

  for (const key of storageEmulatorKeys) {
    if (process.env[key]) {
      logger.warn('firebase_admin_storage_emulator_ignored', {
        key,
        value: process.env[key],
      });
      delete process.env[key];
    }
  }
}

// Firebase tools sets FIREBASE_STORAGE_EMULATOR_HOST (no protocol); google-cloud-storage expects STORAGE_EMULATOR_HOST with protocol.
if (process.env.FIREBASE_STORAGE_EMULATOR_HOST && !process.env.STORAGE_EMULATOR_HOST) {
  const rawHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST.trim();
  if (rawHost) {
    process.env.STORAGE_EMULATOR_HOST = rawHost.startsWith('http') ? rawHost : `http://${rawHost}`;
  }
}

if (process.env.STORAGE_EMULATOR_HOST && !process.env.STORAGE_EMULATOR_HOST.startsWith('http')) {
  process.env.STORAGE_EMULATOR_HOST = `http://${process.env.STORAGE_EMULATOR_HOST}`;
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
    logger.warn('firebase_admin_config_parse_failed', { error });
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
 * Validate and log API key configuration status
 */
function logApiKeyStatus(): void {
  if (hasLoggedApiKeys) return;
  hasLoggedApiKeys = true;

  const weaviateUrl = process.env.WEAVIATE_URL?.trim() || null;
  const weaviateHost = weaviateUrl ? (() => {
    const match = weaviateUrl.match(/^https?:\/\/([^/]+)/);
    return match?.[1] ?? null;
  })() : null;

  const status: Record<string, unknown> = {
    openai_configured: Boolean(process.env.OPENAI_API_KEY),
    deepinfra_configured: Boolean(process.env.DEEPINFRA_API_KEY),
    brightdata_configured: Boolean(process.env.BRIGHTDATA_API_KEY),
    weaviate_api_configured: Boolean(process.env.WEAVIATE_API_KEY),
    weaviate_url_host: weaviateHost,
  };
  const missing: string[] = [];

  if (!status.openai_configured) missing.push('OPENAI_API_KEY');
  if (!status.deepinfra_configured) missing.push('DEEPINFRA_API_KEY');
  if (!status.brightdata_configured) missing.push('BRIGHTDATA_API_KEY');
  if (!status.weaviate_api_configured) missing.push('WEAVIATE_API_KEY');
  if (!weaviateHost) missing.push('WEAVIATE_URL');

  logger.info('firebase_admin_api_key_status', status);

  if (missing.length > 0) {
    logger.warn('firebase_admin_api_keys_missing', { missing });
  } else {
    logger.info('firebase_admin_api_keys_ok');
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
      logger.warn('firebase_admin_service_account_parse_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Use Application Default Credentials (works in Cloud Run and local Docker with mounted credentials)
  try {
    return applicationDefault();
  } catch (error) {
    logger.warn('firebase_admin_adc_failed', {
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
    logger.info('firebase_admin_initialized', {
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
    logger.info('firebase_admin_storage_emulator_configured', { storageEmulatorHost });
  }
  
  return storage;
}

export const resolvedFirebaseProjectId = resolvedProjectId;
export const resolvedStorageBucketName = resolvedStorageBucket;
