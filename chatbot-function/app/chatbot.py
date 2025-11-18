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


def _coerce_slot_value(name: str, value: Any) -> Any:
    spec = FIELD_INDEX.get(name)
    if not spec:
        return value
    if value in (None, ""):
        return None
    
    # Special handling for website field - allow "N/A" as valid value
    if name == "website":
        value_str = str(value).strip()
        # Normalize variations of N/A
        if value_str.upper() in ("N/A", "NA", "NONE", "NOT APPLICABLE"):
            return "N/A"
        return value_str if value_str else None
    
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
    web_search_results: Optional[str]  # Web search content to provide to agent
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
        "   - 'ack': Provide a friendly summary of what information has been collected so far"
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


def compute_missing(slots: Dict[str, Any]) -> List[str]:
    """Compute missing required fields based on slot values."""
    missing: List[str] = []
    for spec in FIELD_SPECS:
        if not spec.required:
            continue
        slot_value = slots.get(spec.name)
        # For website field, "N/A" is a valid value
        if spec.name == "website" and slot_value == "N/A":
            continue
        # For list fields (like platform), empty list means missing
        if spec.value_type == "list":
            if isinstance(slot_value, list) and len(slot_value) > 0:
                continue
            else:
                missing.append(spec.name)
                continue
        # For other fields, check if value is None or empty string
        if slot_value not in (None, ""):
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
    "type_of_influencer": "Ask casually what type of content the influencer you would want the influencer to create in one sentence. Suggest lifestyle or food.",
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

    @traceable(name="web_search_node", run_type="chain")
    def web_search_node(state: GraphState):
        """Detect websites in user messages and perform web search immediately."""
        messages = state.get("messages", [])
        search_results = None
        search_sources = []
        
        # Check the latest user message for website URLs
        if messages:
            last_message = messages[-1]
            if isinstance(last_message, HumanMessage):
                content = extract_text(last_message)
                # Look for common URL patterns
                url_pattern = r'(?:https?://)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})'
                url_match = re.search(url_pattern, content, re.IGNORECASE)
                
                if url_match:
                    website = url_match.group(0)
                    # Clean website URL
                    website_clean = str(website).strip()
                    if not website_clean.startswith(("http://", "https://")):
                        website_clean = f"https://{website_clean}"
                    
                    # Perform web search immediately
                    search_query = f"information about {website_clean} business company"
                    logger.info(f"Website detected in message, performing web search for: {search_query}")
                    
                    search_results, search_sources = search_web(search_query, target_url=website_clean)
                    
                    # Add the user's website as the first source if not already present
                    if search_sources:
                        website_clean_normalized = website_clean.lower().replace("www.", "")
                        website_in_sources = any(
                            url.lower().replace("www.", "") == website_clean_normalized
                            for url in [s.get('url', '') for s in search_sources]
                        )
                        
                        if not website_in_sources:
                            search_sources.insert(0, {
                                'url': website_clean,
                                'title': website_clean,
                            })
        
        return {
            "web_search_results": search_results,
            "web_search_sources": search_sources,
        }

    @traceable(name="analyzer_node", run_type="chain")
    def analyzer_node(state: GraphState):
        """Analyze conversation and extract structured slot updates."""
        current_slots = state.get("slots", {})
        
        # Get web search results from web_search_node if available
        search_results = state.get("web_search_results")
        search_sources = state.get("web_search_sources", [])
        
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
                # "N/A" is a valid value for website field and will pass this check
                merged_slots[key] = coerced

        computed_missing = compute_missing(merged_slots)
        parsed_missing = parsed.missing_fields
        if isinstance(parsed_missing, list):
            filtered = [field for field in parsed_missing if field in computed_missing]
            missing = filtered or computed_missing
        else:
            missing = computed_missing

        guidance_dict = parsed.guidance.model_dump()
        # Always use LLM's acknowledgment, but fallback if empty
        if not guidance_dict.get("ack"):
            guidance_dict["ack"] = "Provide a concise friendly summary of what information has been collected so far."
        
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
            "web_search_sources": search_sources,  # Store sources for footer
        }

    @traceable(name="speaker_node", run_type="chain")
    def speaker_node(state: GraphState):
        """Generate conversational response based on guidance."""
        guidance = state.get("guidance") or {}
        slots = state.get("slots", {})
        ack = guidance.get("ack", "Provide a friendly summary of what information has been collected so far.")
        ask = guidance.get("ask", "Ask for any missing field.")
        
        # Build context about collected slots for better guidance
        collected_info = []
        for field_name, value in slots.items():
            if value not in (None, ""):
                field_label = field_name.replace("_", " ").title()
                if isinstance(value, list):
                    collected_info.append(f"{field_label}: {', '.join(str(v) for v in value)}")
                else:
                    collected_info.append(f"{field_label}: {value}")
        
        slots_context = "\n".join(collected_info) if collected_info else "No information collected yet."
        
        guidance_prompt = (
            "You are the SPEAKER agent. Adopt a warm, conversational tone."
            " Keep replies to ~2 short paragraphs."
            " Do not repeat full checklists; weave details naturally."
            " Absolutely ask for only ONE missing detail per response."
            " Sound like you're chatting, not logging requirements—keep it to one or"
            " two short sentences and avoid repeating the same praise."
            " IMPORTANT: Use plain text only. Do NOT use markdown formatting (no **bold**, *italic*, links, lists, etc.)."
            " Do NOT use emojis. Write in natural, conversational plain text."
            "\n\nCollected information so far:\n"
            f"{slots_context}\n\n"
            "Guidance: "
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
        current_missing = compute_missing(slots)
        status = "ready" if not current_missing else "collecting"
        return {
            "missing": current_missing,
            "status": status,
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
    workflow.add_node("web_search", web_search_node)
    workflow.add_node("analyzer", analyzer_node)
    workflow.add_node("speaker", speaker_node)
    workflow.add_node("route", route_node)
    workflow.add_node("trigger", trigger_node)
    workflow.add_edge(START, "web_search")
    workflow.add_edge("web_search", "analyzer")
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
