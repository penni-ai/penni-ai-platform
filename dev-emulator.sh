#!/usr/bin/env bash
# Consolidated script to run Firebase emulator + chatbot function together for local development

set -e

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR="$SCRIPT_DIR"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting local development environment...${NC}"
echo ""

# Function to kill processes on specific ports
kill_port() {
    local port=$1
    local pids=$(lsof -ti:$port 2>/dev/null)
    if [ -n "$pids" ]; then
        echo -e "${YELLOW}Killing process on port $port...${NC}"
        echo "$pids" | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
}

# Kill processes on all emulator ports before starting
echo -e "${BLUE}Cleaning up ports...${NC}"
kill_port 5002  # Svelte App (App Hosting)
kill_port 6200  # Firebase Functions
kill_port 6201  # Firestore Emulator
kill_port 6202  # Emulator UI
kill_port 9100  # Auth Emulator
kill_port 8080  # Chatbot Function
kill_port 8081  # Pipeline Service
echo ""

# Check if Firebase CLI is installed
if ! command -v firebase &> /dev/null; then
    echo -e "${RED}Error: Firebase CLI not found. Install with: npm install -g firebase-tools${NC}"
    exit 1
fi

# Check if chatbot venv exists and has functions-framework
CHATBOT_VENV="$ROOT_DIR/chatbot-function/venv"
if [ ! -d "$CHATBOT_VENV" ]; then
    echo -e "${RED}Error: Chatbot venv not found at $CHATBOT_VENV${NC}"
    echo -e "${RED}Create it with: cd chatbot-function && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt${NC}"
    exit 1
fi

if [ ! -f "$CHATBOT_VENV/bin/functions-framework" ]; then
    echo -e "${RED}Error: functions-framework not found in venv. Install dependencies with:${NC}"
    echo -e "${RED}cd chatbot-function && source venv/bin/activate && pip install -r requirements.txt${NC}"
    exit 1
fi

# Check if Stripe CLI is installed (optional, for webhook forwarding)
STRIPE_AVAILABLE=false
if command -v stripe &> /dev/null; then
    STRIPE_AVAILABLE=true
else
    echo -e "${YELLOW}Warning: Stripe CLI not found. Webhook forwarding will be skipped.${NC}"
    echo -e "${YELLOW}Install with: brew install stripe/stripe-cli/stripe${NC}"
fi

