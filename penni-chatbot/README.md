# Penni Chatbot - Vertex AI Test

This directory contains a test script for connecting to GCP Vertex AI with Claude Haiku 4.5.

## Setup

1. **Set up your `.env` file:**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` and set your `GCP_PROJECT_ID`.

2. **Authenticate with Google Cloud:**
   ```bash
   gcloud auth application-default login
   ```
   
   Or set `GOOGLE_APPLICATION_CREDENTIALS` to point to a service account key file:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
   ```

## Running the Test

```bash
npx tsx test-vertex-haiku.ts
```

The script will:
- Connect to GCP Vertex AI using the project ID from your `.env` file
- Send a test message asking for a banana bread recipe
- Print the response as formatted JSON

## Environment Variables

- `GCP_PROJECT_ID` (required): Your GCP project ID (e.g., `penni-ai-platform`)
- `GOOGLE_APPLICATION_CREDENTIALS` (optional): Path to service account key file if not using Application Default Credentials
- `GCP_REGION` (optional): GCP region (defaults to `global`)

