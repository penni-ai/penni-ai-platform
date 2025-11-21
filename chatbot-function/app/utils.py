"""Utility functions."""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional
from pythonjsonlogger import jsonlogger

from app.models import CollectedData


# --- Logging Setup ---

class ContextLoggerAdapter(logging.LoggerAdapter):
    def process(self, msg: str, kwargs: Dict[str, Any]):
        extra = kwargs.setdefault("extra", {})
        extra.update(self.extra)
        return msg, kwargs


def configure_logging(level: str = "INFO") -> logging.Logger:
    logger = logging.getLogger()
    logger.setLevel(level.upper())
    for handler in list(logger.handlers):
        logger.removeHandler(handler)
    handler = logging.StreamHandler()
    formatter = jsonlogger.JsonFormatter("%(levelname)s %(name)s %(message)s %(asctime)s", timestamp=True)
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    return logger


def get_logger(name: Optional[str] = None, **context: Any) -> ContextLoggerAdapter:
    base_logger = logging.getLogger(name)
    return ContextLoggerAdapter(base_logger, context)


# --- Simplified Mapper ---

def map_slots_to_collected(slots: Dict[str, Any]) -> CollectedData:
    """
    Maps the raw dictionary from the CampaignDetails tool 
    directly to the database model.
    """
    # Ensure defaults if the agent missed optional fields
    return CollectedData(
        business_name=slots.get("business_name"),
        website=slots.get("website"),
        business_location=slots.get("business_location"),
        influencer_location=slots.get("influencer_location"),
        min_followers=slots.get("min_followers"),
        max_followers=slots.get("max_followers"),
        platform=slots.get("platform"),  # Agent returns a list, model expects list or str
        type_of_influencer=slots.get("type_of_influencer"),
        campaign_title=slots.get("campaign_title"),
        business_about=slots.get("business_about"),
    )
