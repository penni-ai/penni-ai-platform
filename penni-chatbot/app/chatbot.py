#!/usr/bin/env python3
"""Campaign intake demo using LangGraph + Vertex AI (Python)."""

from __future__ import annotations

import logging
import os
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
    """Return global checkpointer, preferring Postgres when configured."""
    return get_checkpointer()

@dataclass(frozen=True)
class FieldSpec:
    """Description of a field tracked by the LangGraph workflow."""

    name: str
    required: bool
    ask_allowed: bool
    value_type: str = "string"


FIELD_SPECS: List[FieldSpec] = [
    FieldSpec(name="business_about", required=False, ask_allowed=False),
    FieldSpec(name="business_location", required=True, ask_allowed=True),
    FieldSpec(name="influencer_location", required=True, ask_allowed=True),
    FieldSpec(name="max_followers", required=True, ask_allowed=True, value_type="number"),
    FieldSpec(name="min_followers", required=True, ask_allowed=True, value_type="number"),
    FieldSpec(name="website", required=True, ask_allowed=True),
    FieldSpec(name="keywords", required=False, ask_allowed=False, value_type="list"),
    FieldSpec(name="influencerTypes", required=False, ask_allowed=False),
    FieldSpec(name="campaign_title", required=False, ask_allowed=False),
    FieldSpec(name="influencer_search_query", required=False, ask_allowed=False),
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
    return value


class GraphState(TypedDict, total=False):
    messages: List[Any]
    slots: Dict[str, Any]
    missing: List[str]
    status: str
    guidance: Dict[str, str]
    field_status: Dict[str, str]


def system_prompt() -> str:
    """System prompt for the Analyzer agent."""

    implied_list = ", ".join(sorted(IMPLIED_FIELDS))
    required_list = ", ".join(REQUIRED_FIELDS)
    return (
        "You are the ANALYZER agent. Read the entire conversation and update the slot"
        " dictionary for these fields: "
        f"{required_list} and inferred context (keywords, influencerTypes, campaign_title,"
        " influencer_search_query). Never speak to the user."
        " Provide guidance for the speaker agent about what to acknowledge and the single"
        " next question. Implied fields ("
        f"{implied_list}) must be inferred only—never instruct the speaker to ask for them."
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


def friendly_prompt_for(field_name: str) -> str:
    label = field_name.replace("_", " ")
    return (
        "Ask casually for the user's {label} in one sentence."
    ).format(label=label)


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
        "location": settings.google_cloud_region,
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
        conversation = [SystemMessage(content=system_prompt())]
        conversation.extend(state.get("messages", []))
        
        # Use structured output with bind_structured_output
        # Vertex AI Gemini supports structured output via response_format
        try:
            # Use bind_structured_output for reliable structured parsing
            structured_llm = analyzer_llm.with_structured_output(AnalyzerOutput)
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
        
        merged_slots = default_slots()
        merged_slots.update(state.get("slots", {}))
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
        if not guidance_dict.get("ack"):
            guidance_dict["ack"] = "Offer a concise friendly acknowledgment of the captured info."
        if not guidance_dict.get("ask"):
            next_field = next((field for field in missing if FIELD_INDEX.get(field).ask_allowed), None)
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
        }

    @traceable(name="speaker_node", run_type="chain")
    def speaker_node(state: GraphState):
        """Generate conversational response based on guidance."""
        guidance = state.get("guidance") or {}
        ack = guidance.get("ack", "Confirm the captured info.")
        ask = guidance.get("ask", "Ask for any missing field.")
        guidance_prompt = (
            "You are the SPEAKER agent. Adopt a warm, conversational tone."
            " Keep replies to ~2 short paragraphs, using Markdown if useful."
            " Do not repeat full checklists; weave details naturally."
            " Absolutely ask for only ONE missing detail per response."
            " Sound like you're chatting, not logging requirements—keep it to one or"
            " two short sentences and avoid repeating the same praise."
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
            ai_message = AIMessage(content="".join(stream_buffer).strip())
        else:
            @traceable(name="speaker_llm_invoke", run_type="llm")
            def _invoke_response():
                return speaker_llm.invoke(conversation)
            ai_message = _invoke_response()
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

    def trigger_node(_state: GraphState):
        return {
            "status": "triggering",
            "messages": [
                AIMessage(content="All required slots filled. Preparing outreach draft…"),
            ],
        }

    workflow = StateGraph(GraphState)
    workflow.add_node("analyzer", analyzer_node)
    workflow.add_node("speaker", speaker_node)
    workflow.add_node("route", route_node)
    workflow.add_node("trigger", trigger_node)
    workflow.add_edge(START, "analyzer")
    workflow.add_edge("analyzer", "speaker")
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
