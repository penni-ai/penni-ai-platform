#!/usr/bin/env python3
"""Campaign intake demo using LangGraph + Vertex AI (Python)."""

from __future__ import annotations

import logging
import os
import re
import sys
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, TypedDict

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_google_vertexai import ChatVertexAI
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langsmith import traceable

from app.database import get_checkpointer
from app.config import get_settings
from app.structured_output import AnalyzerOutput
from app.web_search import search_web

logger = logging.getLogger(__name__)

DEFAULT_SCRIPT = [
    "Hi there! We're SipWell, a sparkling water brand based in Austin.",
    "Website is https://sipwell.example. We want LA-based lifestyle creators with at least 25k followers.",
    "Top follower range is 250k, and they should love food and travel.",
]

VERTEX_TEMPERATURE = 0.2
VERTEX_MAX_TOKENS = 1024
VERTEX_TOP_P = 0.95
VERTEX_TOP_K = 40

STREAM_TO_STDOUT = os.environ.get("STREAM_OUTPUT", "1").lower() not in {"0", "false", "no"}

def _get_checkpointer() -> BaseCheckpointSaver:
    """Return global Firestore checkpointer."""
    return get_checkpointer()

@dataclass(frozen=True)
class FieldSpec:
    """Description of a field tracked by the LangGraph workflow."""

    name: str
    required: bool
    ask_allowed: bool
    value_type: str = "string"


FIELD_SPECS: List[FieldSpec] = [
    FieldSpec(name="business_name", required=True, ask_allowed=True),
    FieldSpec(name="business_about", required=False, ask_allowed=False),
    FieldSpec(name="business_location", required=True, ask_allowed=True),
    FieldSpec(name="influencer_location", required=True, ask_allowed=True),
    FieldSpec(name="max_followers", required=True, ask_allowed=True, value_type="number"),
    FieldSpec(name="min_followers", required=True, ask_allowed=True, value_type="number"),
    FieldSpec(name="website", required=True, ask_allowed=True),
    FieldSpec(name="platform", required=True, ask_allowed=True, value_type="list"),
    FieldSpec(name="type_of_influencer", required=True, ask_allowed=True),
    FieldSpec(name="campaign_title", required=False, ask_allowed=False),
]

FIELD_INDEX: Dict[str, FieldSpec] = {spec.name: spec for spec in FIELD_SPECS}
REQUIRED_FIELDS = [spec.name for spec in FIELD_SPECS if spec.required]
IMPLIED_FIELDS = {spec.name for spec in FIELD_SPECS if not spec.ask_allowed}
FIELD_STATUS_OVERRIDES = {
    "business_about": "confirmed",
}


def _coerce_slot_value(name: str, value: Any) -> Any:
    spec = FIELD_INDEX.get(name)
    if not spec:
        return value
    if value in (None, ""):
        return None
    
    if spec.value_type == "list":
        # Special handling for platform field to validate and normalize values
        if name == "platform":
            valid_platforms = {"instagram", "tiktok"}
            normalized_platforms = []
            
            # Handle list input
            if isinstance(value, list):
                items = value
            # Handle comma-separated string
            elif isinstance(value, str) and "," in value:
                items = [part.strip() for part in value.split(",") if part.strip()]
            # Handle single string
            else:
                items = [str(value).strip()] if value else []
            
            # Normalize each platform value
            for item in items:
                item_str = str(item).strip().lower()
                # Direct match
                if item_str in valid_platforms:
                    normalized_platforms.append(item_str)
                # Normalize common variations
                elif "tiktok" in item_str or item_str == "tt":
                    normalized_platforms.append("tiktok")
                elif "instagram" in item_str or item_str in ["ig", "insta"]:
                    normalized_platforms.append("instagram")
            
            # Remove duplicates while preserving order
            seen = set()
            result = []
            for platform in normalized_platforms:
                if platform not in seen:
                    seen.add(platform)
                    result.append(platform)
            
            return result if result else None
        
        # Generic list handling for other fields
        if isinstance(value, list):
            cleaned = [str(item).strip() for item in value if str(item).strip()]
            return cleaned
        if isinstance(value, str) and "," in value:
            return [part.strip() for part in value.split(",") if part.strip()]
        return [str(value).strip()]
    if spec.value_type == "number":
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        return int(number) if number.is_integer() else number
    return str(value).strip() if value else None


