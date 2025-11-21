"""Web search tool using Tavily API."""

from __future__ import annotations

import logging
from typing import Optional
from urllib.parse import urlparse

from langchain_community.retrievers import TavilySearchAPIRetriever

from app.config import get_settings

logger = logging.getLogger(__name__)

# ============================================================================
# Configuration Constants
# ============================================================================

# Tavily retriever parameters
TAVILY_K_RESULTS = 3  # Number of results to return
TAVILY_INCLUDE_GENERATED_ANSWER = False  # Don't use generated answer (can be truncated)
TAVILY_INCLUDE_RAW_CONTENT = True  # Include raw content for complete information
TAVILY_INCLUDE_IMAGES = False  # Don't include images

# Content formatting parameters
MAX_CONTENT_LENGTH = 2000  # Limit each result to prevent token overflow
MIN_TRUNCATE_RATIO = 0.8  # Only truncate at boundary if reasonable

# Domains to filter out from search results
TAVILY_DOMAINS_TO_FILTER = ["tavily.com", "api.tavily.com", "docs.tavily.com"]

# ============================================================================
# Global Retriever Instance
# ============================================================================
# Note: Global retriever pattern is used to avoid initialization overhead
# on each search request. The retriever is thread-safe and can be reused.

_retriever: Optional[TavilySearchAPIRetriever] = None


def get_web_search_retriever() -> Optional[TavilySearchAPIRetriever]:
    """Get or create Tavily search retriever instance.
    
    Uses a global singleton pattern to avoid initialization overhead.
    The retriever is thread-safe and can be reused across requests.
    """
    global _retriever
    
    if _retriever is not None:
        return _retriever
    
    settings = get_settings()
    
    if not settings.tavily_api_key:
        logger.warning("TAVILY_API_KEY not set. Web search will be disabled.")
        return None
    
    try:
        _retriever = TavilySearchAPIRetriever(
            tavily_api_key=settings.tavily_api_key,
            k=TAVILY_K_RESULTS,
            include_generated_answer=TAVILY_INCLUDE_GENERATED_ANSWER,
            include_raw_content=TAVILY_INCLUDE_RAW_CONTENT,
            include_images=TAVILY_INCLUDE_IMAGES,
        )
        logger.info("Tavily search retriever initialized successfully")
        return _retriever
    except Exception as e:
        logger.error(f"Failed to initialize Tavily retriever: {e}", exc_info=True)
        return None


# ============================================================================
# Helper Functions
# ============================================================================

def _extract_domain(url: str) -> Optional[str]:
    """Extract normalized domain from URL."""
    try:
        url_clean = url.strip().lower()
        if not url_clean.startswith(("http://", "https://")):
            url_clean = f"https://{url_clean}"
        parsed = urlparse(url_clean)
        return parsed.netloc.lower().replace("www.", "")
    except Exception:
        return None


def _filter_results(docs: list, target_url: Optional[str] = None) -> list:
    """Filter and prioritize search results.
    
    Args:
        docs: List of document results from Tavily
        target_url: Optional target website URL to prioritize
        
    Returns:
        Filtered list of documents with target URL results prioritized
    """
    target_domain = _extract_domain(target_url) if target_url else None
    filtered_docs = []
    
    for doc in docs:
        source_url = doc.metadata.get('source', 'Unknown')
        if not source_url or source_url == 'Unknown':
            continue
        
        source_domain = _extract_domain(source_url)
        if not source_domain:
            # If URL parsing fails, include it but don't prioritize
            filtered_docs.append(doc)
            continue
        
        # Filter out Tavily's own domains
        if any(tavily_domain in source_domain for tavily_domain in TAVILY_DOMAINS_TO_FILTER):
            logger.debug(f"Filtering out Tavily domain: {source_url}")
            continue
        
        # Prioritize target URL if provided
        if target_domain and source_domain == target_domain:
            # Move target URL results to the front
            filtered_docs.insert(0, doc)
        else:
            filtered_docs.append(doc)
    
    return filtered_docs


def _truncate_content(content: str, max_length: int = MAX_CONTENT_LENGTH) -> str:
    """Truncate content at sentence boundary if too long.
    
    Args:
        content: Content string to truncate
        max_length: Maximum length before truncation
        
    Returns:
        Truncated content (with "..." if truncated)
    """
    if len(content) <= max_length:
        return content
    
    # Try to truncate at sentence boundary
    truncated = content[:max_length]
    last_period = truncated.rfind('.')
    last_newline = truncated.rfind('\n')
    cut_point = max(last_period, last_newline)
    
    if cut_point > max_length * MIN_TRUNCATE_RATIO:
        return content[:cut_point + 1] + "..."
    else:
        return content[:max_length] + "..."


def _format_search_results(filtered_docs: list) -> tuple[str, list[dict[str, str]]]:
    """Format search results for LLM consumption and collect sources.
    
    Args:
        filtered_docs: List of filtered document results
        
    Returns:
        Tuple of (formatted string with search results, list of source dicts)
    """
    results = []
    sources = []
    
    for i, doc in enumerate(filtered_docs, 1):
        # Prefer raw_content if available (more complete), otherwise use page_content
        content = doc.page_content
        raw_content = doc.metadata.get('raw_content', '')
        
        # Use raw_content if it's longer and more informative
        if raw_content and len(raw_content) > len(content):
            content = raw_content
        
        # Truncate if too long
        content = _truncate_content(content)
        
        source_url = doc.metadata.get('source', 'Unknown')
        source_title = doc.metadata.get('title', source_url)
        
        results.append(f"[{i}] {content}\nSource: {source_url}")
        
        # Collect source for footer
        sources.append({
            'url': source_url,
            'title': source_title,
        })
        
        # Log if content was truncated
        if raw_content and len(raw_content) > MAX_CONTENT_LENGTH:
            logger.debug(
                f"Result {i} raw_content truncated: {len(raw_content)} chars -> "
                f"{MAX_CONTENT_LENGTH} chars max"
            )
    
    formatted_results = "\n\n".join(results)
    return formatted_results, sources


# ============================================================================
# Main Search Function
# ============================================================================

def search_web(query: str, target_url: Optional[str] = None) -> tuple[Optional[str], list[dict[str, str]]]:
    """Perform web search and return formatted results with sources.
    
    Args:
        query: Search query string
        target_url: Optional target website URL to prioritize and filter for
        
    Returns:
        Tuple of (formatted string with search results, list of source dicts with 'url' and 'title' keys)
        Returns (None, []) if search fails
    """
    retriever = get_web_search_retriever()
    if not retriever:
        return None, []
    
    try:
        logger.info(f"Performing web search: {query}")
        docs = retriever.invoke(query)
        
        if not docs:
            logger.warning(f"No search results found for query: {query}")
            return None, []
        
        # Filter and prioritize results
        filtered_docs = _filter_results(docs, target_url)
        
        if not filtered_docs:
            logger.warning(f"All search results were filtered out for query: {query}")
            return None, []
        
        # Format results for LLM consumption and collect sources
        formatted_results, sources = _format_search_results(filtered_docs)
        
        total_length = len(formatted_results)
        logger.info(
            f"Web search completed. Found {len(filtered_docs)} results (filtered from {len(docs)}). "
            f"Total content length: {total_length} chars"
        )
        
        return formatted_results, sources
    except Exception as e:
        logger.error(f"Web search error: {e}", exc_info=True)
        return None, []

