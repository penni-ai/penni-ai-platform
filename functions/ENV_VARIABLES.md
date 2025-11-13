# Environment Variables Reference

## Required Environment Variables for Pipeline

### 🔑 Core API Keys (Required)

```bash
# OpenAI API Key (for query expansion and LLM analysis)
OPENAI_API_KEY=sk-proj-...

# OpenAI Model (optional, defaults to 'gpt-5-nano')
OPENAI_MODEL=gpt-5-nano

# DeepInfra API Key (for embeddings)
DEEPINFRA_API_KEY=...

# BrightData API Key (for profile collection)
BRIGHTDATA_API_KEY=...

# Weaviate API Key (for vector search)
WEAVIATE_API_KEY=...
```

### 🌐 Weaviate Configuration (Required)

```bash
# Weaviate cluster URL
WEAVIATE_URL=wkaf7rfar2grwthe7yxog.c0.us-west3.gcp.weaviate.cloud

# Collection name (optional, defaults to 'influencer_profiles')
WEAVIATE_COLLECTION_NAME=influencer_profiles

# Search configuration (optional, has defaults)
WEAVIATE_TOP_N=1000
WEAVIATE_RESULTS_PER_QUERY=500
WEAVIATE_ALPHA_VALUES=0.2,0.5,0.8
```

### 📊 BrightData Configuration (Required)

```bash
# Base URL (optional, has default)
BRIGHTDATA_BASE_URL=https://api.brightdata.com/datasets/v3

# Dataset IDs
BRIGHTDATA_INSTAGRAM_DATASET_ID=gd_l1vikfch901nx3by4
BRIGHTDATA_TIKTOK_DATASET_ID=gd_l1villgoiiidt09ci

# Polling interval in seconds (optional, defaults to 10)
BRIGHTDATA_POLL_INTERVAL=10
```

### 🔥 Firebase Configuration (Required for Storage)

```bash
# Storage bucket name (optional, defaults to 'penni-ai-platform.firebasestorage.app')
STORAGE_BUCKET=penni-ai-platform.firebasestorage.app
# OR
FIREBASE_STORAGE_BUCKET=penni-ai-platform.firebasestorage.app

# Firebase Admin SDK (for Cloud Functions)
FIREBASE_PROJECT_ID=penni-ai-platform
# Note: In Cloud Functions, credentials are automatically provided
# For local dev, you may need:
FIREBASE_CLIENT_EMAIL=service-account@...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
```

### 🤖 DeepInfra Configuration (Optional, has defaults)

```bash
# Base URL (optional, has default)
DEEPINFRA_BASE_URL=https://api.deepinfra.com

# Embedding model (optional, defaults to 'Qwen/Qwen3-Embedding-8B')
DEEPINFRA_EMBEDDING_MODEL=Qwen/Qwen3-Embedding-8B

# API paths (optional, has defaults)
DEEPINFRA_EMBED_PATH=/v1/openai
DEEPINFRA_INFERENCE_PATH=/v1/inference
```

### 🧪 Local Development (Optional)

```bash
# Firebase Emulators
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199
FIRESTORE_EMULATOR_HOST=127.0.0.1:6201
FUNCTIONS_EMULATOR=http://127.0.0.1:6200
```

## Minimum Required Variables

For the pipeline to work, you **must** set:

1. ✅ `OPENAI_API_KEY` - For query expansion and LLM analysis
2. ✅ `DEEPINFRA_API_KEY` - For embeddings
3. ✅ `BRIGHTDATA_API_KEY` - For profile collection
4. ✅ `WEAVIATE_API_KEY` - For vector search
5. ✅ `WEAVIATE_URL` - Weaviate cluster URL

All other variables have defaults or are optional.

## Example .env File

```bash
# Core API Keys
OPENAI_API_KEY=sk-proj-your-key-here
OPENAI_MODEL=gpt-5-nano
DEEPINFRA_API_KEY=your-deepinfra-key
BRIGHTDATA_API_KEY=your-brightdata-key
WEAVIATE_API_KEY=your-weaviate-key

# Weaviate
WEAVIATE_URL=your-cluster.weaviate.cloud
WEAVIATE_COLLECTION_NAME=influencer_profiles

# BrightData
BRIGHTDATA_INSTAGRAM_DATASET_ID=gd_l1vikfch901nx3by4
BRIGHTDATA_TIKTOK_DATASET_ID=gd_l1villgoiiidt09ci
BRIGHTDATA_BASE_URL=https://api.brightdata.com/datasets/v3
BRIGHTDATA_POLL_INTERVAL=10

# Firebase Storage
STORAGE_BUCKET=penni-ai-platform.firebasestorage.app
FIREBASE_PROJECT_ID=penni-ai-platform

# DeepInfra (optional)
DEEPINFRA_EMBEDDING_MODEL=Qwen/Qwen3-Embedding-8B
```

## Cloud Functions Deployment

When deploying to Cloud Functions, set these as **Secret Manager secrets**:

- `OPENAI_API_KEY`
- `DEEPINFRA_API_KEY`
- `BRIGHTDATA_API_KEY`
- `WEAVIATE_API_KEY`
- `FIREBASE_PRIVATE_KEY` (if using service account)

Then reference them in your function configuration.

