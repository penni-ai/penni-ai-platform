"""Cloud Function v2 entry point for Penni Chatbot."""

from __future__ import annotations

import logging
from typing import Optional

import functions_framework
from flask import Request, jsonify

from app.config import get_settings
from app.database import MessageStore, setup_checkpointer_schema
from app.models import (
    ConversationResponse,
    MessageResponse,
)
from app.runtime import ChatbotRuntime
from app.services import AuthenticationError, FirestoreSync, verify_firebase_token

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global runtime instance (initialized on first request)
_runtime: Optional[ChatbotRuntime] = None


def _get_runtime() -> ChatbotRuntime:
    """Get or initialize the chatbot runtime."""
    global _runtime
    
    if _runtime is not None:
        return _runtime
    
    logger.info("Initializing chatbot runtime...")
    settings = get_settings()
    
    # Initialize Firestore checkpointer
    setup_checkpointer_schema()
    
    # Create runtime components
    firestore_sync = FirestoreSync(settings.firestore_project)
    message_store = MessageStore()
    
    _runtime = ChatbotRuntime(
        settings=settings,
        firestore_sync=firestore_sync,
        message_store=message_store,
        logger=logger,
    )
    
    logger.info("Chatbot runtime initialized")
    return _runtime


def _get_user_from_request(request: Request) -> Dict[str, Any]:
    """Extract and verify Firebase token from request."""
    # Check for Firebase token in custom header (used when Cloud Function IAM authentication is present)
    firebase_token_header = request.headers.get("X-Firebase-Token")
    if firebase_token_header:
        token = firebase_token_header
    else:
        # Fall back to Authorization header
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise AuthenticationError("Missing bearer token")
        token = auth_header.split(" ", 1)[1]
    
    try:
        decoded = verify_firebase_token(token)
    except AuthenticationError as exc:
        raise AuthenticationError(f"Invalid Firebase token: {exc}") from exc
    return decoded


@functions_framework.http
def chatbot(request: Request) -> tuple[str, int] | tuple[dict, int]:
    """Cloud Function v2 HTTP entry point."""
    try:
        # Get runtime
        runtime = _get_runtime()
        
        # Parse request
        path = request.path.rstrip("/")  # Remove trailing slash but keep leading
        method = request.method
        
        # Route requests
        if method == "GET" and path == "/health":
            return jsonify({"status": "ok"}), 200
        
        # Extract campaign_id from path: /conversations/{campaign_id}/messages or /conversations/{campaign_id}
        if path.startswith("/conversations/"):
            parts = [p for p in path.split("/") if p]  # Split and filter empty parts
            if len(parts) < 2:
                return jsonify({"error": "Invalid path"}), 400
            
            campaign_id = parts[1]
            
            # Authenticate user
            try:
                user = _get_user_from_request(request)
                uid = user["uid"]
            except AuthenticationError as exc:
                return jsonify({"error": str(exc)}), 401
            
            # Handle POST /conversations/{campaign_id}/messages
            if method == "POST" and len(parts) >= 3 and parts[2] == "messages":
                try:
                    data = request.get_json()
                    if not data or "message" not in data:
                        return jsonify({"error": "Missing 'message' in request body"}), 400
                    
                    message_text = data["message"].strip()
                    if not message_text:
                        return jsonify({"error": "Message must not be empty"}), 400
                    
                    # Use shared runtime to process message
                    response = runtime.process_message(uid, campaign_id, message_text)
                    
                    return jsonify(response.model_dump(by_alias=True)), 200
                    
                except ValueError as exc:
                    return jsonify({"error": str(exc)}), 400
                except Exception as exc:
                    logger.error(f"Error processing message: {exc}", exc_info=True)
                    return jsonify({"error": "Internal server error"}), 500
            
            # Handle GET /conversations/{campaign_id}
            elif method == "GET" and len(parts) == 2:
                try:
                    # Use shared runtime to get conversation
                    response = runtime.get_conversation(uid, campaign_id)
                    
                    return jsonify(response.model_dump(by_alias=True)), 200
                    
                except Exception as exc:
                    logger.error(f"Error getting conversation: {exc}", exc_info=True)
                    return jsonify({"error": "Internal server error"}), 500
        
        return jsonify({"error": "Not found"}), 404
        
    except Exception as exc:
        logger.error(f"Unhandled error: {exc}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

