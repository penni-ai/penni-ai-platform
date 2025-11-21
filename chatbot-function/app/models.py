"""Pydantic models shared across the chatbot service."""

from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Literal, Optional, Any, Union
from pydantic import BaseModel, Field, ConfigDict


# Simplifies status: It's either collecting data, or the campaign is ready.
ConversationStatus = Literal["collecting", "ready", "complete", "error"]


class MessageSource(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    title: Optional[str] = None
    url: str
    query: Optional[str] = None


class Message(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str
    role: Literal["assistant", "user", "system", "tool"]  # Added 'tool' for completeness
    content: str
    created_at: datetime = Field(alias="createdAt")
    turn_id: Optional[str] = Field(default=None, alias="turnId")
    type: Optional[str] = Field(default="text")
    sources: List[MessageSource] = Field(default_factory=list)
    sequence: Optional[int] = Field(default=None)


class CollectedData(BaseModel):
    """Final data structure stored in Firestore."""
    model_config = ConfigDict(populate_by_name=True)
    
    website: Optional[str] = None
    business_name: Optional[str] = None
    business_location: Optional[str] = None
    min_followers: Optional[int] = None
    max_followers: Optional[int] = None
    influencer_location: Optional[str] = None
    # Allow list or string to be safe, though list is preferred
    platform: Union[List[str], str, None] = None
    type_of_influencer: Optional[str] = None
    business_about: Optional[str] = None
    campaign_title: Optional[str] = None
    
    updatedAt: int = Field(default_factory=lambda: int(datetime.utcnow().timestamp() * 1000))


class ConversationSnapshot(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str
    status: ConversationStatus
    collected: CollectedData
    messages: List[Message]


# Request/Response models remain mostly the same
class MessageRequest(BaseModel):
    message: str


class MessageResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    campaign_id: str = Field(alias="campaignId")
    user_message: Message = Field(alias="userMessage")
    assistant_messages: List[Message] = Field(alias="assistantMessages")
    conversation: ConversationSnapshot


class ConversationResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    conversation: ConversationSnapshot