class GraphState(TypedDict, total=False):
    messages: List[Any]
    slots: Dict[str, Any]
    missing: List[str]
    status: str
    guidance: Dict[str, str]
    field_status: Dict[str, str]
    web_search_done: bool  # Track if web search has been performed in this conversation
    web_search_sources: List[Dict[str, str]]  # Store web search source URLs for footer
    influencer_summary: str  # AI-generated summary of what kind of influencer user is looking for


def system_prompt() -> str:
    """System prompt for the Analyzer agent."""

    implied_list = ", ".join(sorted(IMPLIED_FIELDS))
    required_list = ", ".join(REQUIRED_FIELDS)
    return (
        "You are the ANALYZER agent. Read the entire conversation and update the slot"
        " dictionary for these fields: "
        f"{required_list} and inferred context (campaign_title). Never speak to the user."
        "\n\n"
        "Your responsibilities:"
        "\n1. Extract slot updates from the conversation (what the user has provided)"
        "\n2. Identify which REQUIRED fields are still missing (not yet collected)"
        "\n3. Provide guidance for the speaker agent:"
        "   - 'ack': Acknowledge what was captured in this turn"
        "   - 'ask': Ask for exactly ONE missing required field"
        "\n\n"
        "CRITICAL: The missing_fields list must include ALL required fields that have not been"
        " collected yet. Required fields are: " + required_list + "."
        " Only include fields that are truly missing (not provided by the user)."
        "\n\n"
        "Implied fields ("
        f"{implied_list}) must be inferred only—never include them in missing_fields"
        " or instruct the speaker to ask for them."
        "\n\n"
        
        "IMPORTANT: The campaign_title field must be implicitly generated based on the conversation."
        " It should be a maximum of 5 words and summarize the campaign based on the business,"
        " location, and influencer requirements discussed. Do NOT ask the user for a campaign title."
        " Generate it automatically from the conversation context."
    )


def default_slots() -> Dict[str, Optional[Any]]:
    """Return initial slot dictionary."""

    slots: Dict[str, Optional[Any]] = {}
    for spec in FIELD_SPECS:
        if spec.value_type == "list":
            slots[spec.name] = []
        else:
            slots[spec.name] = None
    return slots


def default_status() -> Dict[str, str]:
    status = {spec.name: "not_collected" for spec in FIELD_SPECS if spec.ask_allowed}
    status.update(FIELD_STATUS_OVERRIDES)
    return status


def compute_missing(status_map: Dict[str, str], slots: Dict[str, Any]) -> List[str]:
    missing: List[str] = []
    for spec in FIELD_SPECS:
        if not spec.required:
            continue
        status = status_map.get(spec.name)
        if status == "confirmed":
            continue
        if slots.get(spec.name) not in (None, ""):
            continue
        missing.append(spec.name)
    return missing


# Field-specific ask prompts - customize these to provide context for each field
FIELD_ASK_PROMPTS: Dict[str, str] = {
    "business_name": "Ask casually for the user's business name in one sentence.",
    "website": "Ask casually for the user's business website URL in one sentence. If the user provides none, set it as N/A", 
    "business_location": "Ask casually for the user's business location (city, state, or region) in one sentence. Locations can be remote.",
    "influencer_location": "Ask casually for where influencers they want to work with should be based in one sentence.",
    "min_followers": "Ask casually for the minimum and maximum follower count the user wants in one sentence. If the user says around a number, then assume it is plus or minus 10k.",
    "max_followers": "Ask casually for the minimum and maximum follower count the user wants in one sentence. If the user says around a number, then assume it is plus or minus 10k.",
    "platform": "Ask casually if they want to look for Instagram and Tiktok Influencers, or just one of them.",
    "type_of_influencer": "Ask casually what type of influencer they're looking for (e.g., lifestyle, food, travel, fashion, tech, beauty, fitness, etc.) in one sentence.",
}


