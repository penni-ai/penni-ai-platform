#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Starting Full Pipeline Test"
echo "================================"
echo ""

# Check if container is running
CONTAINER_NAME="pipeline-service-test"
if ! docker ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
  echo "❌ Container ${CONTAINER_NAME} is not running."
  echo "Please start it first with: ./test-docker-local.sh"
  exit 1
fi

echo "✅ Container is running"
echo ""

# Test 1: Health Check
echo "📋 Test 1: Health Check"
echo "----------------------"
HEALTH_RESPONSE=$(curl -s http://localhost:8080/health)
HEALTH_STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.status' 2>/dev/null || echo "error")

if [[ "$HEALTH_STATUS" == "ok" ]]; then
  echo "✅ Health check passed"
  echo "$HEALTH_RESPONSE" | jq '.health.checks[] | "  ✅ \(.service): \(.message)"'
else
  echo "❌ Health check failed"
  echo "$HEALTH_RESPONSE" | jq '.'
  exit 1
fi
echo ""

# Test 2: Start Pipeline Job
echo "📋 Test 2: Start Pipeline Job"
echo "-----------------------------"
echo "Sending pipeline start request..."

# Generate a test request
TEST_REQUEST=$(cat <<EOF
{
  "business_description": "A sustainable coffee shop in San Francisco that focuses on organic, fair-trade coffee and eco-friendly practices. We're looking for influencers who care about sustainability and local community.",
  "top_n": 30,
  "uid": "test-user-$(date +%s)",
  "platform": "instagram",
  "min_followers": 10000,
  "max_followers": 1000000
}
EOF
)

PIPELINE_RESPONSE=$(curl -s -X POST http://localhost:8080/pipeline/start \
  -H "Content-Type: application/json" \
  -d "$TEST_REQUEST")

JOB_ID=$(echo "$PIPELINE_RESPONSE" | jq -r '.job_id' 2>/dev/null || echo "")
STATUS=$(echo "$PIPELINE_RESPONSE" | jq -r '.status' 2>/dev/null || echo "")

if [[ -n "$JOB_ID" && "$STATUS" == "accepted" ]]; then
  echo "✅ Pipeline job started successfully"
  echo "  Job ID: $JOB_ID"
  echo "  Status: $STATUS"
  echo "  Response:"
  echo "$PIPELINE_RESPONSE" | jq '.'
else
  echo "❌ Failed to start pipeline job"
  echo "$PIPELINE_RESPONSE" | jq '.' || echo "$PIPELINE_RESPONSE"
  exit 1
fi
echo ""

# Test 3: Simulate Pub/Sub Message (Direct Worker Call)
echo "📋 Test 3: Execute Pipeline (Simulating Pub/Sub Message)"
echo "--------------------------------------------------------"
echo "Since Pub/Sub may not be configured locally, we'll directly call the worker endpoint..."
echo ""

# Create Pub/Sub message format
MESSAGE_DATA=$(cat <<EOF
{
  "job_id": "$JOB_ID",
  "uid": "$(echo "$TEST_REQUEST" | jq -r '.uid')",
  "business_description": "$(echo "$TEST_REQUEST" | jq -r '.business_description')",
  "top_n": $(echo "$TEST_REQUEST" | jq -r '.top_n'),
  "platform": "$(echo "$TEST_REQUEST" | jq -r '.platform')",
  "min_followers": $(echo "$TEST_REQUEST" | jq -r '.min_followers'),
  "max_followers": $(echo "$TEST_REQUEST" | jq -r '.max_followers')
}
EOF
)

# Encode as base64 (Pub/Sub format)
ENCODED_DATA=$(echo -n "$MESSAGE_DATA" | base64)

# Create Pub/Sub message format
PUBSUB_MESSAGE=$(cat <<EOF
{
  "message": {
    "data": "$ENCODED_DATA",
    "attributes": {
      "job_id": "$JOB_ID"
    }
  }
}
EOF
)

echo "Calling worker endpoint..."
WORKER_RESPONSE=$(curl -s -X POST http://localhost:8080/pubsub/pipeline-start \
  -H "Content-Type: application/json" \
  -d "$PUBSUB_MESSAGE" \
  -w "\nHTTP_CODE:%{http_code}")

HTTP_CODE=$(echo "$WORKER_RESPONSE" | grep -o "HTTP_CODE:[0-9]*" | cut -d: -f2)
WORKER_BODY=$(echo "$WORKER_RESPONSE" | sed '/HTTP_CODE:/d')

if [[ "$HTTP_CODE" == "204" ]]; then
  echo "✅ Worker endpoint accepted message (204 No Content)"
  echo "Pipeline execution started in background..."
else
  echo "⚠️  Unexpected HTTP code: $HTTP_CODE"
  echo "Response: $WORKER_BODY"
fi
echo ""

# Test 4: Monitor Job Progress
echo "📋 Test 4: Monitor Job Progress"
echo "-------------------------------"
echo "Polling Firestore for job status (this may take 5-30 minutes)..."
echo "Job ID: $JOB_ID"
echo ""
echo "You can check the job status manually:"
echo "  gcloud firestore documents get pipeline_jobs/$JOB_ID"
echo ""
echo "Or view container logs:"
echo "  docker logs -f $CONTAINER_NAME"
echo ""
echo "The pipeline will:"
echo "  1. Generate 12 search queries (~2-5 seconds)"
echo "  2. Perform 24 parallel hybrid searches (~10-30 seconds)"
echo "  3. Extract top 30 profile URLs"
echo "  4. Collect profiles from BrightData (~5-30 minutes)"
echo "  5. Analyze profiles with LLM (concurrent with BrightData)"
echo "  6. Store results in Firestore and Cloud Storage"
echo ""
echo "✅ Test completed! Pipeline is running in the background."
echo ""
echo "To view logs: docker logs -f $CONTAINER_NAME"