# Function to cleanup on exit
cleanup() {
    echo ""
    echo -e "${BLUE}Shutting down...${NC}"
    # Stop Docker container if running
    if [ -n "${PIPELINE_CONTAINER:-}" ] && docker ps --format '{{.Names}}' | grep -q "^${PIPELINE_CONTAINER}$"; then
        echo -e "${BLUE}Stopping pipeline service container...${NC}"
        docker stop "$PIPELINE_CONTAINER" > /dev/null 2>&1 || true
    fi
    # Kill all background jobs
    jobs -p | xargs -r kill 2>/dev/null || true
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# Initialize variables
PIPELINE_CONTAINER=""

# Start Firebase emulator in background (including apphosting for Svelte app)
echo -e "${GREEN}Starting Firebase emulator...${NC}"
cd "$ROOT_DIR"
firebase emulators:start --import=./firestore-export --export-on-exit > /tmp/firebase-emulator.log 2>&1 &
FIREBASE_PID=$!

# Wait for Firebase emulator to start
echo -e "${BLUE}Waiting for Firebase emulator to start...${NC}"
sleep 5

# Check if emulator started successfully
if ! kill -0 $FIREBASE_PID 2>/dev/null; then
    echo -e "${RED}Error: Firebase emulator failed to start. Check /tmp/firebase-emulator.log${NC}"
    exit 1
fi

# Start chatbot function in background with emulator environment variables
echo -e "${GREEN}Starting chatbot function (port 8080)...${NC}"
cd "$ROOT_DIR/chatbot-function"

# Load .env if it exists
if [ -f ".env" ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Set emulator environment variables for chatbot function
export FIRESTORE_EMULATOR_HOST="127.0.0.1:6201"
export FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9100"
export FIREBASE_FUNCTIONS_EMULATOR_ORIGIN="http://127.0.0.1:6200"

# Ensure GOOGLE_CLOUD_PROJECT is set
if [ -z "$GOOGLE_CLOUD_PROJECT" ]; then
    echo -e "${YELLOW}Warning: GOOGLE_CLOUD_PROJECT not set. Using default: demo-test${NC}"
    export GOOGLE_CLOUD_PROJECT="demo-test"
fi

"$CHATBOT_VENV/bin/functions-framework" --target=chatbot --port=8080 --debug > /tmp/chatbot-function.log 2>&1 &
CHATBOT_PID=$!

# Wait a moment for chatbot to start
sleep 2

# Check if chatbot started successfully
if ! kill -0 $CHATBOT_PID 2>/dev/null; then
    echo -e "${RED}Error: Chatbot function failed to start. Check /tmp/chatbot-function.log${NC}"
    kill $FIREBASE_PID 2>/dev/null || true
    exit 1
fi

# Start pipeline service in Docker
echo -e "${GREEN}Starting pipeline service in Docker (port 8081)...${NC}"
PIPELINE_DIR="$ROOT_DIR/services/pipeline-service"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker not found. Install Docker to run pipeline service.${NC}"
    echo -e "${YELLOW}Continuing without pipeline service...${NC}"
    PIPELINE_CONTAINER=""
else
    cd "$PIPELINE_DIR"
    
    # Stop and remove existing container if it exists
    if docker ps -a --format '{{.Names}}' | grep -q "^pipeline-service$"; then
        echo -e "${BLUE}Stopping existing pipeline-service container...${NC}"
        docker stop pipeline-service > /dev/null 2>&1 || true
        docker rm pipeline-service > /dev/null 2>&1 || true
    fi
    
    # Build Docker image
    echo -e "${BLUE}Building pipeline service Docker image...${NC}"
    docker build -t pipeline-service:local . > /tmp/pipeline-service-build.log 2>&1
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Error: Failed to build pipeline service Docker image. Check /tmp/pipeline-service-build.log${NC}"
        echo -e "${YELLOW}Continuing without pipeline service...${NC}"
        PIPELINE_CONTAINER=""
    else
        # Check if .env file exists
        ENV_FILE_FLAG=""
        if [ -f ".env" ]; then
            ENV_FILE_FLAG="--env-file .env"
        else
            echo -e "${YELLOW}Warning: .env file not found in pipeline-service directory. Some environment variables may be missing.${NC}"
        fi
        
        # Start container with emulator configuration
        # Use --env-file to load all variables from .env if it exists, then override with -e for emulator-specific settings
        echo -e "${BLUE}Starting pipeline service container...${NC}"
        docker run -d \
            --name pipeline-service \
            --rm \
            -p 8081:8080 \
            $ENV_FILE_FLAG \
            -e PORT=8080 \
            -e NODE_ENV=development \
            -e FIRESTORE_EMULATOR_HOST="host.docker.internal:6201" \
            -e FIREBASE_AUTH_EMULATOR_HOST="host.docker.internal:9100" \
            -e GOOGLE_CLOUD_PROJECT="penni-ai-platform" \
            -e FIREBASE_PROJECT_ID="penni-ai-platform" \
            --add-host=host.docker.internal:host-gateway \
            pipeline-service:local > /tmp/pipeline-service.log 2>&1
        
        if [ $? -eq 0 ]; then
            PIPELINE_CONTAINER="pipeline-service"
            echo -e "${GREEN}Pipeline service container started${NC}"
            
            # Wait a moment for service to start
            sleep 3
            
            # Check if container is running
            if ! docker ps --format '{{.Names}}' | grep -q "^pipeline-service$"; then
                echo -e "${RED}Error: Pipeline service container failed to start. Check logs: docker logs pipeline-service${NC}"
                PIPELINE_CONTAINER=""
            fi
        else
            echo -e "${RED}Error: Failed to start pipeline service container. Check /tmp/pipeline-service.log${NC}"
            PIPELINE_CONTAINER=""
        fi
    fi
fi

# Start Stripe webhook listener if available
STRIPE_PID=""
if [ "$STRIPE_AVAILABLE" = true ]; then
    echo -e "${GREEN}Starting Stripe webhook listener...${NC}"
    stripe listen --forward-to localhost:5002/api/public/billing/webhook > /tmp/stripe-webhook.log 2>&1 &
    STRIPE_PID=$!
    sleep 1
    
    # Check if Stripe started successfully
    if ! kill -0 $STRIPE_PID 2>/dev/null; then
        echo -e "${YELLOW}Warning: Stripe webhook listener failed to start. Check /tmp/stripe-webhook.log${NC}"
        STRIPE_PID=""
    fi
fi

echo ""
echo -e "${GREEN}✓ Development environment started!${NC}"
echo ""
echo "Services running:"
echo "  - Svelte App (App Hosting): http://127.0.0.1:5002"
echo "  - Firebase Functions: http://localhost:6200"
echo "  - Firestore Emulator: http://localhost:6201"
echo "  - Auth Emulator: http://localhost:9100"
echo "  - Chatbot Function: http://localhost:8080"
if [ -n "${PIPELINE_CONTAINER:-}" ]; then
    echo "  - Pipeline Service (Docker): http://localhost:8081"
fi
if [ -n "$STRIPE_PID" ]; then
    echo "  - Stripe Webhook Listener: forwarding to http://localhost:5002/api/public/billing/webhook"
fi
echo "  - Emulator UI: http://localhost:6202"
echo ""
echo "Logs:"
echo "  - Firebase emulator: /tmp/firebase-emulator.log"
echo "  - Chatbot function: /tmp/chatbot-function.log"
if [ -n "${PIPELINE_CONTAINER:-}" ]; then
    echo "  - Pipeline service (Docker): docker logs -f pipeline-service"
fi
if [ -n "$STRIPE_PID" ]; then
    echo "  - Stripe webhook: /tmp/stripe-webhook.log"
fi
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for all background processes
wait

