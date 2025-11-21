#!/usr/bin/env python3
"""Campaign intake demo using LangGraph + Vertex AI (Python)."""

from __future__ import annotations

import logging
import os
import sys
from typing import Any, Dict, Iterable, List, TypedDict, Annotated
import operator

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage, BaseMessage
from langchain_google_vertexai import ChatVertexAI
from langchain_core.tools import tool
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langsmith import traceable

from app.database import get_checkpointer
from app.config import get_settings
from app.structured_output import CampaignDetails
from app.web_search import search_web

logger = logging.getLogger(__name__)

DEFAULT_SCRIPT = [
    "Hi there! We're SipWell, a sparkling water brand based in Austin.",
    "Website is https://sipwell.example. We want LA-based lifestyle creators with at least 25k followers.",
    "Top follower range is 250k, and they should love food and travel.",
]

VERTEX_TEMPERATURE = 0.2
VERTEX_MAX_TOKENS = 1024
STREAM_TO_STDOUT = os.environ.get("STREAM_OUTPUT", "1").lower() not in {"0", "false", "no"}


def _get_checkpointer() -> BaseCheckpointSaver:
    """Return global Firestore checkpointer."""
    return get_checkpointer()


# --- Tools ---

@tool
def search_company_info(query: str) -> str:
    """Search the web for information about a company or business URL."""
    results, _ = search_web(query)
    return results if results else "No results found."


# --- Logic ---

class GraphState(TypedDict, total=False):
    # We use `operator.add` to append messages instead of overwriting
    messages: Annotated[List[BaseMessage], operator.add]
    # We only fill these once at the very end
    slots: Dict[str, Any]
    status: str
    influencer_summary: str
    web_search_sources: List[Dict[str, str]]  # Sources from web searches for message footer


def extract_text(message: Any) -> str:
    """Extract text content from a message."""
    content = getattr(message, "content", message)
    return str(content)


