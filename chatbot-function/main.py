"""Cloud Function v2 entry point for Penni Chatbot."""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict

import functions_framework
from flask import Request, jsonify

from app.chatbot import create_graph_with_checkpointer, extract_text
from app.config import Settings, get_settings
from app.database import MessageStore, get_checkpointer, setup_checkpointer_schema
from app.models import (
    ConversationResponse,
    ConversationSnapshot,
    Message,
    MessageResponse,
)
from app.services import AuthenticationError, FirestoreSync, verify_firebase_token
from app.utils import map_slots_to_collected

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global runtime instance (initialized on first request)
_runtime: Dict[str, Any] | None = None


def _get_runtime() -> Dict[str, Any]:
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
    checkpointer = get_checkpointer()
    graph = create_graph_with_checkpointer(checkpointer, settings)
    
    _runtime = {
        "settings": settings,
        "firestore_sync": firestore_sync,
        "message_store": message_store,
        "checkpointer": checkpointer,
        "graph": graph,
    }
    
    logger.info("Chatbot runtime initialized")
    return _runtime


def _thread_config(uid: str, campaign_id: str) -> Dict[str, Any]:
    """Create thread configuration for LangGraph."""
    return {"configurable": {"thread_id": f"{uid}:{campaign_id}"}}


def _build_snapshot(
    uid: str,
    campaign_id: str,
    state_values: Dict[str, Any],
    message_store: MessageStore,
) -> ConversationSnapshot:
    """Build conversation snapshot from state values."""
    from datetime import datetime
    
    slots = state_values.get("slots") or {}
    missing = state_values.get("missing") or []
    status = state_values.get("status") or "collecting"
    messages = message_store.list_messages(uid, campaign_id)
    
    # Add greeting message if this is a new conversation
    if not messages:
        greeting_text = (
            "Hi! 👋 I'm Penni AI, and I'm here to help you source influencers for your business growth and promotion. "
            "\n\n"
            "Could you tell me about your business? A simple description or website link would be great! 💼"
        )
        message_store.save_message(
            uid=uid,
            campaign_id=campaign_id,
            role="assistant",
            content=greeting_text,
        )
        # Reload messages to include the greeting
        messages = message_store.list_messages(uid, campaign_id)
    
    user_texts = [msg.content for msg in messages if msg.role == "user"]
    collected = map_slots_to_collected(slots, user_texts)
    collected.updatedAt = int(datetime.utcnow().timestamp() * 1000)
    snapshot = ConversationSnapshot(
        id=campaign_id,
        status=status,
        collected=collected,
        missing=missing,
        messages=messages,
    )
    return snapshot


def _invoke_graph(
    graph: Any,
    uid: str,
    campaign_id: str,
    message: str,
) -> tuple[list[Any], Dict[str, Any]]:
    """Invoke the LangGraph workflow."""
    from langchain_core.messages import HumanMessage
    
    config = _thread_config(uid, campaign_id)
    assistant_payloads: list[Any] = []
    
    for event in graph.stream(
        {"messages": [HumanMessage(content=message)]},
        config=config,
        stream_mode="updates",
    ):
        items = getattr(event, "items", None)
        if not callable(items):
            continue
        for _, payload in items():
            values = getattr(payload, "get", None)
            if not callable(values):
                continue
            for msg in values("messages") or []:
                if getattr(msg, "type", None) == "ai":
                    assistant_payloads.append(msg)
    
    state = graph.get_state(config)
    if not state:
        raise RuntimeError("Graph state missing after invocation")
    return assistant_payloads, state.values


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
def chatbot(request: Request) -> tuple[str, int] | tuple[Dict[str, Any], int]:
    """Cloud Function v2 HTTP entry point."""
    try:
        # Get runtime
        runtime = _get_runtime()
        settings = runtime["settings"]
        firestore_sync = runtime["firestore_sync"]
        message_store = runtime["message_store"]
        graph = runtime["graph"]
        
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
                    
                    from uuid import uuid4
                    from datetime import datetime, timezone
                    
                    # Check if this is a new conversation and add greeting if needed
                    existing_messages = message_store.list_messages(uid, campaign_id)
                    if not existing_messages:
                        greeting_text = (
                            "Hi! 👋 I'm Penni AI, and I'm here to help you source influencers for your business growth and promotion. "
                            "I'll guide you through creating a campaign by gathering some details about your business and the type of influencers you're looking for. "
                            "Let's get started! 🚀\n\n"
                            "Could you tell me about your business? A simple description or website link would be great! 💼"
                        )
                        message_store.save_message(
                            uid=uid,
                            campaign_id=campaign_id,
                            role="assistant",
                            content=greeting_text,
                        )
                    
                    turn_id = str(uuid4())
                    
                    # Save user message
                    user_message = message_store.save_message(
                        uid=uid,
                        campaign_id=campaign_id,
                        role="user",
                        content=message_text,
                        turn_id=turn_id,
                    )
                    
                    # Invoke graph
                    assistant_chunks, state_values = _invoke_graph(
                        graph, uid, campaign_id, message_text
                    )
                    
                    # Extract web search sources from state for message footer
                    web_search_sources = state_values.get("web_search_sources", [])
                    message_sources = None
                    if web_search_sources:
                        from app.models import MessageSource
                        message_sources = [
                            MessageSource(url=source.get("url", ""), title=source.get("title"))
                            for source in web_search_sources
                        ]
                    
                    # Save assistant messages
                    assistant_messages: list[Message] = []
                    for chunk in assistant_chunks:
                        text = extract_text(chunk)
                        if not text:
                            continue
                        # Only add sources to the first message chunk
                        sources_to_use = message_sources if not assistant_messages else None
                        assistant_messages.append(
                            message_store.save_message(
                                uid=uid,
                                campaign_id=campaign_id,
                                role="assistant",
                                content=text,
                                turn_id=turn_id,
                                sources=sources_to_use,
                            )
                        )
                    
                    # Build snapshot and sync to Firestore
                    snapshot = _build_snapshot(uid, campaign_id, state_values, message_store)
                    firestore_sync.sync_collected_data(uid, campaign_id, snapshot.collected)
                    firestore_sync.update_campaign_snapshot(uid, campaign_id, snapshot)
                    
                    # Build response
                    response = MessageResponse(
                        campaign_id=campaign_id,
                        user_message=user_message,
                        assistant_messages=assistant_messages,
                        conversation=snapshot,
                    )
                    
                    return jsonify(response.model_dump(by_alias=True)), 200
                    
                except ValueError as exc:
                    return jsonify({"error": str(exc)}), 400
                except Exception as exc:
                    logger.error(f"Error processing message: {exc}", exc_info=True)
                    return jsonify({"error": "Internal server error"}), 500
            
            # Handle GET /conversations/{campaign_id}
            elif method == "GET" and len(parts) == 2:
                try:
                    config = _thread_config(uid, campaign_id)
                    state = graph.get_state(config)
                    state_values = state.values if state else {}
                    snapshot = _build_snapshot(uid, campaign_id, state_values, message_store)
                    
                    response = ConversationResponse(conversation=snapshot)
                    return jsonify(response.model_dump(by_alias=True)), 200
                    
                except Exception as exc:
                    logger.error(f"Error getting conversation: {exc}", exc_info=True)
                    return jsonify({"error": "Internal server error"}), 500
        
        return jsonify({"error": "Not found"}), 404
        
    except Exception as exc:
        logger.error(f"Unhandled error: {exc}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

