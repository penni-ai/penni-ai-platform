#!/bin/bash
# Test script for Weaviate Parallel Hybrid Search function

FUNCTION_URL="https://weaviateparallelhybridsearch-szs2cmou6q-uc.a.run.app"

# Get authentication token
echo "🔐 Getting authentication token..."
TOKEN=$(gcloud auth print-identity-token)

if [ -z "$TOKEN" ]; then
  echo "❌ Error: Failed to get authentication token. Make sure you're logged in with 'gcloud auth login'"
  exit 1
fi

echo "🔍 Testing Weaviate Parallel Hybrid Search..."
echo ""

# Create request payload
PAYLOAD=$(cat <<EOF
{
  "keywords": ["lifestyle", "fitness", "travel"],
  "alphas": [0.2, 0.5, 0.8],
  "top_n": 5,
  "min_followers": 10000,
  "max_followers": 500000
}
EOF
)

echo "📤 Request payload:"
echo "$PAYLOAD" | jq '.'
echo ""

# Make the request
RESPONSE=$(curl -s -X POST \
  "${FUNCTION_URL}" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

# Check if response contains error
if echo "$RESPONSE" | grep -q '"status":"error"'; then
  echo "❌ Error response:"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

# Pretty print the response summary
echo "✅ Success! Summary:"
echo "$RESPONSE" | jq '{
  keywords: .keywords,
  alphas: .alphas,
  top_n: .top_n,
  search_limit: .search_limit,
  total_searches: .total_searches,
  successful_searches: .successful_searches,
  failed_searches: .failed_searches,
  total_results: .total_results,
  unique_profiles: .unique_profiles,
  results_count: (.results | length),
  sample_results: .results[0:3] | map({
    username: .data.username,
    platform: .data.platform,
    followers: .data.followers,
    score: .score
  })
}'

echo ""
echo "📊 Full response saved to parallel-hybrid-response.json"
echo "$RESPONSE" | jq '.' > parallel-hybrid-response.json

