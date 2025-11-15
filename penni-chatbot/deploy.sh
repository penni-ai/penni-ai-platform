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
SERVICE=${CHATBOT_SERVICE_NAME:-penni-chatbot}
# Construct image path using region-specific Artifact Registry format
# Format: REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME/IMAGE_NAME:TAG
IMAGE_REGISTRY="${REGION}-docker.pkg.dev"
IMAGE=${CHATBOT_IMAGE:-${IMAGE_REGISTRY}/$PROJECT_ID/penni/penni-chatbot:latest}
INSTANCE=${CLOUD_SQL_INSTANCE:-penni-chatbot-db}
DB_NAME=${POSTGRES_DB:-penni_chatbot}
DB_USER=${POSTGRES_USER:-penni_bot}
DB_PASSWORD=${POSTGRES_PASSWORD:-}
CLOUD_SQL_CONNECTION=${CLOUD_SQL_CONNECTION_NAME:-$PROJECT_ID:$REGION:$INSTANCE}

if [[ -z "$PROJECT_ID" ]]; then
  echo "PROJECT_ID is required. Set PROJECT_ID or GOOGLE_CLOUD_PROJECT." >&2
  exit 1
fi

if [[ -z "$DB_PASSWORD" ]]; then
  echo "POSTGRES_PASSWORD must be set to connect to Cloud SQL." >&2
  exit 1
fi

echo "Using project $PROJECT_ID in region $REGION"
gcloud config set project "$PROJECT_ID" >/dev/null

# Extract repository name from image path
# IMAGE format: REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME/IMAGE_NAME:TAG
# Example: us-central1-docker.pkg.dev/my-project/penni/penni-chatbot:latest
# Fields: 1=REGION-docker.pkg.dev, 2=PROJECT_ID, 3=REPO_NAME, 4=IMAGE_NAME:TAG
IMAGE_REPO=$(echo "$IMAGE" | cut -d'/' -f3)
IMAGE_NAME=$(echo "$IMAGE" | cut -d'/' -f4 | cut -d':' -f1)

echo "Verifying Artifact Registry repository '$IMAGE_REPO' exists..."
if ! gcloud artifacts repositories describe "$IMAGE_REPO" --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "ERROR: Artifact Registry repository '$IMAGE_REPO' not found" >&2
  echo "Please create it with:" >&2
  echo "  gcloud artifacts repositories create $IMAGE_REPO --repository-format=docker --location=$REGION --project=$PROJECT_ID" >&2
  exit 1
fi
echo "✓ Repository '$IMAGE_REPO' exists"

echo "Verifying Cloud SQL instance $INSTANCE exists..."
if ! gcloud sql instances describe "$INSTANCE" --quiet >/dev/null 2>&1; then
  echo "ERROR: Cloud SQL instance '$INSTANCE' not found" >&2
  echo "Please create it with:" >&2
  echo "  gcloud sql instances create $INSTANCE --database-version=POSTGRES_15 --tier=db-custom-1-3840 --region=$REGION" >&2
  exit 1
fi
echo "✓ Cloud SQL instance '$INSTANCE' exists"

echo "Verifying database $DB_NAME exists..."
if ! gcloud sql databases describe "$DB_NAME" --instance "$INSTANCE" >/dev/null 2>&1; then
  echo "ERROR: Database '$DB_NAME' not found in instance '$INSTANCE'" >&2
  echo "Please create it with:" >&2
  echo "  gcloud sql databases create $DB_NAME --instance $INSTANCE" >&2
  exit 1
fi
echo "✓ Database '$DB_NAME' exists"

echo "Verifying user $DB_USER exists..."
if ! gcloud sql users describe "$DB_USER" --instance "$INSTANCE" >/dev/null 2>&1; then
  echo "ERROR: Database user '$DB_USER' not found in instance '$INSTANCE'" >&2
  echo "Please create it with:" >&2
  echo "  gcloud sql users create $DB_USER --instance $INSTANCE --password <PASSWORD>" >&2
  exit 1
fi
echo "✓ Database user '$DB_USER' exists"

echo "Note: Database schema tables will be created automatically by the application on first startup."

echo "Building container image $IMAGE"
gcloud builds submit --tag "$IMAGE" "$SCRIPT_DIR"

echo "Deploying Cloud Run service $SERVICE"

# Prepare CORS_ORIGINS value
CORS_ORIGINS_VALUE="${CORS_ORIGINS:-https://penni-ai.com,http://localhost:5002}"

# Prepare LangSmith values (optional - can be empty)
LANGSMITH_TRACING_VALUE="${LANGSMITH_TRACING:-false}"
LANGSMITH_ENDPOINT_VALUE="${LANGSMITH_ENDPOINT:-}"
LANGSMITH_API_KEY_VALUE="${LANGSMITH_API_KEY:-}"
LANGSMITH_PROJECT_VALUE="${LANGSMITH_PROJECT:-}"

# Use custom delimiter (@) to handle commas in values
# The ^@^ prefix tells gcloud to use @ as the delimiter instead of comma
# This allows values with commas to be properly parsed
ENV_VARS_STRING="^@^GOOGLE_CLOUD_PROJECT=$PROJECT_ID@GOOGLE_CLOUD_REGION=$REGION@CLOUD_SQL_CONNECTION_NAME=$CLOUD_SQL_CONNECTION@POSTGRES_DB=$DB_NAME@POSTGRES_USER=$DB_USER@POSTGRES_PASSWORD=$DB_PASSWORD@FIRESTORE_PROJECT_ID=$PROJECT_ID@FIREBASE_PROJECT_ID=$PROJECT_ID@CHATBOT_SERVICE_NAME=$SERVICE@CORS_ORIGINS=$CORS_ORIGINS_VALUE@VERTEX_MODEL=${VERTEX_MODEL:-gemini-2.5-flash-preview-09-2025}@LANGSMITH_TRACING=$LANGSMITH_TRACING_VALUE@LANGSMITH_ENDPOINT=$LANGSMITH_ENDPOINT_VALUE@LANGSMITH_API_KEY=$LANGSMITH_API_KEY_VALUE@LANGSMITH_PROJECT=$LANGSMITH_PROJECT_VALUE"

gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --allow-unauthenticated \
  --add-cloudsql-instances "$CLOUD_SQL_CONNECTION" \
  --cpu=2 \
  --memory=2Gi \
  --timeout=300 \
  --set-env-vars "$ENV_VARS_STRING"

echo "Deployment complete. Service URL:"
gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)'