def friendly_prompt_for(field_name: str) -> str:
    """Get the ask prompt for a field, using custom prompt if available."""
    # Check if there's a custom prompt for this field
    if field_name in FIELD_ASK_PROMPTS:
        return FIELD_ASK_PROMPTS[field_name]
    
    # Fallback to generic prompt
    label = field_name.replace("_", " ")
    return (
        "Ask casually for the user's {label} in one sentence."
    ).format(label=label)


def friendly_prompt_for_follower_range() -> str:
    """Special prompt for asking for both min and max followers together."""
    return "Ask casually for the user's desired follower count range (minimum and maximum) in one sentence."


def extract_text(message: Any) -> str:
    content = getattr(message, "content", message)
    # Strings expose .encode; treat anything with that attribute as text-like
    encode_method = getattr(content, "encode", None)
    if callable(encode_method):
        return str(content)

    iterator = getattr(content, "__iter__", None)
    if callable(iterator):
        parts: List[str] = []
        for block in content:
            getter = getattr(block, "get", None)
            if callable(getter) and getter("type") == "text":
                text = getter("text")
                if text:
                    parts.append(text)
            else:
                parts.append(str(block))
        return "\n".join(parts)

    return str(content)


def create_graph_with_checkpointer(
    checkpointer: BaseCheckpointSaver, settings=None
) -> StateGraph:
    """Compile the LangGraph workflow with the provided checkpointer."""

    settings = settings or get_settings()
    base_kwargs = {
        "model": settings.vertex_model,
        "project": settings.google_cloud_project,
        "location": settings.vertex_ai_region,  # Use Vertex AI specific region (global for Gemini)
        "temperature": VERTEX_TEMPERATURE,
        "max_output_tokens": VERTEX_MAX_TOKENS,
        "top_p": VERTEX_TOP_P,
        "top_k": VERTEX_TOP_K,
    }
    analyzer_llm = ChatVertexAI(**base_kwargs)
    speaker_kwargs = dict(base_kwargs)
    speaker_kwargs["streaming"] = True
    speaker_llm = ChatVertexAI(**speaker_kwargs)

    @traceable(name="analyzer_node", run_type="chain")
    def analyzer_node(state: GraphState):
        """Analyze conversation and extract structured slot updates."""
        # Get current slots to check if we already have website/business info
        current_slots = state.get("slots", {})
        web_search_done = state.get("web_search_done", False)
        search_results = None
        search_sources = []
        
        # Check if we need to search (only if not done yet)
        if not web_search_done:
            website = current_slots.get("website")
            business_about = current_slots.get("business_about")
            
            # Also check latest user message for website URLs or business names
            messages = state.get("messages", [])
            if not website and not business_about and messages:
                # Check last user message for website URLs
                last_message = messages[-1]
                if hasattr(last_message, 'content'):
                    content = str(last_message.content)
                    # Look for common URL patterns
                    url_pattern = r'(?:https?://)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})'
                    url_match = re.search(url_pattern, content, re.IGNORECASE)
                    if url_match:
                        website = url_match.group(0)
            
            # Determine search query
            search_query = None
            if website:
                # Clean website URL
                website_clean = str(website).strip()
                if not website_clean.startswith(("http://", "https://")):
                    website_clean = f"https://{website_clean}"
                search_query = f"information about {website_clean} business company"
            elif business_about:
                # Extract business name from description (first few words)
                business_name = str(business_about).split()[:5]  # First 5 words
                search_query = f"{' '.join(business_name)} company business"
            
            # Perform search if query determined
            if search_query:
                logger.info(f"Performing web search for: {search_query}")
                # Pass the actual website URL to prioritize it in results
                target_url = website_clean if website else None
                search_results, search_sources = search_web(search_query, target_url=target_url)
                
                # If user provided a website URL, add it as the first source if not already present
                if website and search_sources:
                    website_clean_normalized = website_clean.lower().replace("www.", "")
                    # Check if the website is already in sources
                    website_in_sources = any(
                        url.lower().replace("www.", "") == website_clean_normalized
                        for url in [s.get('url', '') for s in search_sources]
                    )
                    
                    if not website_in_sources:
                        # Add the user's website as the first source
                        search_sources.insert(0, {
                            'url': website_clean,
                            'title': website_clean,
                        })
                
                if search_results:
                    web_search_done = True
        
        # Build conversation with system prompt
        conversation = [SystemMessage(content=system_prompt())]
        
        # Add web search results if available (after system prompt, before user messages)
        if search_results:
            conversation.append(
                SystemMessage(
                    content=f"Web search results:\n{search_results}\n\nUse this information to better understand the business and extract relevant details."
                )
            )
        
        # Add user messages
        conversation.extend(state.get("messages", []))
        
        # Use structured output with bind_structured_output
        # Vertex AI Gemini supports structured output via response_format
        # Use json_mode to ensure our cleaned schema (without null types) is used
        try:
            # Use json_mode method to use response_format instead of function calling
            # This ensures our custom schema generator (which removes null types) is used
            structured_llm = analyzer_llm.with_structured_output(AnalyzerOutput, method="json_mode")
            parsed = structured_llm.invoke(conversation)
        except Exception as e:
            # Fallback to manual parsing if structured output fails
            logger.warning(f"Structured output failed, using fallback: {e}")
            from app.structured_output import Guidance, SlotUpdates
            parsed = AnalyzerOutput(
                slot_updates=SlotUpdates(),
                missing_fields=REQUIRED_FIELDS,
                guidance=Guidance(
                    ack="Apologize for the parsing issue",
                    ask="Request all required fields again",
                ),
            )

        # Extract slot updates from structured output
        slot_updates_dict = parsed.slot_updates.model_dump(exclude_none=True)
        
        # Merge slots
        merged_slots = default_slots()
        merged_slots.update(current_slots)
        
        # Update merged slots with new slot updates from structured output
        for key, value in slot_updates_dict.items():
            coerced = _coerce_slot_value(key, value)
            spec = FIELD_INDEX.get(key)
            if spec and spec.value_type == "list":
                merged_slots[key] = coerced or []
            elif coerced not in (None, ""):
                merged_slots[key] = coerced

        status_map = default_status()
        status_map.update(state.get("field_status", {}))
        for name, value in merged_slots.items():
            if value not in (None, ""):
                status_map[name] = "confirmed"

        computed_missing = compute_missing(status_map, merged_slots)
        parsed_missing = parsed.missing_fields
        if isinstance(parsed_missing, list):
            filtered = [field for field in parsed_missing if field in computed_missing]
            missing = filtered or computed_missing
        else:
            missing = computed_missing

        guidance_dict = parsed.guidance.model_dump()
        # Always use LLM's acknowledgment, but fallback if empty
        if not guidance_dict.get("ack"):
            guidance_dict["ack"] = "Offer a concise friendly acknowledgment of the captured info."
        
        # ALWAYS hardcode the "ask" based on computed missing fields, ignore LLM's ask
        # This ensures we only ask for fields that are actually missing
        # Special case: if both min_followers and max_followers are missing, ask for them together
        min_followers_missing = "min_followers" in missing
        max_followers_missing = "max_followers" in missing
        
        if min_followers_missing and max_followers_missing:
            # Ask for both follower ranges together
            guidance_dict["ask"] = friendly_prompt_for_follower_range()
        else:
            # Ask for the next missing field
            # If only one follower field is missing, we'll ask for it individually
            # Otherwise, skip follower fields if both are missing (handled above)
            askable_fields = [
                field for field in missing 
                if FIELD_INDEX.get(field).ask_allowed
            ]
            next_field = next(iter(askable_fields), None)
            if next_field:
                guidance_dict["ask"] = friendly_prompt_for(next_field)
            else:
                guidance_dict["ask"] = "Let the user know all info is collected."

        status = "ready" if not missing else "collecting"

        return {
            "slots": merged_slots,
            "missing": missing,
            "status": status,
            "guidance": guidance_dict,
            "field_status": status_map,
            "web_search_done": web_search_done,  # Track that search was performed
            "web_search_sources": search_sources,  # Store sources for footer
        }

    @traceable(name="speaker_node", run_type="chain")
    def speaker_node(state: GraphState):
        """Generate conversational response based on guidance."""
        guidance = state.get("guidance") or {}
        ack = guidance.get("ack", "Confirm the captured info.")
        ask = guidance.get("ask", "Ask for any missing field.")
        guidance_prompt = (
            "You are the SPEAKER agent. Adopt a warm, conversational tone."
            " Keep replies to ~2 short paragraphs."
            " Do not repeat full checklists; weave details naturally."
            " Absolutely ask for only ONE missing detail per response."
            " Sound like you're chatting, not logging requirements—keep it to one or"
            " two short sentences and avoid repeating the same praise."
            " IMPORTANT: Use plain text only. Do NOT use markdown formatting (no **bold**, *italic*, links, lists, etc.)."
            " Do NOT use emojis. Write in natural, conversational plain text."
            "\nFriendly context summary: "
            f"{ack}\n"
            "Next helpful question or nudge: "
            f"{ask}\n"
            "If everything is collected, simply celebrate and hint that you'll move on."
        )
        conversation = [SystemMessage(content=guidance_prompt)]
        conversation.extend(state.get("messages", []))
        stream_buffer: List[str] = []
        streamed_once = False
        
        @traceable(name="speaker_llm_stream", run_type="llm")
        def _stream_response():
            return speaker_llm.stream(conversation)
        
        for chunk in _stream_response():
            chunk_text = extract_text(chunk)
            if not chunk_text:
                continue
            stream_buffer.append(chunk_text)
            if STREAM_TO_STDOUT:
                if not streamed_once:
                    print("Agent: ", end="", flush=True)
                    streamed_once = True
                print(chunk_text, end="", flush=True)
        if STREAM_TO_STDOUT and streamed_once:
            print()
        if stream_buffer:
            content = "".join(stream_buffer).strip()
        else:
            @traceable(name="speaker_llm_invoke", run_type="llm")
            def _invoke_response():
                return speaker_llm.invoke(conversation)
            ai_message_temp = _invoke_response()
            content = extract_text(ai_message_temp).strip()
        
        # Note: Sources are stored separately in state and will be added to Message model
        # Do not add sources to message content - they appear via the quote icon in the UI
        ai_message = AIMessage(content=content)
        return {"messages": [ai_message]}

    def route_node(state: GraphState):
        slots = state.get("slots", {})
        status_map = state.get("field_status", default_status())
        current_missing = compute_missing(status_map, slots)
        status = "ready" if not current_missing else "collecting"
        return {
            "missing": current_missing,
            "status": status,
            "field_status": status_map,
        }

    def trigger_node(state: GraphState):
        """Generate AI summary of what kind of influencer the user is looking for."""
        slots = state.get("slots", {})
        messages = state.get("messages", [])
        
        # Build conversation text
        conversation_parts = [
            f"{'User' if isinstance(msg, HumanMessage) else 'Assistant'}: {extract_text(msg).strip()}"
            for msg in messages
            if isinstance(msg, (HumanMessage, AIMessage)) and extract_text(msg).strip()
        ]
        conversation_text = "\n\n".join(conversation_parts) if conversation_parts else "Campaign information collected."
        
        # Generate AI summary (1-2 sentences)
        summary_llm = ChatVertexAI(**base_kwargs)
        summary_prompt = (
            f"Based on the following conversation, write a 1-2 sentence description "
            f"summarizing what kind of influencer the user is looking for. "
            f"Focus on key requirements: follower count range, platform, and characteristics. "
            f"Write in plain text, no markdown or emojis.\n\nConversation:\n{conversation_text}"
        )
        
        @traceable(name="trigger_summary_llm", run_type="llm")
        def _generate_summary():
            return summary_llm.invoke(summary_prompt)
        
        summary_text = extract_text(_generate_summary()).strip()
        
        # Append hardcoded fields
        hardcoded_fields = []
        if slots.get("business_location"):
            hardcoded_fields.append(f"Business Location: {slots.get('business_location')}")
        if slots.get("business_about"):
            hardcoded_fields.append(f"Business About: {slots.get('business_about')}")
        if slots.get("influencer_location"):
            hardcoded_fields.append(f"Influencer Location: {slots.get('influencer_location')}")
        if slots.get("type_of_influencer"):
            hardcoded_fields.append(f"Type of Influencer: {slots.get('type_of_influencer')}")
        
        if hardcoded_fields:
            summary_text = f"{summary_text}\n\n" + "\n".join(hardcoded_fields)
        
        completion_message = f"All required slots filled. Preparing outreach draft…\n\n{summary_text}"
        
        return {
            "status": "ready",
            "messages": [AIMessage(content=completion_message)],
            "influencer_summary": summary_text,
        }

    workflow = StateGraph(GraphState)
    workflow.add_node("analyzer", analyzer_node)
    workflow.add_node("speaker", speaker_node)
    workflow.add_node("route", route_node)
    workflow.add_node("trigger", trigger_node)
    workflow.add_edge(START, "analyzer")
    # Route from analyzer: skip speaker if all fields collected, otherwise go to speaker
    workflow.add_conditional_edges(
        "analyzer",
        lambda state: "route" if len(state.get("missing", [])) == 0 else "speaker"
    )
    workflow.add_edge("speaker", "route")
    workflow.add_conditional_edges(
        "route", lambda state: "trigger" if len(state.get("missing", [])) == 0 else END
    )
    workflow.add_edge("trigger", END)
    return workflow.compile(checkpointer=checkpointer)


