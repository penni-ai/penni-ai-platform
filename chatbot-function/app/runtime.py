"""Shared chatbot runtime module for FastAPI and Cloud Function entrypoints."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

from langchain_core.messages import HumanMessage

from app.chatbot import create_graph_with_checkpointer, extract_text
from app.config import Settings
from app.database import MessageStore, get_checkpointer
from app.models import (
    ConversationResponse,
    ConversationSnapshot,
    Message,
    MessageResponse,
)
from app.services import FirestoreSync
from app.utils import map_slots_to_collected


def ensure_greeting_message(uid: str, campaign_id: str, message_store: MessageStore) -> None:
    """Ensure a greeting message exists for a conversation.
    
    Checks if the conversation has any messages, and if not, saves a greeting message.
    This should be called before processing the first user message or when fetching
    a conversation for the first time.
    """
    messages = message_store.list_messages(uid, campaign_id)
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


class ChatbotRuntime:
    """Encapsulates chatbot graph + storage dependencies for shared use across entrypoints."""

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
        """Create thread configuration for LangGraph."""
        return {"configurable": {"thread_id": f"{uid}:{campaign_id}"}}

    def _build_snapshot(
        self,
        uid: str,
        campaign_id: str,
        state_values: Dict[str, Any],
    ) -> ConversationSnapshot:
        """Build conversation snapshot from state values."""
        # 1. Get Slots (The Agent puts them in 'slots' when tool is called)
        slots = state_values.get("slots") or {}
        
        # 2. Determine Status
        # In the new graph, 'status' is set to 'ready' explicitly when tool is called
        status = state_values.get("status") or "collecting"
        
        # 3. Get History
        messages = self.message_store.list_messages(uid, campaign_id)
        
        # 4. Map Data
        collected = map_slots_to_collected(slots)
        collected.updatedAt = int(datetime.utcnow().timestamp() * 1000)
        
        snapshot = ConversationSnapshot(
            id=campaign_id,
            status=status,
            collected=collected,
            messages=messages,
        )
        return snapshot

    def _sync_firestore(self, uid: str, campaign_id: str, snapshot: ConversationSnapshot) -> None:
        """Sync conversation snapshot to Firestore."""
        self.firestore_sync.sync_collected_data(uid, campaign_id, snapshot.collected)
        self.firestore_sync.update_campaign_snapshot(uid, campaign_id, snapshot)

    def _invoke_graph(
        self,
        uid: str,
        campaign_id: str,
        message: str,
    ) -> tuple[List[Any], Dict[str, Any]]:
        """Invoke the LangGraph workflow."""
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
        """Process a user message and return the response."""
        normalized = message.strip()
        if not normalized:
            raise ValueError("Message must not be empty")
        
        # Ensure greeting message exists if this is a new conversation
        ensure_greeting_message(uid, campaign_id, self.message_store)
        
        turn_id = str(uuid4())
        user_message = self.message_store.save_message(
            uid=uid,
            campaign_id=campaign_id,
            role="user",
            content=normalized,
            turn_id=turn_id,
        )
        assistant_chunks, state_values = self._invoke_graph(uid, campaign_id, normalized)
        
        # Extract web search sources from state for message footer
        web_search_sources = state_values.get("web_search_sources", [])
        message_sources = None
        if web_search_sources:
            from app.models import MessageSource
            message_sources = [
                MessageSource(url=source.get("url", ""), title=source.get("title"))
                for source in web_search_sources
            ]
        
        assistant_messages: List[Message] = []
        for chunk in assistant_chunks:
            text = extract_text(chunk)
            if not text:
                continue
            # Only add sources to the first message chunk
            sources_to_use = message_sources if not assistant_messages else None
            assistant_messages.append(
                self.message_store.save_message(
                    uid=uid,
                    campaign_id=campaign_id,
                    role="assistant",
                    content=text,
                    turn_id=turn_id,
                    sources=sources_to_use,
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
        """Get the current conversation state."""
        # Ensure greeting message exists if this is a new conversation
        ensure_greeting_message(uid, campaign_id, self.message_store)
        
        config = self._thread_config(uid, campaign_id)
        state = self.graph.get_state(config)
        state_values = state.values if state else {}
        snapshot = self._build_snapshot(uid, campaign_id, state_values)
        return ConversationResponse(conversation=snapshot)

