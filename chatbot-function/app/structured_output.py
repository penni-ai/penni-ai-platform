"""Pydantic models for structured output from the analyzer agent."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.json_schema import GenerateJsonSchema


class VertexAICompatibleJsonSchema(GenerateJsonSchema):
    """Custom JSON schema generator that removes null types for Vertex AI compatibility."""
    
    def generate(self, schema: Any, mode: str = "validation") -> Dict[str, Any]:
        """Generate JSON schema and remove null types from anyOf."""
        json_schema = super().generate(schema, mode=mode)
        return self._remove_null_types(json_schema)
    
    def _remove_null_types(self, schema: Dict[str, Any]) -> Dict[str, Any]:
        """Recursively remove null types from anyOf schemas."""
        if isinstance(schema, dict):
            # Process $defs first (definitions that may be referenced)
            if "$defs" in schema:
                schema["$defs"] = {
                    key: self._remove_null_types(value)
                    for key, value in schema["$defs"].items()
                }
            
            # Handle anyOf with null types
            if "anyOf" in schema:
                any_of = schema["anyOf"]
                # Filter out null types and keep only non-null types
                filtered_any_of = [
                    item for item in any_of 
                    if not (isinstance(item, dict) and item.get("type") == "null")
                ]
                
                # If only one type remains, use it directly instead of anyOf
                if len(filtered_any_of) == 1:
                    # Replace anyOf with the single remaining type
                    result = filtered_any_of[0].copy()
                    # Preserve other properties from the original schema (except anyOf)
                    for key, value in schema.items():
                        if key != "anyOf":
                            if key not in result:
                                result[key] = value
                            elif isinstance(value, dict) and isinstance(result.get(key), dict):
                                # Merge nested dicts
                                result[key] = {**result[key], **value}
                    return self._remove_null_types(result)
                elif len(filtered_any_of) > 1:
                    schema["anyOf"] = [self._remove_null_types(item) for item in filtered_any_of]
            
            # Recursively process properties
            if "properties" in schema:
                schema["properties"] = {
                    key: self._remove_null_types(value)
                    for key, value in schema["properties"].items()
                }
            
            # Recursively process items (for arrays)
            if "items" in schema:
                schema["items"] = self._remove_null_types(schema["items"])
            
            # Process allOf, oneOf if present
            for key in ["allOf", "oneOf"]:
                if key in schema:
                    schema[key] = [self._remove_null_types(item) for item in schema[key]]
        
        return schema


class Guidance(BaseModel):
    """Guidance for the speaker agent."""

    ack: str = Field(description="One sentence summary to acknowledge captured information")
    ask: str = Field(description="Question requesting exactly ONE missing field")


class SlotUpdates(BaseModel):
    """Slot updates extracted from the conversation."""

    website: Optional[str] = Field(default=None, description="Business website URL")
    business_name: Optional[str] = Field(default=None, description="Business name")
    business_location: Optional[str] = Field(default=None, description="Business location")
    influencer_location: Optional[str] = Field(default=None, description="Desired influencer location")
    min_followers: Optional[int] = Field(default=None, description="Minimum follower count", ge=0)
    max_followers: Optional[int] = Field(default=None, description="Maximum follower count", ge=0)
    business_about: Optional[str] = Field(default=None, description="Business description/about")
    platform: Optional[List[str]] = Field(default=None, description="Platform(s): must be one or both of 'tiktok' and/or 'instagram' (lowercase)")
    type_of_influencer: Optional[str] = Field(default=None, description="Type of influencer (e.g., lifestyle, food, travel, fashion, tech, etc.)")
    campaign_title: Optional[str] = Field(default=None, description="Campaign title (maximum 5 words)")

    @classmethod
    def model_json_schema(cls, **kwargs):
        """Generate JSON schema compatible with Vertex AI (removes null types)."""
        # Get the base schema from parent class
        base_schema = super().model_json_schema(**kwargs)
        # Remove null types using custom generator
        generator = VertexAICompatibleJsonSchema()
        # The generator needs the core schema, so we'll process the base_schema directly
        return generator._remove_null_types(base_schema)


class AnalyzerOutput(BaseModel):
    """Structured output from the analyzer agent."""

    slot_updates: SlotUpdates = Field(description="Updated slot values extracted from conversation")
    missing_fields: List[str] = Field(description="List of required fields that are still missing")
    guidance: Guidance = Field(description="Guidance for the speaker agent")

    @classmethod
    def model_json_schema(cls, **kwargs):
        """Generate JSON schema compatible with Vertex AI (removes null types)."""
        # Get the base schema from parent class
        base_schema = super().model_json_schema(**kwargs)
        # Remove null types using custom generator
        generator = VertexAICompatibleJsonSchema()
        # The generator needs the core schema, so we'll process the base_schema directly
        return generator._remove_null_types(base_schema)

    model_config = ConfigDict(
        json_schema_extra={
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
    )

