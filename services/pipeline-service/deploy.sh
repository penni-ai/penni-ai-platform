#!/usr/bin/env bash
set -euo pipefail

# Configuration variables
PROJECT_ID=${PROJECT_ID:-penni-ai-platform}
REGION=${REGION:-us-central1}
SERVICE_NAME=pipeline-service
SERVICE_ACCOUNT=${SERVICE_NAME}@${PROJECT_ID}.iam.gserviceaccount.com

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

# Pub/Sub Publisher role (for publishing to Pub/Sub topics)
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/pubsub.publisher" \
  --condition=None

# Pub/Sub Subscriber role (for receiving Pub/Sub messages)
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/pubsub.subscriber" \
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

echo "IAM roles granted successfully"

# Pub/Sub infrastructure setup (one-time operation, can be run separately if needed)
echo ""
echo "Pub/Sub infrastructure setup is required for the pipeline service to work."
read -p "Do you want to set up Pub/Sub infrastructure now? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  if [ -f "./setup-pubsub.sh" ]; then
    ./setup-pubsub.sh
  else
    echo "⚠️  setup-pubsub.sh not found. Please run it manually: ./setup-pubsub.sh"
  fi
else
  echo "⚠️  Pub/Sub infrastructure not set up. The service will not be able to process pipeline jobs until you run ./setup-pubsub.sh"
fi

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

# Check if Pub/Sub topic exists
echo ""
echo "Checking Pub/Sub infrastructure..."
TOPIC_NAME="pipeline.start"
if gcloud pubsub topics describe "$TOPIC_NAME" --project="$PROJECT_ID" &>/dev/null; then
  echo "✓ Topic '$TOPIC_NAME' exists"
else
  echo "⚠ Topic '$TOPIC_NAME' does not exist. Run ./setup-pubsub.sh to create it."
fi

# Check if subscription exists
SUBSCRIPTION_NAME="pipeline-worker-sub"
if gcloud pubsub subscriptions describe "$SUBSCRIPTION_NAME" --project="$PROJECT_ID" &>/dev/null; then
  echo "✓ Subscription '$SUBSCRIPTION_NAME' exists"
else
  echo "⚠ Subscription '$SUBSCRIPTION_NAME' does not exist. Run ./setup-pubsub.sh to create it."
fi

# Check if dead letter topic exists
DEAD_LETTER_TOPIC="pipeline.failed"
if gcloud pubsub topics describe "$DEAD_LETTER_TOPIC" --project="$PROJECT_ID" &>/dev/null; then
  echo "✓ Dead letter topic '$DEAD_LETTER_TOPIC' exists"
else
  echo "⚠ Dead letter topic '$DEAD_LETTER_TOPIC' does not exist. Run ./setup-pubsub.sh to create it."
fi

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

# Test health endpoint
echo ""
echo "Testing health endpoint..."
ID_TOKEN=$(gcloud auth print-identity-token)
curl -s -H "Authorization: Bearer $ID_TOKEN" "$SERVICE_URL/health" | jq '.' || echo "Health check response received"

