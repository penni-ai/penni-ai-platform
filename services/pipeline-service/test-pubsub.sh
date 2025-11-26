#!/usr/bin/env bash
set -euo pipefail

# Configuration
PROJECT_ID=${PROJECT_ID:-penni-ai-platform}
REGION=${REGION:-us-central1}
SERVICE_NAME=pipeline-service
TOPIC_NAME=pipeline.start
SUBSCRIPTION_NAME=pipeline-worker-sub
DEAD_LETTER_TOPIC=pipeline.failed

# Get Cloud Run service URL
echo "Getting Cloud Run service URL..."
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format='value(status.url)' || echo "")
if [ -z "$SERVICE_URL" ]; then
  echo "✗ Error: Could not get Cloud Run service URL. Is the service deployed?"
  exit 1
fi
echo "✓ Service URL: $SERVICE_URL"
echo ""

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0

# Test 1: Topic exists
echo "Test 1: Checking if topic '$TOPIC_NAME' exists..."
if gcloud pubsub topics describe "$TOPIC_NAME" --project="$PROJECT_ID" &>/dev/null; then
  echo "  ✓ Topic '$TOPIC_NAME' exists"
  ((TESTS_PASSED++))
else
  echo "  ✗ Topic '$TOPIC_NAME' does not exist"
  ((TESTS_FAILED++))
fi

# Test 2: Subscription exists
echo ""
echo "Test 2: Checking if subscription '$SUBSCRIPTION_NAME' exists..."
if gcloud pubsub subscriptions describe "$SUBSCRIPTION_NAME" --project="$PROJECT_ID" &>/dev/null; then
  echo "  ✓ Subscription '$SUBSCRIPTION_NAME' exists"
  ((TESTS_PASSED++))
else
  echo "  ✗ Subscription '$SUBSCRIPTION_NAME' does not exist"
  ((TESTS_FAILED++))
fi

# Test 3: Dead letter topic exists
echo ""
echo "Test 3: Checking if dead letter topic '$DEAD_LETTER_TOPIC' exists..."
if gcloud pubsub topics describe "$DEAD_LETTER_TOPIC" --project="$PROJECT_ID" &>/dev/null; then
  echo "  ✓ Dead letter topic '$DEAD_LETTER_TOPIC' exists"
  ((TESTS_PASSED++))
else
  echo "  ✗ Dead letter topic '$DEAD_LETTER_TOPIC' does not exist"
  ((TESTS_FAILED++))
fi

# Test 4: Subscription configuration
echo ""
echo "Test 4: Verifying subscription configuration..."
SUBSCRIPTION_JSON=$(gcloud pubsub subscriptions describe "$SUBSCRIPTION_NAME" --project="$PROJECT_ID" --format=json 2>/dev/null || echo "{}")

if [ "$SUBSCRIPTION_JSON" != "{}" ]; then
  # Check push endpoint
  PUSH_ENDPOINT=$(echo "$SUBSCRIPTION_JSON" | jq -r '.pushConfig.pushEndpoint // ""')
  EXPECTED_ENDPOINT="${SERVICE_URL}/pubsub/pipeline-start"
  if [ "$PUSH_ENDPOINT" = "$EXPECTED_ENDPOINT" ]; then
    echo "  ✓ Push endpoint matches: $PUSH_ENDPOINT"
    ((TESTS_PASSED++))
  else
    echo "  ✗ Push endpoint mismatch. Expected: $EXPECTED_ENDPOINT, Got: $PUSH_ENDPOINT"
    ((TESTS_FAILED++))
  fi

  # Check ack deadline
  ACK_DEADLINE=$(echo "$SUBSCRIPTION_JSON" | jq -r '.ackDeadlineSeconds // 0')
  if [ "$ACK_DEADLINE" = "600" ]; then
    echo "  ✓ Ack deadline is 600 seconds"
    ((TESTS_PASSED++))
  else
    echo "  ✗ Ack deadline is $ACK_DEADLINE seconds (expected 600)"
    ((TESTS_FAILED++))
  fi

  # Check dead letter policy
  DLT_TOPIC=$(echo "$SUBSCRIPTION_JSON" | jq -r '.deadLetterPolicy.deadLetterTopic // ""' | sed 's|.*/topics/||')
  if [ "$DLT_TOPIC" = "$DEAD_LETTER_TOPIC" ]; then
    echo "  ✓ Dead letter topic configured: $DLT_TOPIC"
    ((TESTS_PASSED++))
  else
    echo "  ✗ Dead letter topic not configured correctly. Expected: $DEAD_LETTER_TOPIC, Got: $DLT_TOPIC"
    ((TESTS_FAILED++))
  fi

  # Check max delivery attempts
  MAX_ATTEMPTS=$(echo "$SUBSCRIPTION_JSON" | jq -r '.deadLetterPolicy.maxDeliveryAttempts // 0')
  if [ "$MAX_ATTEMPTS" = "3" ]; then
    echo "  ✓ Max delivery attempts is 3"
    ((TESTS_PASSED++))
  else
    echo "  ✗ Max delivery attempts is $MAX_ATTEMPTS (expected 3)"
    ((TESTS_FAILED++))
  fi
else
  echo "  ✗ Could not retrieve subscription configuration"
  ((TESTS_FAILED++))
fi

# Test 5: Test message publishing
echo ""
echo "Test 5: Publishing test message to topic..."
TEST_MESSAGE='{"job_id":"test-'$(date +%s)'","uid":"test-user-123","business_description":"test business description","top_n":30}'
MESSAGE_ID=$(gcloud pubsub topics publish "$TOPIC_NAME" --message="$TEST_MESSAGE" --project="$PROJECT_ID" 2>/dev/null || echo "")
if [ -n "$MESSAGE_ID" ]; then
  echo "  ✓ Test message published successfully. Message ID: $MESSAGE_ID"
  ((TESTS_PASSED++))
else
  echo "  ✗ Failed to publish test message"
  ((TESTS_FAILED++))
fi

# Test 6: IAM permissions
echo ""
echo "Test 6: Checking IAM permissions..."
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)' 2>/dev/null || echo "")
PUBSUB_SERVICE_ACCOUNT="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"

IAM_POLICY=$(gcloud run services get-iam-policy "$SERVICE_NAME" --region="$REGION" --format=json 2>/dev/null || echo "{}")
if echo "$IAM_POLICY" | grep -q "$PUBSUB_SERVICE_ACCOUNT"; then
  echo "  ✓ Pub/Sub service account has invoker role on Cloud Run"
  ((TESTS_PASSED++))
else
  echo "  ✗ Pub/Sub service account does not have invoker role on Cloud Run"
  ((TESTS_FAILED++))
fi

# Summary
echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo "Tests passed: $TESTS_PASSED"
echo "Tests failed: $TESTS_FAILED"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo "✓ All tests passed! Pub/Sub infrastructure is configured correctly."
  echo ""
  echo "Monitoring instructions:"
  echo "  • Monitor subscription: gcloud pubsub subscriptions pull $SUBSCRIPTION_NAME --limit=10"
  echo "  • Check Cloud Run logs: gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE_NAME' --limit=10"
  exit 0
else
  echo "✗ Some tests failed. Please review the errors above and run ./setup-pubsub.sh to fix issues."
  exit 1
fi

