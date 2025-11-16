"""Firestore checkpointer and message storage."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import List, Optional, Sequence
from uuid import uuid4

from langchain_core.messages import AIMessage, HumanMessage
from langchain_google_firestore import FirestoreChatMessageHistory
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph_checkpoint_firestore import FirestoreSaver
from google.cloud import firestore

from app.config import get_settings
from app.models import Message, MessageSource

logger = logging.getLogger(__name__)

# ============================================================================
# Checkpointer (Firestore)
# ============================================================================

_CHECKPOINTER: Optional[BaseCheckpointSaver] = None


def setup_checkpointer_schema() -> None:
    """Initialize Firestore checkpointer.
    
    FirestoreSaver doesn't require explicit schema setup.
    The checkpointer will create collections/documents as needed.
    """
    settings = get_settings()
    try:
        checkpointer = get_checkpointer()
        logger.info("FirestoreSaver initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize FirestoreSaver: {e}", exc_info=True)
        raise


def get_checkpointer() -> BaseCheckpointSaver:
    """Return global Firestore checkpointer."""
    global _CHECKPOINTER
    
    if _CHECKPOINTER is not None:
        return _CHECKPOINTER
    
    settings = get_settings()
    
    if not settings.google_cloud_project:
        raise RuntimeError(
            "Google Cloud Project configuration is required. "
            "Set GOOGLE_CLOUD_PROJECT environment variable."
        )
    
    # Check if Firestore emulator is configured
    # FIRESTORE_EMULATOR_HOST is set by Firebase emulator (format: "host:port")
    emulator_host = os.environ.get("FIRESTORE_EMULATOR_HOST")
    if emulator_host:
        logger.info(f"Using Firestore emulator at {emulator_host}")
        # FirestoreSaver will automatically use the emulator when FIRESTORE_EMULATOR_HOST is set
    
    # FirestoreSaver uses the default Firestore client (via Application Default Credentials)
    # It will create collections in Firestore for storing checkpoints
    _CHECKPOINTER = FirestoreSaver(
        project_id=settings.google_cloud_project,
        checkpoints_collection="langgraph_checkpoints",
    )
    logger.info(f"FirestoreSaver initialized for project: {settings.google_cloud_project}")
    return _CHECKPOINTER


# ============================================================================
# Message Store (Firestore)
# ============================================================================

class MessageStore:
    """Message store using FirestoreChatMessageHistory."""
    
    def __init__(self) -> None:
        self.settings = get_settings()
        if not self.settings.google_cloud_project:
            raise RuntimeError("GOOGLE_CLOUD_PROJECT must be set for Firestore message storage")
        
        # Create Firestore client (will use emulator if FIRESTORE_EMULATOR_HOST is set)
        emulator_host = os.environ.get("FIRESTORE_EMULATOR_HOST")
        if emulator_host:
            logger.debug(f"Using Firestore emulator at {emulator_host} for message history")
        self.firestore_client = firestore.Client(project=self.settings.google_cloud_project)

    def _get_history(self, uid: str, campaign_id: str) -> FirestoreChatMessageHistory:
        """Get Firestore chat message history for a conversation."""
        # Use a composite session ID combining uid and campaign_id
        session_id = f"{uid}:{campaign_id}"
        
        return FirestoreChatMessageHistory(
            session_id=session_id,
            collection="chat_messages",
            client=self.firestore_client,
        )

    def save_message(
        self,
        *,
        uid: str,
        campaign_id: str,
        role: str,
        content: str,
        turn_id: Optional[str] = None,
        message_type: str = "text",
        sources: Optional[Sequence[MessageSource]] = None,
    ) -> Message:
        """Save a message to Firestore."""
        history = self._get_history(uid, campaign_id)
        
        # Convert to LangChain message format
        if role == "user":
            langchain_msg = HumanMessage(content=content)
        elif role == "assistant":
            langchain_msg = AIMessage(content=content)
        else:
            raise ValueError(f"Invalid role: {role}")
        
        # Add message to history
        history.add_message(langchain_msg)
        
        # Convert back to our Message model
        # Note: FirestoreChatMessageHistory doesn't store our custom fields (turn_id, sources, etc.)
        # We'll need to store these separately or extend the message metadata
        # For now, we'll create a Message with basic fields
        created_at = datetime.now(tz=timezone.utc)
        
        # Get the last message from history to extract any metadata
        messages = history.messages
        if messages:
            last_msg = messages[-1]
            # Try to extract ID from message if available
            # LangChain messages may have id in additional_kwargs or as an attribute
            message_id = None
            if hasattr(last_msg, "id") and last_msg.id:
                message_id = str(last_msg.id)
            elif hasattr(last_msg, "additional_kwargs") and last_msg.additional_kwargs.get("id"):
                message_id = str(last_msg.additional_kwargs.get("id"))
            
            # Fallback to UUID if no ID found
            if not message_id:
                message_id = str(uuid4())
        else:
            message_id = str(uuid4())
        
        # Store sources separately in Firestore if provided
        # Use the message index as a fallback identifier if ID is not reliable
        if sources:
            # Store with both message_id and sequence number for reliable retrieval
            sequence_num = len(messages) - 1 if messages else 0
            self._store_message_sources(uid, campaign_id, str(message_id), sources, sequence_num)
        
        return Message(
            id=message_id,
            role=role,
            content=content,
            type=message_type,
            created_at=created_at,
            turn_id=turn_id,
            sources=list(sources) if sources else [],
            sequence=len(messages) - 1 if messages else 0,
        )
    
    def _store_message_sources(self, uid: str, campaign_id: str, message_id: str, sources: Sequence[MessageSource], sequence: int) -> None:
        """Store message sources separately in Firestore."""
        try:
            # Store sources in a subcollection keyed by sequence number for reliable retrieval
            # Format: chat_sessions/{session_id}/message_sources/{sequence}
            session_id = f"{uid}:{campaign_id}"
            sources_ref = (
                self.firestore_client.collection("chat_sessions")
                .document(session_id)
                .collection("message_sources")
                .document(str(sequence))
            )
            sources_ref.set({
                "message_id": message_id,
                "sources": [
                    {
                        "url": source.url,
                        "title": source.title,
                        "query": source.query,
                    }
                    for source in sources
                ]
            }, merge=True)
        except Exception as e:
            logger.warning(f"Failed to store message sources: {e}", exc_info=True)
    
    def _get_message_sources(self, uid: str, campaign_id: str, sequence: int) -> List[MessageSource]:
        """Retrieve message sources from Firestore by sequence number."""
        try:
            session_id = f"{uid}:{campaign_id}"
            sources_ref = (
                self.firestore_client.collection("chat_sessions")
                .document(session_id)
                .collection("message_sources")
                .document(str(sequence))
            )
            doc = sources_ref.get()
            if doc.exists:
                data = doc.to_dict()
                sources_data = data.get("sources", [])
                return [
                    MessageSource(
                        url=source.get("url", ""),
                        title=source.get("title"),
                        query=source.get("query"),
                    )
                    for source in sources_data
                ]
        except Exception as e:
            logger.warning(f"Failed to retrieve message sources: {e}", exc_info=True)
        return []

    def list_messages(self, uid: str, campaign_id: str) -> List[Message]:
        """List all messages for a conversation."""
        history = self._get_history(uid, campaign_id)
        messages = history.messages
        
        result = []
        for idx, langchain_msg in enumerate(messages):
            # Extract content
            content = ""
            if hasattr(langchain_msg, "content"):
                content = str(langchain_msg.content)
            
            # Determine role
            role = "user"
            if isinstance(langchain_msg, AIMessage):
                role = "assistant"
            elif isinstance(langchain_msg, HumanMessage):
                role = "user"
            
            # Extract metadata if available
            message_id = getattr(langchain_msg, "id", None) or str(uuid4())
            created_at = getattr(langchain_msg, "created_at", None)
            if not created_at:
                created_at = datetime.now(tz=timezone.utc)
            
            # Retrieve sources from Firestore if this is an assistant message
            # Use sequence number for reliable retrieval
            sources = []
            if role == "assistant":
                sources = self._get_message_sources(uid, campaign_id, idx)
            
            # Convert to our Message model
            result.append(
                Message(
                    id=str(message_id),
                    role=role,
                    content=content,
                    type="text",
                    created_at=created_at if isinstance(created_at, datetime) else datetime.now(tz=timezone.utc),
                    turn_id=None,  # FirestoreChatMessageHistory doesn't store this
                    sources=sources,
                    sequence=idx,
                )
            )
        
        return result