def create_graph_with_checkpointer(
    checkpointer: BaseCheckpointSaver, settings=None
) -> StateGraph:
    """Compile the LangGraph workflow with the provided checkpointer."""

    settings = settings or get_settings()
    
    # 1. Setup LLM
    llm = ChatVertexAI(
        model=settings.vertex_model,
        project=settings.google_cloud_project,
        location=settings.vertex_ai_region,
        temperature=VERTEX_TEMPERATURE,
        max_output_tokens=VERTEX_MAX_TOKENS,
    )
    
    # 2. Bind Tools: The "Goal" (CampaignDetails) and the "Helper" (Search)
    tools = [CampaignDetails, search_company_info]
    llm_with_tools = llm.bind_tools(tools)
    
    # 3. System Prompt: The "Brain"
    system_prompt = (
        "You are Penni, a friendly intake assistant for Dime INC. Our mission is to connect business with viral influencers to grow businesses and brands."
        "Your goal is to gather enough information to call the 'CampaignDetails' tool.\n"
        "RULES:\n"
        "1. Chat naturally. Ask for 1-2 pieces of info at a time.\n"
        "2. If the user gives a URL, call the 'search_company_info' tool to learn about them.\n"
        "3. If the user says 'I don't have X', mentally mark it as 'N/A' and move on.\n"
        "4. Do NOT call 'CampaignDetails' until you have: Name, Website, Locations (Biz & Influencer), "
        "Follower Range, Platform, and Influencer Type.\n"
        "5. Keep responses short (2 paragraphs max) and use plain text (no markdown).\n"
        "6. IMPORTANT: Penni only connects businesses with Instagram and TikTok influencers. "
        "All influencers must have follower counts above 10,000. If a user requests influencers "
        "on other platforms or with fewer than 10k followers, politely explain this limitation."
    )

    @traceable(name="agent_node")
    def agent_node(state: GraphState):
        """Single agent node that converses with user and calls CampaignDetails tool when ready."""
        messages = state.get("messages", [])
        
        # Get existing sources (will be reset if this is a new user turn)
        web_search_sources = state.get("web_search_sources", [])
        
        # Reset web_search_sources if this is a new user turn (last message is HumanMessage)
        # This ensures we only capture sources from searches in the current turn
        if messages:
            last_message = messages[-1]
            if isinstance(last_message, HumanMessage):
                # New user turn - reset sources for this turn
                web_search_sources = []
                logger.debug("Reset web_search_sources for new user turn")
        
        # Prepend system prompt if not present
        if not messages or not isinstance(messages[0], SystemMessage):
            conversation = [SystemMessage(content=system_prompt)] + messages
        else:
            conversation = messages
        
        # Invoke
        response = llm_with_tools.invoke(conversation)
        
        # Check if the tool called was CampaignDetails (The Exit Condition)
        if response.tool_calls:
            for tool_call in response.tool_calls:
                if tool_call["name"] == "CampaignDetails":
                    # We found our goal!
                    # We don't need to execute this tool, just parse the args to save state.
                    campaign_data = tool_call["args"]
                    
                    # Create a clean confirmation message
                    tool_msg = ToolMessage(
                        content="Campaign details captured.",
                        tool_call_id=tool_call["id"]
                    )
                    
                    # Preserve web_search_sources when CampaignDetails is called
                    return {
                        "messages": [response, tool_msg],
                        "slots": campaign_data,  # Save final data here
                        "status": "ready",
                        "web_search_sources": web_search_sources  # Preserve sources for footer
                    }
        
        # If it was a Search tool call, we let the graph loop back to execute it
        # If it was just text, we return the text
        # Preserve web_search_sources for tool execution node to append to
        return {
            "messages": [response],
            "web_search_sources": web_search_sources
        }

    @traceable(name="tool_execution_node")
    def tool_execution_node(state: GraphState):
        """Executes helper tools (like Search) but NOT the final CampaignDetails tool."""
        messages = state.get("messages", [])
        last_message = messages[-1]
        
        outputs = []
        web_search_sources = state.get("web_search_sources", [])
        
        if hasattr(last_message, "tool_calls") and last_message.tool_calls:
            for tool_call in last_message.tool_calls:
                if tool_call["name"] == "search_company_info":
                    # Run the search directly to capture sources
                    logger.info(f"Executing search tool: {tool_call['args']}")
                    try:
                        # Extract query from tool call args
                        args = tool_call.get("args", {})
                        if isinstance(args, dict):
                            query = args.get("query", "")
                        elif isinstance(args, str):
                            query = args
                        else:
                            query = str(args)
                        
                        if not query:
                            logger.warning("Search tool called without query parameter")
                            outputs.append(ToolMessage(
                                content="No search query provided.",
                                tool_call_id=tool_call["id"]
                            ))
                            continue
                        
                        # Call search_web directly to get both results and sources
                        result, sources = search_web(query)
                        if result:
                            # Add sources to state for message footer
                            if sources:
                                web_search_sources.extend(sources)
                                logger.info(f"Captured {len(sources)} web search sources: {[s.get('url', '') for s in sources]}")
                            outputs.append(ToolMessage(
                                content=str(result),
                                tool_call_id=tool_call["id"]
                            ))
                        else:
                            outputs.append(ToolMessage(
                                content="No results found.",
                                tool_call_id=tool_call["id"]
                            ))
                    except Exception as e:
                        logger.error(f"Search tool error: {e}", exc_info=True)
                        outputs.append(ToolMessage(
                            content=f"Search failed: {e}",
                            tool_call_id=tool_call["id"]
                        ))
        
        return {
            "messages": outputs,
            "web_search_sources": web_search_sources
        }

    def trigger_node(state: GraphState):
        """Final summary node."""
        slots = state.get("slots", {})
        summary = (
            "I've received all the necessary information! Click the button below to initiate the search."
        )
        
        return {
            "messages": [AIMessage(content=summary)],
            "influencer_summary": summary,
            # Keep status as "ready" - this indicates the conversation is ready for search form submission
            "status": "ready"
        }

    # --- Workflow ---
    workflow = StateGraph(GraphState)
    workflow.add_node("agent", agent_node)
    workflow.add_node("tools", tool_execution_node)
    workflow.add_node("trigger", trigger_node)
    
    workflow.add_edge(START, "agent")
    
    def route_agent(state):
        """Decide where to go next based on the agent's response."""
        status = state.get("status")
        if status == "ready":
            return "trigger"
        
        last_msg = state["messages"][-1]
        if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
            # If it's the final tool, agent_node already set status="ready"
            # So if we are here, it must be a search tool
            return "tools"
        
        return END
    
    workflow.add_conditional_edges("agent", route_agent)
    workflow.add_edge("tools", "agent")  # Loop back after search
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
    status = final_state.values.get("status", "collecting")

    print("\nFinal slots:")
    for field, value in slots.items():
        print(f"- {field}: {value}")
    print(f"\nStatus: {status}")


def main():
    settings = get_settings()
    if settings.google_cloud_project in {"YOUR-PROJECT-ID", "", None}:
        print("Error: configure GOOGLE_CLOUD_PROJECT before running.")
        sys.exit(1)

    script = sys.argv[1:] if len(sys.argv) > 1 else DEFAULT_SCRIPT
    run_script(script)


if __name__ == "__main__":
    main()
