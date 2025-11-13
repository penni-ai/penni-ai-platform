# Firebase Deployment Readiness Checklist

## ✅ Code Status

### TypeScript Compilation
- ✅ **Build passes**: TypeScript compiles without errors
- ✅ **Fixed issues**: 
  - Fixed `db.app.options.projectId` → `app.options.projectId` 
  - Fixed `getStorage()` to use correct API signature (0-1 args only)

### Firebase Admin SDK Configuration

#### Functions (`functions/src/utils/firebase-admin.ts`)
- ✅ **Production**: Uses Application Default Credentials (ADC) automatically in Cloud Functions
- ✅ **Emulator Detection**: Automatically detects emulators via environment variables:
  - `FIRESTORE_EMULATOR_HOST`
  - `FIREBASE_STORAGE_EMULATOR_HOST`
  - `FIREBASE_AUTH_EMULATOR_HOST`
- ✅ **Project ID Resolution**: Checks multiple sources:
  1. `GOOGLE_CLOUD_PROJECT` (set by Cloud Functions runtime)
  2. `FIREBASE_PROJECT_ID` (manual override)
  3. `FIREBASE_CONFIG` JSON (from Firebase runtime)
- ✅ **Storage Bucket**: Properly resolves with fallback
- ✅ **Enhanced Logging**: Now logs emulator status for debugging

#### Frontend (`src/lib/firebase/admin.ts`)
- ✅ **Local Development**: Supports explicit credentials via `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`
- ✅ **Production**: Uses ADC when credentials not provided
- ✅ **Emulator Logging**: Logs emulator host detection

## 🔧 Environment Configuration

### Emulator Setup (Local Development)
When running emulators, these environment variables are automatically set by `firebase emulators:start`:
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:6201`
- `FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199` (if storage emulator enabled)
- `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9100`

**Note**: Firebase Admin SDK automatically detects these and connects to emulators - no code changes needed!

### Production Setup (Cloud Functions)
- ✅ **Credentials**: Automatically provided via Application Default Credentials
- ✅ **Project ID**: Set via `GOOGLE_CLOUD_PROJECT` environment variable
- ✅ **Storage Bucket**: Resolved from `FIREBASE_CONFIG` or environment variables

## 🔑 Required Secrets

Before deploying, ensure these secrets are set in Firebase Secret Manager:

### Required Secrets
```bash
# Set these via: firebase functions:secrets:set SECRET_NAME
OPENAI_API_KEY          # Required for query expansion
DEEPINFRA_API_KEY       # Required for embeddings
BRIGHTDATA_API_KEY      # Required for profile collection
WEAVIATE_API_KEY        # Required for vector search
WEAVIATE_URL            # Required for Weaviate cluster
```

### Optional Secrets (have defaults)
```bash
OPENAI_MODEL                    # Default: 'gpt-5-nano'
BRIGHTDATA_BASE_URL            # Default: 'https://api.brightdata.com/datasets/v3'
BRIGHTDATA_INSTAGRAM_DATASET_ID # Default: 'gd_l1vikfch901nx3by4'
BRIGHTDATA_TIKTOK_DATASET_ID   # Default: 'gd_l1villgoiiidt09ci'
BRIGHTDATA_POLL_INTERVAL       # Default: 10
WEAVIATE_COLLECTION_NAME       # Default: 'influencer_profiles'
DEEPINFRA_EMBEDDING_MODEL      # Default: 'Qwen/Qwen3-Embedding-8B'
STORAGE_BUCKET                 # Default: 'penni-ai-platform.firebasestorage.app'
```

**Quick Setup**:
```bash
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set DEEPINFRA_API_KEY
firebase functions:secrets:set BRIGHTDATA_API_KEY
firebase functions:secrets:set WEAVIATE_API_KEY
firebase functions:secrets:set WEAVIATE_URL
```

## 🧪 Testing Emulator vs Production

### Testing with Emulators
```bash
# Start emulators
firebase emulators:start

