#!/bin/bash
# Local development startup script for penni-chatbot

# Don't exit on error initially (for PostgreSQL setup checks)
set +e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

success() {
    echo -e "${GREEN}✓${NC} $1"
}

warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1"
}

# Check Python version
info "Checking Python version..."
if ! command -v python3 &> /dev/null; then
    error "Python 3 is not installed. Please install Python 3.12 or later."
    exit 1
fi

PYTHON_VERSION=$(python3 --version | cut -d' ' -f2 | cut -d'.' -f1,2)
if [[ $(echo "$PYTHON_VERSION < 3.12" | bc -l 2>/dev/null || echo "0") == "1" ]]; then
    warning "Python 3.12+ recommended. Found: $(python3 --version)"
fi
success "Python $(python3 --version) found"

# Setup virtual environment
VENV_DIR="$SCRIPT_DIR/venv"
if [ ! -d "$VENV_DIR" ]; then
    info "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
    success "Virtual environment created"
else
    success "Virtual environment exists"
fi

# Activate virtual environment
info "Activating virtual environment..."
source "$VENV_DIR/bin/activate"

# Upgrade pip
info "Upgrading pip..."
pip install --quiet --upgrade pip

# Install/upgrade dependencies
info "Installing dependencies..."
if [ -f "requirements.txt" ]; then
    pip install --quiet -r requirements.txt
    success "Dependencies installed"
else
    error "requirements.txt not found"
    exit 1
fi

# Check for .env file
if [ ! -f ".env" ]; then
    warning ".env file not found"
    if [ -f ".env.example" ]; then
        info "Copying .env.example to .env..."
        cp .env.example .env
        warning "Please edit .env file with your configuration before running"
        echo ""
        read -p "Press Enter to continue anyway, or Ctrl+C to exit and configure .env..."
    else
        error ".env.example not found. Please create a .env file with required configuration."
        exit 1
    fi
else
    success ".env file found"
fi

# Check for required environment variables
info "Checking required environment variables..."
source .env 2>/dev/null || true

if [ -z "$GOOGLE_CLOUD_PROJECT" ]; then
    warning "GOOGLE_CLOUD_PROJECT not set in .env"
fi

