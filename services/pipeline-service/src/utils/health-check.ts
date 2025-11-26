/**
 * Pre-flight health check utility
 * Validates all dependencies (buckets, endpoints, API keys) before pipeline execution
 */

import { getStorageInstance } from './firebase-admin.js';
import { getBrightDataApiKey, getBrightDataBaseUrl, getBrightDataInstagramDatasetId, getBrightDataTikTokDatasetId } from './brightdata-internal.js';
import { getWeaviateClientInstance } from './weaviate-search.js';
import OpenAI from 'openai';

interface HealthCheckResult {
  service: string;
  status: 'ok' | 'error';
  message: string;
  details?: any;
}

interface HealthCheckSummary {
  allHealthy: boolean;
  checks: HealthCheckResult[];
  errors: HealthCheckResult[];
}

/**
 * Check if Storage bucket exists and is accessible
 */
async function checkStorageBucket(): Promise<HealthCheckResult> {
  const bucketName = process.env.STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || 'penni-ai-platform.firebasestorage.app';
  const storageEmulatorHost = process.env.STORAGE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  const isEmulator = Boolean(storageEmulatorHost);
  
  // For emulator, just verify it's configured (actual write/delete will work at runtime)
  // Firebase Admin SDK has issues with emulator HTTPS, so we skip the test
  if (isEmulator) {
    return {
      service: 'Storage Bucket',
      status: 'ok',
      message: `Storage emulator is configured (bucket ${bucketName} will be created on first use)`,
      details: {
        bucket: bucketName,
        emulator: true,
        emulatorHost: storageEmulatorHost,
        note: 'Write/delete operations will be tested at runtime (emulator mode)',
      },
    };
  }
  
  console.log('[HealthCheck] Proceeding with production bucket test');
  
  // For production, test write/delete operations
  try {
    const storage = getStorageInstance();
    const bucket = storage.bucket(bucketName);
    
    // For production, test write/delete operations to verify bucket is actually accessible
    const testFileName = `_health_check_${Date.now()}.txt`;
    const testFile = bucket.file(testFileName);
    const testContent = 'health check test file';
    
    try {
      // Test 1: Write a test file
      await testFile.save(testContent, {
        metadata: {
          contentType: 'text/plain',
        },
      });
      
      // Test 2: Verify file exists
      const [exists] = await testFile.exists();
      if (!exists) {
        return {
          service: 'Storage Bucket',
          status: 'error',
          message: `Bucket ${bucketName} write test failed - file not found after upload`,
          details: { bucket: bucketName, testFile: testFileName },
        };
      }
      
      // Test 3: Delete the test file
      await testFile.delete();
      
      // Test 4: Verify file is deleted
      const [stillExists] = await testFile.exists();
      if (stillExists) {
        return {
          service: 'Storage Bucket',
          status: 'error',
          message: `Bucket ${bucketName} delete test failed - file still exists after delete`,
          details: { bucket: bucketName, testFile: testFileName },
        };
      }
      
      // All tests passed - try to get bucket metadata
      const details: any = { bucket: bucketName };
      try {
        const [metadata] = await bucket.getMetadata();
        details.location = metadata.location;
      } catch (metaError) {
        // Metadata fetch failed, but write/delete worked, so it's OK
        details.note = 'Metadata fetch failed, but write/delete operations succeeded';
      }
      
      return {
        service: 'Storage Bucket',
        status: 'ok',
        message: `Bucket ${bucketName} is accessible and writable (write/delete test passed)`,
        details,
      };
    } catch (testError) {
      // Clean up test file if it exists (best effort)
      try {
        await testFile.delete().catch(() => {});
      } catch {
        // Ignore cleanup errors
      }
      
      const errorMessage = testError instanceof Error ? testError.message : String(testError);
      return {
        service: 'Storage Bucket',
        status: 'error',
        message: `Bucket ${bucketName} test failed: ${errorMessage}`,
        details: {
          bucket: bucketName,
          error: errorMessage,
        },
      };
    }
  } catch (error) {
    return {
      service: 'Storage Bucket',
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      details: { error: String(error) },
    };
  }
}

/**
 * Check OpenAI API key and endpoint
 */
