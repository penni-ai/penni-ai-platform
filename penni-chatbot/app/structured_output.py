"""Pydantic models for structured output from the analyzer agent."""

from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class Guidance(BaseModel):
    """Guidance for the speaker agent."""

    ack: str = Field(description="One sentence summary to acknowledge captured information")
    ask: str = Field(description="Question requesting exactly ONE missing field")


class SlotUpdates(BaseModel):
    """Slot updates extracted from the conversation."""

    website: Optional[str] = Field(default=None, description="Business website URL")
    business_location: Optional[str] = Field(default=None, description="Business location")
    influencer_location: Optional[str] = Field(default=None, description="Desired influencer location")
    min_followers: Optional[int] = Field(default=None, description="Minimum follower count", ge=0)
    max_followers: Optional[int] = Field(default=None, description="Maximum follower count", ge=0)
    business_about: Optional[str] = Field(default=None, description="Business description/about")
    influencerTypes: Optional[str] = Field(default=None, description="Type of influencers sought")
    keywords: Optional[List[str]] = Field(default=None, description="Relevant keywords")
    campaign_title: Optional[str] = Field(default=None, description="Campaign title")
    influencer_search_query: Optional[str] = Field(default=None, description="Influencer search query")


class AnalyzerOutput(BaseModel):
    """Structured output from the analyzer agent."""

    slot_updates: SlotUpdates = Field(description="Updated slot values extracted from conversation")
    missing_fields: List[str] = Field(description="List of required fields that are still missing")
    guidance: Guidance = Field(description="Guidance for the speaker agent")

    class Config:
        """Pydantic configuration."""
        json_schema_extra = {
            "example": {
                "slot_updates": {
                    "website": "https://example.com",
                    "business_location": "Austin, TX",
                    "influencer_location": "Los Angeles, CA",
                    "min_followers": 25000,
                    "max_followers": 250000,
                },
                "missing_fields": ["website"],
                "guidance": {
                    "ack": "Great! I've noted your location preferences.",
                    "ask": "What's your business website?",
                },
            }
        }