def build_graph():
    """Build graph using default checkpointer for CLI usage."""

    return create_graph_with_checkpointer(_get_checkpointer())


def run_script(script: Iterable[str]):
    graph = build_graph()
    config = {"configurable": {"thread_id": "cli-demo"}}
    final_state = None

    for user_turn in script:
        print(f"You: {user_turn}")
        for event in graph.stream(
            {"messages": [HumanMessage(content=user_turn)]},
            config=config,
            stream_mode="updates",
        ):
            event_items = getattr(event, "items", None)
            if not callable(event_items):
                continue
            for _node, payload in event_items():
                getter = getattr(payload, "get", None)
                if not callable(getter):
                    continue
                messages = getter("messages") or []
                for message in messages:
                    if getattr(message, "type", None) == "ai":
                        if STREAM_TO_STDOUT:
                            continue
                        print(f"Agent: {message.content}\n")
                slots_snapshot = getter("slots")
                if slots_snapshot is not None:
                    print(f"[slots] {slots_snapshot}")
        final_state = graph.get_state(config)

    if not final_state:
        print("No state stored.")
        return

    slots = final_state.values.get("slots", {})
    missing = final_state.values.get("missing", [])
    status = final_state.values.get("status", "collecting")

    print("\nFinal slots:")
    for field, value in slots.items():
        print(f"- {field}: {value}")
    print(f"Missing: {missing}")
    print(f"Status: {status}")


def main():
    settings = get_settings()
    if settings.google_cloud_project in {"YOUR-PROJECT-ID", "", None}:
        print("Error: configure GOOGLE_CLOUD_PROJECT before running.")
        sys.exit(1)

    script = sys.argv[1:] if len(sys.argv) > 1 else DEFAULT_SCRIPT
    run_script(script)


if __name__ == "__main__":
    main()
