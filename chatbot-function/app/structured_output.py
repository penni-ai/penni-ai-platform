"""Pydantic models for the Agent's Tools."""

from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel, Field
from pydantic.json_schema import GenerateJsonSchema


class VertexAICompatibleJsonSchema(GenerateJsonSchema):
    """Custom JSON schema generator that removes null types for Vertex AI compatibility."""
    
    def generate(self, schema, mode: str = "validation"):
        """Generate JSON schema and remove null types from anyOf."""
        json_schema = super().generate(schema, mode)
        return self._remove_null_types(json_schema)
    
    def _remove_null_types(self, schema):
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


class CampaignDetails(BaseModel):
    """
    Call this tool ONLY when you have collected ALL required information.
    
    INSTRUCTIONS:
    - If the user says they don't have a website, set website to 'N/A'.
    - If the user says 'remote', set business_location to 'Remote'.
    - Infer campaign_title from the conversation context (e.g. 'Austin Coffee Launch').
    """
    
    business_name: str = Field(description="Name of the business")
    website: str = Field(description="Business website URL. Use 'N/A' if they don't have one.")
    business_location: str = Field(description="City/Region of the business")
    influencer_location: str = Field(description="City/Region where influencers should be based")
    min_followers: int = Field(description="Minimum follower count (integer)")
    max_followers: int = Field(description="Maximum follower count (integer)")
    platform: List[str] = Field(description="List of platforms (e.g. ['instagram', 'tiktok'])")
    type_of_influencer: str = Field(description="Niche (e.g. 'food', 'lifestyle', 'tech')")
    campaign_title: str = Field(description="A short title for the campaign (max 5 words)")
    business_about: Optional[str] = Field(default=None, description="Brief description of the business if mentioned")
    
    @classmethod
    def model_json_schema(cls, **kwargs):
        """Generate JSON schema compatible with Vertex AI (removes null types)."""
        base_schema = super().model_json_schema(**kwargs)
        generator = VertexAICompatibleJsonSchema()
        return generator._remove_null_types(base_schema)
