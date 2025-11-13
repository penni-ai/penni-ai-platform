# Firebase Functions Secrets Setup Guide

## Required Secrets for Production

Your Firebase Functions need the following secrets configured in **Google Cloud Secret Manager**. These secrets are automatically injected as environment variables when your functions run.

## 🔑 Required Secrets

### 1. **OPENAI_API_KEY** (Required)
- **Purpose**: Used for query expansion and LLM fit score analysis
- **Used in**: 
  - `generateSearchQueries` function
  - `pipelineInfluencerAnalysis` function
- **Set command**:
```bash
firebase functions:secrets:set OPENAI_API_KEY
```

### 2. **OPENAI_MODEL** (Optional, defaults to 'gpt-5-nano')
- **Purpose**: Specifies which OpenAI model to use
- **Set command**:
```bash
firebase functions:secrets:set OPENAI_MODEL
```

### 3. **DEEPINFRA_API_KEY** (Required)
- **Purpose**: Used for generating embeddings for Weaviate vector search
- **Used in**: `weaviateHybridSearch` function
- **Set command**:
```bash
firebase functions:secrets:set DEEPINFRA_API_KEY
```

### 4. **BRIGHTDATA_API_KEY** (Required)
- **Purpose**: Used to collect live influencer profile data
- **Used in**: 
  - `brightdataCollect` function
  - `brightdataBatchCollect` function
  - `pipelineInfluencerAnalysis` function
- **Set command**:
```bash
firebase functions:secrets:set BRIGHTDATA_API_KEY
```

### 5. **WEAVIATE_API_KEY** (Required)
- **Purpose**: Authentication for Weaviate vector database
- **Used in**: 
  - `weaviateHybridSearch` function
  - `weaviateBm25Search` function
  - `weaviateHealth` function
- **Set command**:
```bash
firebase functions:secrets:set WEAVIATE_API_KEY
```

### 6. **WEAVIATE_URL** (Required)
- **Purpose**: Weaviate cluster URL for vector search
- **Used in**: All Weaviate functions
- **Set command**:
```bash
firebase functions:secrets:set WEAVIATE_URL
```

## 📋 Quick Setup Commands

Run these commands to set all required secrets:

```bash
# Navigate to your project root
cd /Users/maikyon/Documents/Programming/penny-platform

# Set OpenAI secrets
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set OPENAI_MODEL

# Set DeepInfra secret
firebase functions:secrets:set DEEPINFRA_API_KEY

# Set BrightData secret
firebase functions:secrets:set BRIGHTDATA_API_KEY

# Set Weaviate secrets
firebase functions:secrets:set WEAVIATE_API_KEY
firebase functions:secrets:set WEAVIATE_URL
```

When prompted, paste the secret values from your `.env` file.

## 🔧 Optional Secrets (with defaults)

These have defaults but can be overridden:

- `BRIGHTDATA_BASE_URL` (default: `https://api.brightdata.com/datasets/v3`)
- `BRIGHTDATA_INSTAGRAM_DATASET_ID` (default: `gd_l1vikfch901nx3by4`)
- `BRIGHTDATA_TIKTOK_DATASET_ID` (default: `gd_l1villgoiiidt09ci`)
- `BRIGHTDATA_POLL_INTERVAL` (default: `10`)
- `WEAVIATE_COLLECTION_NAME` (default: `influencer_profiles`)
- `DEEPINFRA_EMBEDDING_MODEL` (default: `Qwen/Qwen3-Embedding-8B`)
- `STORAGE_BUCKET` (default: `penni-ai-platform.firebasestorage.app`)

## 🔗 Configure Functions to Use Secrets

After setting secrets, you need to update your function definitions to reference them. Check your function code - it should already be reading from `process.env`, which will automatically get the secrets in production.

For Firebase Functions v2, secrets are automatically available as environment variables when you set them via `firebase functions:secrets:set`.

## ✅ Verify Secrets Are Set

List all configured secrets:

```bash
firebase functions:secrets:access
```

Or check in Google Cloud Console:
- Go to: https://console.cloud.google.com/security/secret-manager?project=penni-ai-platform

## 🚨 Important Notes

1. **Never commit secrets to git** - They should only exist in Secret Manager
2. **Local development** uses `.env` file (already gitignored)
3. **Production** uses Secret Manager secrets automatically
4. Secrets are automatically injected as environment variables in Cloud Functions
5. After setting secrets, redeploy your functions for changes to take effect

## 📝 Setting Values

To set secrets, use the Firebase CLI commands shown above. Replace the placeholder values with your actual API keys from your service providers.

**Note:** Never commit actual secret values to version control. Always use Firebase Secret Manager or environment variables.

