# Web Search Implementation Plan for Penni Chatbot

## Overview
Add web search capabilities to the chatbot so it can look up current information about businesses, websites, and industry trends when users provide business descriptions or website links.

## Recommended Solution: Tavily Search API

**LangChain Integration**: `langchain-community` provides `TavilySearchAPIRetriever` - a simple, production-ready web search tool.

### Why Tavily?
- ✅ **Simple Integration**: Works directly with LangChain/LangGraph
- ✅ **No Complex Setup**: Just requires an API key
- ✅ **Good Results**: Designed for LLM applications with clean, relevant results
- ✅ **Cost-Effective**: Free tier available, reasonable pricing
- ✅ **Fast**: Optimized for real-time search in conversational AI

### Alternatives Considered:
- **DuckDuckGo**: Free but less reliable, slower, no API key needed
- **Serper API**: Good but more expensive, requires more setup
- **Google Custom Search**: Complex setup, rate limits, requires API keys

## Implementation Plan

### Phase 1: Setup & Dependencies

1. **Install Required Package**
   ```bash
   pip install langchain-community
   ```

2. **Get Tavily API Key**
   - Sign up at https://tavily.com
   - Get API key from dashboard
   - Add to `.env`: `TAVILY_API_KEY=your-api-key`

3. **Update `requirements.txt`**
   ```
   langchain-community>=0.3.0
   ```

### Phase 2: Create Web Search Tool Module

**File**: `chatbot-function/app/web_search.py`

```python
"""Web search tool using Tavily API."""

from langchain_community.retrievers import TavilySearchAPIRetriever
from langchain_core.tools import tool
import logging

logger = logging.getLogger(__name__)

def create_web_search_tool():
    """Create a Tavily web search tool for LangChain."""
    retriever = TavilySearchAPIRetriever(
        k=3,  # Number of results to return
        include_generated_answer=True,  # Get AI-generated summary
        include_raw_content=False,  # Don't include full page content (saves tokens)
        include_images=False,  # Don't include images
    )
    
    @tool
    def web_search(query: str) -> str:
        """Search the web for current information about a business, website, or topic.
        
        Use this tool when:
        - User provides a website URL and you need to learn about the business
        - User describes their business and you want to find similar companies or industry info
        - You need current information about trends, competitors, or market data
        
        Args:
            query: Search query describing what to look up
            
        Returns:
            Formatted string with search results and sources
        """
        try:
            docs = retriever.invoke(query)
            
            if not docs:
                return "No search results found."
            
            # Format results for LLM consumption
            results = []
            for i, doc in enumerate(docs, 1):
                content = doc.page_content
                source = doc.metadata.get('source', 'Unknown')
                results.append(f"[{i}] {content}\nSource: {source}")
            
            return "\n\n".join(results)
        except Exception as e:
            logger.error(f"Web search error: {e}", exc_info=True)
            return f"Error performing web search: {str(e)}"
    
    return web_search
```

### Phase 3: Integrate into Chatbot Graph

**Modify**: `chatbot-function/app/chatbot.py`

1. **Add web search tool to analyzer node** (when website is provided):
   ```python
   from app.web_search import create_web_search_tool
   
   # In create_graph_with_checkpointer:
   web_search_tool = create_web_search_tool()
   
   # Bind tool to analyzer LLM
   analyzer_llm_with_tools = analyzer_llm.bind_tools([web_search_tool])
   ```

2. **Update analyzer_node to use web search**:
   ```python
   def analyzer_node(state: GraphState):
       conversation = [SystemMessage(content=system_prompt())]
       conversation.extend(state.get("messages", []))
       
       # Check if website was mentioned in conversation
       website = state.get("slots", {}).get("website")
       if website and not website.startswith("http"):
           website = f"https://{website}"
       
       # If website provided, search for business info
       if website:
           search_query = f"information about {website} business company"
           search_results = web_search_tool.invoke(search_query)
           # Add search results to conversation context
           conversation.append(SystemMessage(
               content=f"Web search results about {website}:\n{search_results}"
           ))
       
       # Continue with existing structured output logic...
   ```

### Phase 4: Enhanced Integration (Optional - More Sophisticated)

**Option A: Add as LangGraph Tool Node**
- Create a dedicated "web_search" node in the graph
- Route to it when website is detected but not fully understood
- Use search results to enrich slot extraction

**Option B: Add to Speaker Node**
- Allow speaker to search for additional context when answering questions
- Useful for providing industry insights or competitor information

### Phase 5: Configuration

**Update**: `chatbot-function/app/config.py`

```python
# Add to Settings class
tavily_api_key: Optional[str] = Field(default=None, alias="TAVILY_API_KEY")
enable_web_search: bool = Field(default=True, alias="ENABLE_WEB_SEARCH")
```

**Update**: `chatbot-function/.env.example`

```
# Web Search (Tavily)
TAVILY_API_KEY=
ENABLE_WEB_SEARCH=true
```

## Usage Scenarios

### Scenario 1: User provides website
```
User: "My website is https://sipwell.com"
→ Bot searches: "information about https://sipwell.com business company"
→ Bot extracts: business_about, keywords, influencerTypes from search results
```

### Scenario 2: User describes business vaguely
```
User: "We're a fitness brand"
→ Bot searches: "fitness brands companies influencers marketing"
→ Bot uses results to ask better follow-up questions
```

### Scenario 3: Industry research
```
User: "What kind of influencers work with SaaS companies?"
→ Bot searches: "SaaS companies influencer marketing partnerships"
→ Bot provides informed answer based on current data
```

## Implementation Steps (Priority Order)

1. ✅ **Phase 1**: Install dependencies and get API key
2. ✅ **Phase 2**: Create web_search.py module
3. ✅ **Phase 3**: Basic integration - add search when website detected
4. ⏳ **Phase 4**: Enhanced integration (optional)
5. ⏳ **Phase 5**: Configuration and environment setup

## Testing Plan

1. **Unit Tests**: Test web_search_tool with various queries
2. **Integration Tests**: Test analyzer_node with website URLs
3. **End-to-End**: Full conversation flow with web search enabled

## Cost Considerations

- **Tavily Free Tier**: 1,000 searches/month
- **Paid Plans**: Start at $20/month for 10,000 searches
- **Estimate**: ~100 searches per campaign = 10 campaigns/month on free tier

## Error Handling

- Handle API key missing gracefully
- Fallback to no search if API fails
- Log search queries for debugging
- Rate limit handling (Tavily handles this, but we should catch errors)

## Future Enhancements

1. **Caching**: Cache search results for same websites
2. **Multi-query**: Search for multiple aspects (company, competitors, industry)
3. **Result filtering**: Filter results by relevance/date
4. **Source citations**: Include source URLs in responses

