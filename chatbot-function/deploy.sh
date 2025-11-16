#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

# ============================================================================
# Load environment variables from .env file
# ============================================================================
load_env_file() {
    local env_file="${SCRIPT_DIR}/.env"
    
    if [[ ! -f "$env_file" ]]; then
        echo "Warning: .env file not found at $env_file" >&2
        return 0
    fi
    
    echo "Loading environment variables from .env file..."
    
    while IFS= read -r line || [ -n "$line" ]; do
        # Skip comments and empty lines
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ -z "${line// }" ]] && continue
        
        # Extract variable name and value
        if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
            local var_name="${BASH_REMATCH[1]}"
            local var_value="${BASH_REMATCH[2]}"
            
            # Remove leading/trailing whitespace
            var_value="${var_value#"${var_value%%[![:space:]]*}"}"
            var_value="${var_value%"${var_value##*[![:space:]]}"}"
            
            # Remove quotes if present
            if [[ "$var_value" =~ ^\".*\"$ ]]; then
                var_value="${var_value#\"}"
                var_value="${var_value%\"}"
            elif [[ "$var_value" =~ ^\'.*\'$ ]]; then
                var_value="${var_value#\'}"
                var_value="${var_value%\'}"
            fi
            
            # Export variable (only if not already set in environment)
            if [[ -z "${!var_name:-}" ]]; then
                export "$var_name=$var_value"
            fi
        fi
    done < "$env_file"
}

# Load .env file
load_env_file

# ============================================================================
# Configuration variables (from .env or environment, with defaults)
# ============================================================================
PROJECT_ID=${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-}}
REGION=${REGION:-${GOOGLE_CLOUD_REGION:-us-central1}}
FUNCTION_NAME=${FUNCTION_NAME:-penni-chatbot-function}
MEMORY=${MEMORY:-2Gi}
TIMEOUT=${TIMEOUT:-540s}
MAX_INSTANCES=${MAX_INSTANCES:-10}
MIN_INSTANCES=${MIN_INSTANCES:-0}

if [[ -z "$PROJECT_ID" ]]; then
  echo "PROJECT_ID is required. Set PROJECT_ID or GOOGLE_CLOUD_PROJECT." >&2
  exit 1
fi

echo "Using project $PROJECT_ID in region $REGION"
gcloud config set project "$PROJECT_ID" >/dev/null

# Prepare environment variables
ENV_VARS=(
  "GOOGLE_CLOUD_PROJECT=$PROJECT_ID"
  "GOOGLE_CLOUD_REGION=$REGION"
  "VERTEX_AI_REGION=${VERTEX_AI_REGION:-global}"
  "VERTEX_MODEL=${VERTEX_MODEL:-gemini-2.5-flash-preview-09-2025}"
  "LOG_LEVEL=${LOG_LEVEL:-INFO}"
)

# Add LangSmith variables if provided
if [[ -n "${LANGSMITH_TRACING:-}" ]]; then
  ENV_VARS+=("LANGSMITH_TRACING=$LANGSMITH_TRACING")
fi
if [[ -n "${LANGSMITH_ENDPOINT:-}" ]]; then
  ENV_VARS+=("LANGSMITH_ENDPOINT=$LANGSMITH_ENDPOINT")
fi
if [[ -n "${LANGSMITH_API_KEY:-}" ]]; then
  ENV_VARS+=("LANGSMITH_API_KEY=$LANGSMITH_API_KEY")
fi
if [[ -n "${LANGSMITH_PROJECT:-}" ]]; then
  ENV_VARS+=("LANGSMITH_PROJECT=$LANGSMITH_PROJECT")
fi

# Build env vars string
ENV_VARS_STRING=$(IFS=,; echo "${ENV_VARS[*]}")

echo "Deploying Cloud Function: $FUNCTION_NAME"
echo "  Region: $REGION"
echo "  Memory: $MEMORY"
echo "  Timeout: $TIMEOUT"
echo "  Max Instances: $MAX_INSTANCES"
echo ""

gcloud functions deploy "$FUNCTION_NAME" \
  --gen2 \
  --runtime=python312 \
  --region="$REGION" \
  --source="$SCRIPT_DIR" \
  --entry-point=chatbot \
  --trigger-http \
  --set-env-vars "$ENV_VARS_STRING" \
  --memory="$MEMORY" \
  --timeout="$TIMEOUT" \
  --max-instances="$MAX_INSTANCES" \
  --min-instances="$MIN_INSTANCES"

echo ""
echo "Deployment complete!"
echo ""
echo "Function URL:"
gcloud functions describe "$FUNCTION_NAME" --gen2 --region="$REGION" --format='value(serviceConfig.uri)'

