#!/usr/bin/env bash
set -euo pipefail

# Configuration variables
PROJECT_ID=${PROJECT_ID:-penni-ai-platform}
REGION=${REGION:-us-central1}
SERVICE_NAME=pipeline-service
SERVICE_ACCOUNT=${SERVICE_NAME}@${PROJECT_ID}.iam.gserviceaccount.com
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
CLOUD_TASKS_SA="service-${PROJECT_NUMBER}@gcp-sa-cloudtasks.iam.gserviceaccount.com"

# Set active GCP project
echo "Setting active project to $PROJECT_ID"
gcloud config set project "$PROJECT_ID"

# Create service account if it doesn't exist
echo "Checking if service account exists..."
if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT" &>/dev/null; then
  echo "Creating service account: $SERVICE_ACCOUNT"
  gcloud iam service-accounts create pipeline-service \
    --display-name="Pipeline Service Account" \
    --project="$PROJECT_ID"
else
  echo "Service account already exists: $SERVICE_ACCOUNT"
fi

# Grant IAM roles to service account
echo "Granting IAM roles to service account..."

# Cloud Tasks Enqueuer role (for creating tasks)
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/cloudtasks.enqueuer" \
  --condition=None

# Datastore User role (for reading/writing Firestore)
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/datastore.user" \
  --condition=None

# Storage Object Admin role (for storing pipeline results)
STORAGE_BUCKET="${PROJECT_ID}.appspot.com"
gcloud storage buckets add-iam-policy-binding "gs://${STORAGE_BUCKET}" \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/storage.objectAdmin" \
  --condition=None || echo "Warning: Failed to grant Storage role (bucket may not exist yet)"

# Secret Manager Secret Accessor role (for accessing secrets)
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None

# Allow Cloud Tasks to mint OIDC tokens for the pipeline service account
gcloud iam service-accounts add-iam-policy-binding "$SERVICE_ACCOUNT" \
  --member="serviceAccount:$CLOUD_TASKS_SA" \
  --role="roles/iam.serviceAccountTokenCreator"

echo "IAM roles granted successfully"

# Check if required secrets exist
echo ""
echo "Checking required secrets in Secret Manager..."
REQUIRED_SECRETS=("openai-api-key" "weaviate-api-key" "weaviate-url" "deepinfra-api-key" "brightdata-api-key")
MISSING_SECRETS=()

for secret in "${REQUIRED_SECRETS[@]}"; do
  if gcloud secrets describe "$secret" --project="$PROJECT_ID" &>/dev/null; then
    echo "✓ Secret '$secret' exists"
  else
    echo "✗ Secret '$secret' is missing"
    MISSING_SECRETS+=("$secret")
  fi
done

if [ ${#MISSING_SECRETS[@]} -gt 0 ]; then
  echo ""
  echo "Warning: The following secrets are missing: ${MISSING_SECRETS[*]}"
  echo "Please create them in Secret Manager before deploying:"
  echo "  gcloud secrets create <secret-name> --data-file=- --project=$PROJECT_ID"
fi

# Check if Cloud Tasks queues exist
echo ""
echo "Checking Cloud Tasks infrastructure..."
for queue in pipeline-stage pipeline-batch pipeline-poll; do
  if gcloud tasks queues describe "$queue" --location="$REGION" --project="$PROJECT_ID" &>/dev/null; then
    echo "✓ Queue '$queue' exists"
  else
    echo "⚠ Queue '$queue' does not exist. Create it with: gcloud tasks queues create $queue --location $REGION"
  fi
done

# Submit Cloud Build
echo "Submitting Cloud Build..."
gcloud builds submit --config=cloudbuild.yaml

# Display service URL
echo ""
echo "Deployment complete!"
echo ""
echo "Service URL:"
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format='value(status.url)')
echo "$SERVICE_URL"

# Allow the pipeline service account to invoke Cloud Run (needed for Cloud Tasks OIDC)
gcloud run services add-iam-policy-binding "$SERVICE_NAME" \
  --region="$REGION" \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/run.invoker"

# Test health endpoint
echo ""
echo "Testing health endpoint..."
ID_TOKEN=$(gcloud auth print-identity-token)
curl -s -H "Authorization: Bearer $ID_TOKEN" "$SERVICE_URL/health" | jq '.' || echo "Health check response received"
