"""FastAPI router exposing chatbot endpoints."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from langchain_core.messages import HumanMessage

from app.chatbot import create_graph_with_checkpointer, extract_text
from app.config import Settings
from app.database import MessageStore, get_checkpointer
from app.models import (
    ConversationResponse,
    ConversationSnapshot,
    Message,
    MessageRequest,
    MessageResponse,
)
from app.services import AuthenticationError, FirestoreSync, verify_firebase_token
from app.utils import map_slots_to_collected

router = APIRouter()


class ChatbotRuntime:
    """Encapsulates chatbot graph + storage dependencies."""

    def __init__(
        self,
        *,
        settings: Settings,
        firestore_sync: FirestoreSync,
        message_store: MessageStore,
        logger: Optional[logging.Logger] = None,
    ) -> None:
        self.settings = settings
        self.firestore_sync = firestore_sync
        self.message_store = message_store
        self.logger = logger or logging.getLogger(__name__)
        self.checkpointer = get_checkpointer()
        self.graph = create_graph_with_checkpointer(self.checkpointer, settings)

    def _thread_config(self, uid: str, campaign_id: str) -> Dict[str, Any]:
        return {"configurable": {"thread_id": f"{uid}:{campaign_id}"}}

    def _build_snapshot(
        self,
        uid: str,
        campaign_id: str,
        state_values: Dict[str, Any],
    ) -> ConversationSnapshot:
        slots = state_values.get("slots") or {}
        field_status = state_values.get("field_status") or {}
        missing = state_values.get("missing") or []
        status = state_values.get("status") or "collecting"
        messages = self.message_store.list_messages(uid, campaign_id)
        user_texts = [msg.content for msg in messages if msg.role == "user"]
        collected = map_slots_to_collected(slots, field_status, user_texts)
        collected.updatedAt = int(datetime.utcnow().timestamp() * 1000)
        snapshot = ConversationSnapshot(
            id=campaign_id,
            status=status,
            collected=collected,
            missing=missing,
            messages=messages,
        )
        return snapshot

    def _sync_firestore(self, uid: str, campaign_id: str, snapshot: ConversationSnapshot) -> None:
        self.firestore_sync.sync_collected_data(uid, campaign_id, snapshot.collected)
        self.firestore_sync.update_campaign_snapshot(uid, campaign_id, snapshot)

    def _invoke_graph(
        self,
        uid: str,
        campaign_id: str,
        message: str,
    ) -> tuple[List[Any], Dict[str, Any]]:
        config = self._thread_config(uid, campaign_id)
        assistant_payloads: List[Any] = []
        for event in self.graph.stream(
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
        state = self.graph.get_state(config)
        if not state:
            raise RuntimeError("Graph state missing after invocation")
        return assistant_payloads, state.values

    def process_message(self, uid: str, campaign_id: str, message: str) -> MessageResponse:
        normalized = message.strip()
        if not normalized:
            raise ValueError("Message must not be empty")
        turn_id = str(uuid4())
        user_message = self.message_store.save_message(
            uid=uid,
            campaign_id=campaign_id,
            role="user",
            content=normalized,
            turn_id=turn_id,
        )
        assistant_chunks, state_values = self._invoke_graph(uid, campaign_id, normalized)
        assistant_messages: List[Message] = []
        for chunk in assistant_chunks:
            text = extract_text(chunk)
            if not text:
                continue
            assistant_messages.append(
                self.message_store.save_message(
                    uid=uid,
                    campaign_id=campaign_id,
                    role="assistant",
                    content=text,
                    turn_id=turn_id,
                )
            )
        snapshot = self._build_snapshot(uid, campaign_id, state_values)
        self._sync_firestore(uid, campaign_id, snapshot)
        return MessageResponse(
            campaign_id=campaign_id,
            user_message=user_message,
            assistant_messages=assistant_messages,
            conversation=snapshot,
        )

    def get_conversation(self, uid: str, campaign_id: str) -> ConversationResponse:
        config = self._thread_config(uid, campaign_id)
        state = self.graph.get_state(config)
        state_values = state.values if state else {}
        snapshot = self._build_snapshot(uid, campaign_id, state_values)
        return ConversationResponse(conversation=snapshot)


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
