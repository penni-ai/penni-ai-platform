"""Pydantic models shared across the chatbot service."""

from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, ConfigDict

FieldStatus = Literal["not_collected", "collected"]
ConversationStatus = Literal[
    "collecting",
    "ready",
    "searching",
    "complete",
    "needs_config",
    "error",
]


class MessageSource(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    title: Optional[str] = None
    url: str
    query: Optional[str] = None


class Message(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str
    role: Literal["assistant", "user"]
    content: str
    type: Optional[str] = None
    created_at: datetime = Field(alias="createdAt")
    turn_id: Optional[str] = Field(default=None, alias="turnId")
    sources: List[MessageSource] = Field(default_factory=list)
    sequence: Optional[int] = None


class CollectedData(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    website: Optional[str] = None
    business_name: Optional[str] = None
    business_location: Optional[str] = None
    min_followers: Optional[int] = None
    max_followers: Optional[int] = None
    influencer_location: Optional[str] = None
    platform: Optional[str] = None
    type_of_influencer: Optional[str] = None
    business_about: Optional[str] = None
    campaign_title: Optional[str] = None
    fieldStatus: Dict[str, FieldStatus] = Field(default_factory=dict)
    updatedAt: int = Field(default_factory=lambda: int(datetime.utcnow().timestamp() * 1000))


class ConversationSnapshot(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str
    status: ConversationStatus
    collected: CollectedData
    missing: List[str]
    messages: List[Message]


class MessageRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
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