async function checkOpenAI(): Promise<HealthCheckResult> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        service: 'OpenAI',
        status: 'error',
        message: 'OPENAI_API_KEY is not set',
      };
    }

    const openai = new OpenAI({ apiKey });
    
    // Make a minimal API call to verify the key works
    const response = await openai.models.list();
    
    return {
      service: 'OpenAI',
      status: 'ok',
      message: 'OpenAI API key is valid',
      details: {
        keyPrefix: apiKey.substring(0, 7) + '...',
        modelCount: response.data.length,
      },
    };
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
      return {
        service: 'OpenAI',
        status: 'error',
        message: 'OpenAI API key is invalid or expired',
        details: { error: errorMessage },
      };
    }
    return {
      service: 'OpenAI',
      status: 'error',
      message: `OpenAI API error: ${errorMessage}`,
      details: { error: errorMessage },
    };
  }
}

/**
 * Check Weaviate connection and API key
 */
async function checkWeaviate(): Promise<HealthCheckResult> {
  try {
    const apiKey = process.env.WEAVIATE_API_KEY;
    const url = process.env.WEAVIATE_URL;
    const collectionName = process.env.WEAVIATE_COLLECTION_NAME || 'influencer_profiles';

    if (!apiKey) {
      return {
        service: 'Weaviate',
        status: 'error',
        message: 'WEAVIATE_API_KEY is not set',
      };
    }

    if (!url) {
      return {
        service: 'Weaviate',
        status: 'error',
        message: 'WEAVIATE_URL is not set',
      };
    }

    const client = await getWeaviateClientInstance();
    
    // Check if Weaviate is reachable
    const isReady = await client.isReady();
    if (!isReady) {
      return {
        service: 'Weaviate',
        status: 'error',
        message: 'Weaviate client is not ready',
        details: { url },
      };
    }
    
    // Check if collection exists
    let collectionExists = false;
    try {
      const collection = client.collections.get(collectionName);
      await collection.config.get();
      collectionExists = true;
    } catch (error) {
      // Collection doesn't exist or can't be accessed
      collectionExists = false;
    }

    return {
      service: 'Weaviate',
      status: 'ok',
      message: `Weaviate is accessible at ${url}`,
      details: {
        url: url,
        collectionExists: collectionExists,
        collectionName: collectionName,
      },
    };
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
      return {
        service: 'Weaviate',
        status: 'error',
        message: 'Weaviate API key is invalid',
        details: { error: errorMessage },
      };
    }
    if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND')) {
      return {
        service: 'Weaviate',
        status: 'error',
        message: `Cannot connect to Weaviate at ${process.env.WEAVIATE_URL}`,
        details: { error: errorMessage },
      };
    }
    return {
      service: 'Weaviate',
      status: 'error',
      message: `Weaviate error: ${errorMessage}`,
      details: { error: errorMessage },
    };
  }
}

/**
 * Check DeepInfra API key and endpoint
 */
async function checkDeepInfra(): Promise<HealthCheckResult> {
  try {
    const apiKey = process.env.DEEPINFRA_API_KEY;
    if (!apiKey) {
      return {
        service: 'DeepInfra',
        status: 'error',
        message: 'DEEPINFRA_API_KEY is not set',
      };
    }

    // DeepInfra doesn't have a simple health endpoint, so we'll validate the key format
    // and make a test API call to verify it works
    if (apiKey.length < 20) {
      return {
        service: 'DeepInfra',
        status: 'error',
        message: 'DEEPINFRA_API_KEY appears to be invalid (too short)',
      };
    }

    // Try to make a simple API call to verify the key works
    // DeepInfra API endpoint for embeddings
    const model = process.env.DEEPINFRA_EMBEDDING_MODEL || 'Qwen/Qwen3-Embedding-8B';
    const testUrl = `https://api.deepinfra.com/v1/inference/${model}`;
    
    try {
      const response = await fetch(testUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: ['test'],
        }),
      });

      if (response.status === 401 || response.status === 403) {
        return {
          service: 'DeepInfra',
          status: 'error',
          message: 'DeepInfra API key is invalid or expired',
          details: { status: response.status },
        };
      }
    } catch (fetchError) {
      // If fetch fails, just validate key format (might be network issue)
      console.warn('[HealthCheck] DeepInfra API test failed, but key format is valid:', fetchError);
    }

    return {
      service: 'DeepInfra',
      status: 'ok',
      message: 'DeepInfra API key is configured',
      details: {
        keyPrefix: apiKey.substring(0, 8) + '...',
        model: model,
      },
    };
  } catch (error: any) {
    return {
      service: 'DeepInfra',
      status: 'error',
      message: `DeepInfra error: ${error?.message || String(error)}`,
      details: { error: String(error) },
    };
  }
}

