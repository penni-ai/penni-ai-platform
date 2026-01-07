#!/bin/bash
# Test script for Weaviate BM25 Search function

FUNCTION_URL="https://test-weaviatebm25search-szs2cmou6q-uc.a.run.app"

# Get query and limit from command line arguments, or use defaults
QUERY="${1:-lifestyle}"
LIMIT="${2:-5}"

# Get authentication token
echo "🔐 Getting authentication token..."
TOKEN=$(gcloud auth print-identity-token)

if [ -z "$TOKEN" ]; then
  echo "❌ Error: Failed to get authentication token. Make sure you're logged in with 'gcloud auth login'"
  exit 1
fi

echo "🔍 Testing Weaviate BM25 Search..."
echo "   Query: $QUERY"
echo "   Limit: $LIMIT"
echo ""

# Make the request
RESPONSE=$(curl -s -X GET \
  "${FUNCTION_URL}?query=${QUERY}&limit=${LIMIT}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

# Check if response contains error
if echo "$RESPONSE" | grep -q '"status":"error"'; then
  echo "❌ Error response:"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

# Pretty print the response
echo "✅ Success! Results:"
echo "$RESPONSE" | jq '{
  query: .query,
  collection: .collection,
  count: .count,
  limit: .limit,
  timestamp: .timestamp,
  sample_results: .results[0:2] | map({id, score: .score, username: .data.username, platform: .data.platform, followers: .data.followers})
}'

echo ""
OUT_DIR="${OUT_DIR:-test-results}"
mkdir -p "$OUT_DIR"
OUT_FILE="${OUT_DIR}/response.$(date +%Y%m%dT%H%M%S).json"
echo "📊 Full response saved to ${OUT_FILE}"
echo "$RESPONSE" | jq '.' > "$OUT_FILE"