if [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_DB" ]; then
    warning "PostgreSQL configuration incomplete in .env"
    warning "The application requires POSTGRES_USER and POSTGRES_DB to be set"
fi

# Display configuration
echo ""
info "Configuration:"
echo "  Project: ${GOOGLE_CLOUD_PROJECT:-not set}"
echo "  API Host: ${API_HOST:-0.0.0.0}"
echo "  API Port: ${API_PORT:-8080}"
echo "  Log Level: ${LOG_LEVEL:-INFO}"
echo ""

# PostgreSQL setup using Docker
setup_postgres() {
    local pg_host="${POSTGRES_HOST:-127.0.0.1}"
    local pg_port="${POSTGRES_PORT:-5432}"
    local pg_db="${POSTGRES_DB:-penni-chatbot-db}"
    local pg_user="${POSTGRES_USER:-penni_chatbot_user}"
    local pg_password="${POSTGRES_PASSWORD:-change-me}"
    
    # Skip if using remote PostgreSQL
    if [ "$pg_host" != "127.0.0.1" ] && [ "$pg_host" != "localhost" ]; then
        info "Using remote PostgreSQL at $pg_host:$pg_port"
        if command -v pg_isready &> /dev/null; then
            if pg_isready -h "$pg_host" -p "$pg_port" &> /dev/null; then
                success "PostgreSQL is accessible"
            else
                warning "PostgreSQL may not be running or accessible"
            fi
        fi
        return 0
    fi
    
    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed. Please install Docker to use local PostgreSQL."
        error "Visit: https://docs.docker.com/get-docker/"
        exit 1
    fi
    
    info "Setting up PostgreSQL with Docker..."
    
    local container_name="postgres-dev"
    local docker_image="postgres:15-alpine"
    local docker_user="postgres"
    local docker_password="postgres"
    
    # Check if container exists
    if docker ps -a --format '{{.Names}}' | grep -q "^${container_name}$"; then
        # Container exists, check if running
        if docker ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
            success "PostgreSQL container is already running"
        else
            info "Starting existing PostgreSQL container..."
            docker start "$container_name" > /dev/null 2>&1
            if [ $? -eq 0 ]; then
                success "PostgreSQL container started"
            else
                error "Failed to start PostgreSQL container"
                exit 1
            fi
        fi
    else
        # Create new container with explicit user configuration
        info "Creating PostgreSQL container..."
        docker run -d \
            --name "$container_name" \
            -e POSTGRES_USER="$docker_user" \
            -e POSTGRES_PASSWORD="$docker_password" \
            -e POSTGRES_DB=postgres \
            -p "${pg_port}:5432" \
            "$docker_image" > /dev/null 2>&1
        
        if [ $? -eq 0 ]; then
            success "PostgreSQL container created"
        else
            error "Failed to create PostgreSQL container"
            exit 1
        fi
    fi
    
    # Wait for PostgreSQL to be ready
    info "Waiting for PostgreSQL to be ready..."
    local max_attempts=30
    local attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if docker exec "$container_name" pg_isready -U "$docker_user" > /dev/null 2>&1; then
            success "PostgreSQL is ready"
            break
        fi
        attempt=$((attempt + 1))
        sleep 1
    done
    
    if [ $attempt -eq $max_attempts ]; then
        error "PostgreSQL did not become ready in time"
        error "Check container logs: docker logs $container_name"
        exit 1
    fi
    
    # Always use Docker's default postgres user for local development
    # This is simpler and avoids permission issues
    info "Configuring environment for Docker PostgreSQL..."
    
    # Verify we can connect with the postgres user
    # If not, the container was created incorrectly - recreate it
    local actual_user=""
    if docker exec "$container_name" psql -U "$docker_user" -d postgres -c "SELECT 1;" > /dev/null 2>&1; then
        actual_user="$docker_user"
        success "Verified PostgreSQL user: $actual_user"
    else
        warning "Container exists but 'postgres' user is not available."
        warning "This usually means the container was created without POSTGRES_USER."
        info "Removing existing container to recreate with correct configuration..."
        docker stop "$container_name" > /dev/null 2>&1 || true
        docker rm "$container_name" > /dev/null 2>&1 || true
        
        # Create new container with correct configuration
        info "Creating PostgreSQL container with correct configuration..."
        docker run -d \
            --name "$container_name" \
            -e POSTGRES_USER="$docker_user" \
            -e POSTGRES_PASSWORD="$docker_password" \
            -e POSTGRES_DB=postgres \
            -p "${pg_port}:5432" \
            "$docker_image" > /dev/null 2>&1
        
        if [ $? -eq 0 ]; then
            success "PostgreSQL container recreated"
        else
            error "Failed to recreate PostgreSQL container"
            exit 1
        fi
        
        # Wait for PostgreSQL to be ready again
        info "Waiting for PostgreSQL to be ready..."
        local max_attempts=30
        local attempt=0
        while [ $attempt -lt $max_attempts ]; do
            if docker exec "$container_name" pg_isready -U "$docker_user" > /dev/null 2>&1; then
                success "PostgreSQL is ready"
                break
            fi
            attempt=$((attempt + 1))
            sleep 1
        done
        
        if [ $attempt -eq $max_attempts ]; then
            error "PostgreSQL did not become ready in time"
            exit 1
        fi
        
        actual_user="$docker_user"
        success "Using PostgreSQL user: $actual_user"
    fi
    
    pg_user="$actual_user"
    pg_password="$docker_password"
    
    # Create database if it doesn't exist
    if docker exec "$container_name" psql -U "$actual_user" -d postgres -tc \
        "SELECT 1 FROM pg_database WHERE datname='$pg_db'" 2>/dev/null | grep -q 1; then
        success "Database '$pg_db' already exists"
    else
        info "Creating database: $pg_db"
        docker exec "$container_name" psql -U "$actual_user" -d postgres \
            -c "CREATE DATABASE $pg_db;" > /dev/null 2>&1 && \
        success "Database '$pg_db' created" || {
            error "Could not create database. Check container logs: docker logs $container_name"
            error "Try: docker rm -f $container_name and run this script again"
            exit 1
        }
    fi
    
    success "Database '$pg_db' is ready"
    info "PostgreSQL container: $container_name"
    info "Connection: postgresql://$pg_user:***@127.0.0.1:$pg_port/$pg_db"
    info "Schema tables will be created automatically on first startup"
    
    # Ensure these environment variables are set for the application
    # These will override .env file values
    export POSTGRES_DB="$pg_db"
    export POSTGRES_HOST="127.0.0.1"
    export POSTGRES_PORT="$pg_port"
    export POSTGRES_USER="$pg_user"
    export POSTGRES_PASSWORD="$pg_password"
    # Critical: Unset Cloud SQL connection name for local development
    # This prevents the app from trying to use Unix socket connection
    unset CLOUD_SQL_CONNECTION_NAME
}

# Run PostgreSQL setup
setup_postgres

# Re-enable exit on error for application startup
set -e

# Ensure Cloud SQL connection is disabled for local development
# This must be done after setup_postgres to override any .env values
unset CLOUD_SQL_CONNECTION_NAME

# Start the application
echo ""
success "Starting penni-chatbot..."
info "Server will be available at: http://${API_HOST:-0.0.0.0}:${API_PORT:-8080}"
info "Press Ctrl+C to stop the server"
echo ""

# Convert log level to lowercase (uvicorn requires lowercase)
LOG_LEVEL_LOWER=$(echo "${LOG_LEVEL:-info}" | tr '[:upper:]' '[:lower:]')

# Run the application with environment variables
# Note: Environment variables override .env file values
exec env CLOUD_SQL_CONNECTION_NAME="" python -m uvicorn app.main:app \
    --host "${API_HOST:-0.0.0.0}" \
    --port "${API_PORT:-8080}" \
    --reload \
    --log-level "$LOG_LEVEL_LOWER"