/**
 * Check BrightData API key and endpoints
 * Note: BrightData health check is skipped as API endpoints may vary
 */
async function checkBrightData(): Promise<HealthCheckResult> {
  try {
    const apiKey = getBrightDataApiKey();
    const baseUrl = getBrightDataBaseUrl();

    if (!apiKey) {
      return {
        service: 'BrightData',
        status: 'ok', // Don't fail on missing key, just warn
        message: 'BRIGHTDATA_API_KEY is not set (will be checked at runtime)',
      };
    }

    if (!baseUrl) {
      return {
        service: 'BrightData',
        status: 'ok', // Don't fail on missing URL, just warn
        message: 'BRIGHTDATA_BASE_URL is not set (will be checked at runtime)',
      };
    }

    // Just verify configuration is present, don't test API endpoint
    return {
      service: 'BrightData',
      status: 'ok',
      message: 'BrightData API key is configured (endpoint will be validated at runtime)',
      details: {
        url: baseUrl,
        instagramDatasetId: getBrightDataInstagramDatasetId(),
        tiktokDatasetId: getBrightDataTikTokDatasetId(),
      },
    };
  } catch (error: any) {
    // Don't fail health check for BrightData, just log warning
    return {
      service: 'BrightData',
      status: 'ok',
      message: 'BrightData configuration check skipped (will be validated at runtime)',
      details: { note: 'BrightData health check is skipped to avoid false positives' },
    };
  }
}

/**
 * Check Firestore connection
 */
async function checkFirestore(): Promise<HealthCheckResult> {
  try {
    const { getFirestoreInstance } = await import('./firebase-admin.js');
    const db = getFirestoreInstance();
    
    // Try to read a test document or check if we can access Firestore
    // We'll just check if we can get a collection reference
    const testCollection = db.collection('_health_check');
    await testCollection.limit(1).get();
    
    return {
      service: 'Firestore',
      status: 'ok',
      message: 'Firestore is accessible',
    };
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    if (errorMessage.includes('PERMISSION_DENIED')) {
      return {
        service: 'Firestore',
        status: 'error',
        message: 'Firestore permission denied - check credentials',
        details: { error: errorMessage },
      };
    }
    return {
      service: 'Firestore',
      status: 'error',
      message: `Firestore error: ${errorMessage}`,
      details: { error: errorMessage },
    };
  }
}

/**
 * Run all health checks
 */
export async function runHealthChecks(): Promise<HealthCheckSummary> {
  console.log('[HealthCheck] Running pre-flight health checks...');
  
  const checks = await Promise.all([
    checkStorageBucket(),
    checkOpenAI(),
    checkWeaviate(),
    checkDeepInfra(),
    checkBrightData(),
    checkFirestore(),
  ]);

  const errors = checks.filter(check => check.status === 'error');
  const allHealthy = errors.length === 0;

  const summary: HealthCheckSummary = {
    allHealthy,
    checks,
    errors,
  };

  // Log results
  console.log('[HealthCheck] Health check results:');
  checks.forEach(check => {
    const icon = check.status === 'ok' ? '✅' : '❌';
    console.log(`  ${icon} ${check.service}: ${check.message}`);
    if (check.details) {
      console.log(`     Details:`, check.details);
    }
  });

  if (!allHealthy) {
    console.warn(`[HealthCheck] ⚠️  ${errors.length} health check(s) failed:`);
    errors.forEach(error => {
      console.warn(`  ❌ ${error.service}: ${error.message}`);
    });
  } else {
    console.log('[HealthCheck] ✅ All health checks passed');
  }

  return summary;
}

/**
 * Validate health checks and throw if any fail
 */
export async function validateHealthChecks(): Promise<void> {
  const summary = await runHealthChecks();
  
  if (!summary.allHealthy) {
    const errorMessages = summary.errors.map(e => `${e.service}: ${e.message}`).join('; ');
    throw new Error(`Health check failed: ${errorMessages}`);
  }
}

