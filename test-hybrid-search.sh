#!/bin/bash
# Test script for Weaviate Hybrid Search function

FUNCTION_URL="https://weaviatehybridsearch-szs2cmou6q-uc.a.run.app"

# Get parameters from command line arguments, or use defaults
QUERY="${1:-lifestyle}"
LIMIT="${2:-5}"
ALPHA="${3:-0.5}"
MIN_FOLLOWERS="${4:-}"
MAX_FOLLOWERS="${5:-}"
PLATFORM="${6:-}"

# Get authentication token
echo "🔐 Getting authentication token..."
TOKEN=$(gcloud auth print-identity-token)

if [ -z "$TOKEN" ]; then
  echo "❌ Error: Failed to get authentication token. Make sure you're logged in with 'gcloud auth login'"
  exit 1
fi

echo "🔍 Testing Weaviate Hybrid Search..."
echo "   Query: $QUERY"
echo "   Limit: $LIMIT"
echo "   Alpha: $ALPHA (0=pure BM25, 1=pure vector, 0.5=balanced)"
[ -n "$MIN_FOLLOWERS" ] && echo "   Min Followers: $MIN_FOLLOWERS"
[ -n "$MAX_FOLLOWERS" ] && echo "   Max Followers: $MAX_FOLLOWERS"
[ -n "$PLATFORM" ] && echo "   Platform: $PLATFORM"
echo ""

# Build query string
QUERY_STRING="query=${QUERY}&limit=${LIMIT}&alpha=${ALPHA}"
[ -n "$MIN_FOLLOWERS" ] && QUERY_STRING="${QUERY_STRING}&min_followers=${MIN_FOLLOWERS}"
[ -n "$MAX_FOLLOWERS" ] && QUERY_STRING="${QUERY_STRING}&max_followers=${MAX_FOLLOWERS}"
[ -n "$PLATFORM" ] && QUERY_STRING="${QUERY_STRING}&platform=${PLATFORM}"

# Make the request
RESPONSE=$(curl -s -X GET \
  "${FUNCTION_URL}?${QUERY_STRING}" \
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
  alpha: .alpha,
  embedding_model: .embedding_model,
  embedding_dimensions: .embedding_dimensions,
  timestamp: .timestamp,
  sample_results: .results[0:3] | map({
    id,
    score,
    username: .data.username,
    platform: .data.platform,
    followers: .data.followers,
    display_name: .data.display_name
  })
}'

echo ""
echo "📊 Full response saved to hybrid-response.json"
echo "$RESPONSE" | jq '.' > hybrid-response.json

