"""FastAPI router exposing chatbot endpoints."""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool

from app.config import Settings
from app.models import (
    MessageRequest,
    MessageResponse,
    ConversationResponse,
)
from app.runtime import ChatbotRuntime
from app.services import AuthenticationError, FirestoreSync, verify_firebase_token

router = APIRouter()


_runtime: Optional[ChatbotRuntime] = None


def set_runtime(new_runtime: ChatbotRuntime) -> None:
    global _runtime
    _runtime = new_runtime


def get_runtime() -> ChatbotRuntime:
    if _runtime is None:
        raise RuntimeError("Chatbot runtime is not initialized")
    return _runtime


def get_current_user(request: Request) -> Dict[str, Any]:
    # Check for Firebase token in custom header (used when Cloud Run IAM authentication is present)
    firebase_token_header = request.headers.get("X-Firebase-Token")
    if firebase_token_header:
        token = firebase_token_header
    else:
        # Fall back to Authorization header (for direct calls or emulator)
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
        token = auth_header.split(" ", 1)[1]
    
    try:
        decoded = verify_firebase_token(token)
    except AuthenticationError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    return decoded


@router.post(
    "/conversations/{campaign_id}/messages",
    response_model=MessageResponse,
)
async def post_message_endpoint(
    campaign_id: str,
    payload: MessageRequest,
    user: Dict[str, Any] = Depends(get_current_user),
):
    runtime_instance = get_runtime()
    try:
        response = await run_in_threadpool(
            runtime_instance.process_message,
            user["uid"],
            campaign_id,
            payload.message,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return response


@router.get(
    "/conversations/{campaign_id}",
    response_model=ConversationResponse,
)
async def get_conversation_endpoint(
    campaign_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    runtime_instance = get_runtime()
    response = await run_in_threadpool(
        runtime_instance.get_conversation,
        user["uid"],
        campaign_id,
    )
    return response


def create_runtime(settings: Settings) -> ChatbotRuntime:
    """Create a ChatbotRuntime instance for FastAPI."""
    from app.database import MessageStore
    
    firestore_sync = FirestoreSync(settings.firestore_project)
    message_store = MessageStore()
    logger = logging.getLogger("penni.chatbot")
    return ChatbotRuntime(
        settings=settings,
        firestore_sync=firestore_sync,
        message_store=message_store,
        logger=logger,
    )


__all__ = ["router", "set_runtime", "create_runtime"]
