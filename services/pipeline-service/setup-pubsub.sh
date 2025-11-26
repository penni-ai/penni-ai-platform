#!/usr/bin/env bash
set -euo pipefail

# Configuration variables
PROJECT_ID=${PROJECT_ID:-penni-ai-platform}
REGION=${REGION:-us-central1}
SERVICE_NAME=pipeline-service
TOPIC_NAME=pipeline.start
SUBSCRIPTION_NAME=pipeline-worker-sub
DEAD_LETTER_TOPIC=pipeline.failed
SERVICE_ACCOUNT=${SERVICE_NAME}@${PROJECT_ID}.iam.gserviceaccount.com

# Set active project
echo "Setting active project to $PROJECT_ID"
gcloud config set project "$PROJECT_ID"

# Get project number for Pub/Sub service account
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
PUBSUB_SERVICE_ACCOUNT="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"

echo "Pub/Sub service account: $PUBSUB_SERVICE_ACCOUNT"

# Create main topic
echo ""
echo "Creating Pub/Sub topic: $TOPIC_NAME"
if gcloud pubsub topics describe "$TOPIC_NAME" --project="$PROJECT_ID" &>/dev/null; then
  echo "✓ Topic '$TOPIC_NAME' already exists"
else
  gcloud pubsub topics create "$TOPIC_NAME" \
    --project="$PROJECT_ID" \
    --message-retention-duration=7d
  echo "✓ Topic '$TOPIC_NAME' created with 7-day retention"
fi

# Create dead letter topic
echo ""
echo "Creating dead letter topic: $DEAD_LETTER_TOPIC"
if gcloud pubsub topics describe "$DEAD_LETTER_TOPIC" --project="$PROJECT_ID" &>/dev/null; then
  echo "✓ Dead letter topic '$DEAD_LETTER_TOPIC' already exists"
else
  gcloud pubsub topics create "$DEAD_LETTER_TOPIC" \
    --project="$PROJECT_ID"
  echo "✓ Dead letter topic '$DEAD_LETTER_TOPIC' created"
fi

# Get Cloud Run service URL
echo ""
echo "Getting Cloud Run service URL..."
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format='value(status.url)' || echo "")
if [ -z "$SERVICE_URL" ]; then
  echo "✗ Error: Could not get Cloud Run service URL. Is the service deployed?"
  exit 1
fi
echo "✓ Service URL: $SERVICE_URL"

# Create push subscription
echo ""
echo "Creating push subscription: $SUBSCRIPTION_NAME"
if gcloud pubsub subscriptions describe "$SUBSCRIPTION_NAME" --project="$PROJECT_ID" &>/dev/null; then
  echo "✓ Subscription '$SUBSCRIPTION_NAME' already exists"
else
  gcloud pubsub subscriptions create "$SUBSCRIPTION_NAME" \
    --topic="$TOPIC_NAME" \
    --push-endpoint="${SERVICE_URL}/pubsub/pipeline-start" \
    --ack-deadline=600 \
    --min-retry-delay=10s \
    --max-retry-delay=600s \
    --max-delivery-attempts=5 \
    --dead-letter-topic="$DEAD_LETTER_TOPIC" \
    --dead-letter-topic-project="$PROJECT_ID" \
    --project="$PROJECT_ID"
  echo "✓ Subscription '$SUBSCRIPTION_NAME' created"
fi

# Grant Pub/Sub invoker role on Cloud Run
echo ""
echo "Granting Pub/Sub service account invoker role on Cloud Run..."
if gcloud run services get-iam-policy "$SERVICE_NAME" --region="$REGION" --format=json | grep -q "$PUBSUB_SERVICE_ACCOUNT"; then
  echo "✓ Pub/Sub service account already has invoker role"
else
  gcloud run services add-iam-policy-binding "$SERVICE_NAME" \
    --region="$REGION" \
    --member="serviceAccount:${PUBSUB_SERVICE_ACCOUNT}" \
    --role="roles/run.invoker"
  echo "✓ Granted invoker role to Pub/Sub service account"
fi

# Grant dead letter permissions
echo ""
echo "Granting Pub/Sub service account publisher role on dead letter topic..."
if gcloud pubsub topics get-iam-policy "$DEAD_LETTER_TOPIC" --project="$PROJECT_ID" --format=json | grep -q "$PUBSUB_SERVICE_ACCOUNT"; then
  echo "✓ Pub/Sub service account already has publisher role on dead letter topic"
else
  gcloud pubsub topics add-iam-policy-binding "$DEAD_LETTER_TOPIC" \
    --member="serviceAccount:${PUBSUB_SERVICE_ACCOUNT}" \
    --role="roles/pubsub.publisher" \
    --project="$PROJECT_ID"
  echo "✓ Granted publisher role to Pub/Sub service account on dead letter topic"
fi

# Grant subscription acknowledgment permissions
echo ""
echo "Granting Pub/Sub service account subscriber role on subscription..."
if gcloud pubsub subscriptions get-iam-policy "$SUBSCRIPTION_NAME" --project="$PROJECT_ID" --format=json | grep -q "$PUBSUB_SERVICE_ACCOUNT"; then
  echo "✓ Pub/Sub service account already has subscriber role on subscription"
else
  gcloud pubsub subscriptions add-iam-policy-binding "$SUBSCRIPTION_NAME" \
    --member="serviceAccount:${PUBSUB_SERVICE_ACCOUNT}" \
    --role="roles/pubsub.subscriber" \
    --project="$PROJECT_ID"
  echo "✓ Granted subscriber role to Pub/Sub service account on subscription"
fi

# Verification summary
echo ""
echo "=========================================="
echo "Pub/Sub Infrastructure Setup Complete!"
echo "=========================================="
echo ""
echo "Resources created:"
echo "  • Topic: $TOPIC_NAME (7-day retention)"
echo "  • Subscription: $SUBSCRIPTION_NAME"
echo "  • Dead letter topic: $DEAD_LETTER_TOPIC"
echo ""
echo "Subscription configuration:"
echo "  • Push endpoint: ${SERVICE_URL}/pubsub/pipeline-start"
echo "  • Ack deadline: 600 seconds (10 minutes)"
echo "  • Retry policy: Exponential backoff (10s - 600s)"
  echo "  • Max delivery attempts: 5"
echo "  • Dead letter topic: $DEAD_LETTER_TOPIC"
echo ""
echo "IAM bindings:"
echo "  • Pub/Sub SA → Cloud Run invoker"
echo "  • Pub/Sub SA → Dead letter topic publisher"
echo "  • Pub/Sub SA → Subscription subscriber"
echo ""
echo "Testing:"
echo "  • Run ./test-pubsub.sh to verify setup"
echo "  • Publish test message: gcloud pubsub topics publish $TOPIC_NAME --message='{\"job_id\":\"test\",\"uid\":\"test-user\",\"business_description\":\"test\",\"top_n\":30}'"
echo "  • Monitor logs: gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE_NAME' --limit=10"
echo ""

