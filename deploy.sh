#!/usr/bin/env bash
# Unified deployment script for Penny Platform services
# Deploys chatbot function and pipeline service to Google Cloud

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR="$SCRIPT_DIR"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration variables (can be overridden by environment)
PROJECT_ID=${PROJECT_ID:-${GOOGLE_CLOUD_PROJECT:-penni-ai-platform}}
REGION=${REGION:-${GOOGLE_CLOUD_REGION:-us-central1}}
CHATBOT_FUNCTION_NAME=${CHATBOT_FUNCTION_NAME:-penni-chatbot-function}
PIPELINE_SERVICE_NAME=${PIPELINE_SERVICE_NAME:-pipeline-service}

# Parse command line arguments
DEPLOY_CHATBOT=true
DEPLOY_PIPELINE=true

while [[ $# -gt 0 ]]; do
    case $1 in
        --chatbot-only)
            DEPLOY_PIPELINE=false
            shift
            ;;
        --pipeline-only)
            DEPLOY_CHATBOT=false
            shift
            ;;
        --project=*)
            PROJECT_ID="${1#*=}"
            shift
            ;;
        --region=*)
            REGION="${1#*=}"
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --chatbot-only      Deploy only the chatbot function"
            echo "  --pipeline-only     Deploy only the pipeline service"
            echo "  --project=PROJECT   Set GCP project ID"
            echo "  --region=REGION     Set GCP region (default: us-central1)"
            echo "  --help              Show this help message"
            echo ""
            echo "Environment variables:"
            echo "  PROJECT_ID or GOOGLE_CLOUD_PROJECT  GCP project ID"
            echo "  REGION or GOOGLE_CLOUD_REGION       GCP region"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Validate project ID
if [[ -z "$PROJECT_ID" ]]; then
    echo -e "${RED}Error: PROJECT_ID is required.${NC}"
    echo "Set PROJECT_ID or GOOGLE_CLOUD_PROJECT environment variable, or use --project=PROJECT_ID"
    exit 1
fi

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Penny Platform Deployment${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Project ID: $PROJECT_ID"
echo "Region: $REGION"
echo ""
echo "Services to deploy:"
if [[ "$DEPLOY_CHATBOT" == "true" ]]; then
    echo "  ✓ Chatbot Function: $CHATBOT_FUNCTION_NAME"
fi
if [[ "$DEPLOY_PIPELINE" == "true" ]]; then
    echo "  ✓ Pipeline Service: $PIPELINE_SERVICE_NAME"
fi
echo ""

# Set active GCP project
echo -e "${BLUE}Setting active GCP project...${NC}"
gcloud config set project "$PROJECT_ID" >/dev/null

# Check for required tools
echo -e "${BLUE}Checking prerequisites...${NC}"
MISSING_TOOLS=()

if ! command -v gcloud &> /dev/null; then
    MISSING_TOOLS+=("gcloud")
fi

if [[ "$DEPLOY_PIPELINE" == "true" ]] && ! command -v docker &> /dev/null; then
    MISSING_TOOLS+=("docker")
fi

if [[ ${#MISSING_TOOLS[@]} -gt 0 ]]; then
    echo -e "${RED}Error: Missing required tools: ${MISSING_TOOLS[*]}${NC}"
    exit 1
fi

echo -e "${GREEN}✓ All prerequisites met${NC}"
echo ""

# Deploy Chatbot Function
if [[ "$DEPLOY_CHATBOT" == "true" ]]; then
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Deploying Chatbot Function${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    
    CHATBOT_DIR="$ROOT_DIR/chatbot-function"
    if [[ ! -d "$CHATBOT_DIR" ]]; then
        echo -e "${RED}Error: Chatbot function directory not found at $CHATBOT_DIR${NC}"
        exit 1
    fi
    
    cd "$CHATBOT_DIR"
    
    # Check if deploy.sh exists and is executable
    if [[ -f "deploy.sh" ]]; then
        chmod +x deploy.sh
        echo "Running chatbot deploy script..."
        PROJECT_ID="$PROJECT_ID" REGION="$REGION" ./deploy.sh
    else
        echo -e "${RED}Error: deploy.sh not found in chatbot-function directory${NC}"
        exit 1
    fi
    
    echo ""
    echo -e "${GREEN}✓ Chatbot function deployment complete${NC}"
    echo ""
fi

# Deploy Pipeline Service
if [[ "$DEPLOY_PIPELINE" == "true" ]]; then
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Deploying Pipeline Service${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
    
    PIPELINE_DIR="$ROOT_DIR/services/pipeline-service"
    if [[ ! -d "$PIPELINE_DIR" ]]; then
        echo -e "${RED}Error: Pipeline service directory not found at $PIPELINE_DIR${NC}"
        exit 1
    fi
    
    cd "$PIPELINE_DIR"
    
    # Check if deploy.sh exists and is executable
    if [[ -f "deploy.sh" ]]; then
        chmod +x deploy.sh
        echo "Running pipeline service deploy script..."
        PROJECT_ID="$PROJECT_ID" REGION="$REGION" ./deploy.sh
    else
        echo -e "${RED}Error: deploy.sh not found in pipeline-service directory${NC}"
        exit 1
    fi
    
    echo ""
    echo -e "${GREEN}✓ Pipeline service deployment complete${NC}"
    echo ""
fi

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}Deployment Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

if [[ "$DEPLOY_CHATBOT" == "true" ]]; then
    echo -e "${GREEN}Chatbot Function:${NC}"
    CHATBOT_URL=$(gcloud functions describe "$CHATBOT_FUNCTION_NAME" \
        --gen2 \
        --region="$REGION" \
        --format='value(serviceConfig.uri)' 2>/dev/null || echo "Not found")
    if [[ -n "$CHATBOT_URL" && "$CHATBOT_URL" != "Not found" ]]; then
        echo "  URL: $CHATBOT_URL"
    else
        echo -e "  ${YELLOW}⚠ Could not retrieve URL${NC}"
    fi
    echo ""
fi

if [[ "$DEPLOY_PIPELINE" == "true" ]]; then
    echo -e "${GREEN}Pipeline Service:${NC}"
    PIPELINE_URL=$(gcloud run services describe "$PIPELINE_SERVICE_NAME" \
        --region="$REGION" \
        --format='value(status.url)' 2>/dev/null || echo "Not found")
    if [[ -n "$PIPELINE_URL" && "$PIPELINE_URL" != "Not found" ]]; then
        echo "  URL: $PIPELINE_URL"
        echo "  Health: $PIPELINE_URL/health"
    else
        echo -e "  ${YELLOW}⚠ Could not retrieve URL${NC}"
    fi
    echo ""
fi

echo -e "${GREEN}All deployments completed successfully!${NC}"
echo ""
echo "Note: Both services run on Google Cloud's managed infrastructure."
echo "      No port conflicts occur as they use different service endpoints."