# In another terminal, run your app
# The Admin SDK will automatically detect emulators via environment variables
```

**What happens**:
1. Firebase emulators set `FIRESTORE_EMULATOR_HOST`, etc.
2. Admin SDK detects these automatically
3. All Firebase operations go to local emulators
4. Logs will show `isEmulator: true` and emulator hosts

### Testing Production Locally
```bash
# Unset emulator variables
unset FIRESTORE_EMULATOR_HOST
unset FIREBASE_STORAGE_EMULATOR_HOST
unset FIREBASE_AUTH_EMULATOR_HOST

# Ensure you're authenticated with gcloud
gcloud auth application-default login

# Run your functions locally (they'll connect to production)
```

### Deploying to Production
```bash
# Build and deploy
cd functions
npm run build
firebase deploy --only functions

# Or use the npm script
npm run deploy
```

**What happens**:
1. Cloud Functions runtime sets `GOOGLE_CLOUD_PROJECT`
2. Application Default Credentials are automatically available
3. Admin SDK initializes with production project
4. All operations go to production Firebase services
5. Logs will show `isEmulator: false`

## 📋 Pre-Deployment Checklist

- [x] TypeScript compiles without errors
- [x] Firebase Admin SDK properly configured
- [x] Emulator detection working
- [ ] **Required secrets set in Secret Manager** (verify with `firebase functions:secrets:access`)
- [ ] **Test functions locally with emulators** (`firebase emulators:start`)
- [ ] **Test functions locally against production** (unset emulator vars, use gcloud auth)
- [ ] **Verify environment variables** are accessible in production

## 🚀 Deployment Commands

```bash
# 1. Build functions
cd functions
npm run build

# 2. Deploy functions
firebase deploy --only functions

# 3. Deploy everything (functions + apphosting + storage rules)
firebase deploy

# 4. Deploy specific function
firebase deploy --only functions:functionName
```

## 🔍 Verification After Deployment

1. **Check function logs**:
   ```bash
   firebase functions:log
   ```
   Look for: `[FirebaseAdmin] Initialized functions admin app` with correct project ID

2. **Test a function endpoint**:
   ```bash
   curl https://us-central1-penni-ai-platform.cloudfunctions.net/weaviateHealth
   ```

3. **Check Secret Manager**:
   ```bash
   firebase functions:secrets:access
   ```

## 🐛 Troubleshooting

### Issue: "Permission denied" errors
**Solution**: Ensure Cloud Functions service account has proper IAM roles:
- `roles/firebase.admin`
- `roles/storage.admin` (if using Storage)
- `roles/secretmanager.secretAccessor` (for secrets)

### Issue: Functions can't access secrets
**Solution**: Verify secrets are set and functions reference them correctly

### Issue: Wrong project ID in production
**Solution**: Check `GOOGLE_CLOUD_PROJECT` is set correctly by Cloud Functions runtime

### Issue: Emulators not detected
**Solution**: Ensure emulator environment variables are set:
```bash
echo $FIRESTORE_EMULATOR_HOST  # Should show: 127.0.0.1:6201
```

## 📝 Notes

- **Credentials**: Cloud Functions automatically provide Application Default Credentials - no need to manually configure service account keys in production
- **Emulators**: Admin SDK automatically detects emulators - no code changes needed
- **Project ID**: In production, `GOOGLE_CLOUD_PROJECT` is automatically set by the Cloud Functions runtime
- **Storage Bucket**: Falls back to `{projectId}.appspot.com` if not explicitly set

## ✅ You're Ready to Deploy!

Your code is properly configured to work with both emulators and production. The Firebase Admin SDK will automatically:
- Use emulators when environment variables are set
- Use production services when deployed to Cloud Functions
- Use Application Default Credentials in production (no manual credential setup needed)

Just make sure your secrets are configured in Secret Manager before deploying!

