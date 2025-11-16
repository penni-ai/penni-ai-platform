"""Web search tool using Tavily API."""

from __future__ import annotations

import logging
from typing import Optional

from langchain_community.retrievers import TavilySearchAPIRetriever

from app.config import get_settings

logger = logging.getLogger(__name__)

# Global retriever instance (initialized once)
_retriever: Optional[TavilySearchAPIRetriever] = None


def get_web_search_retriever() -> Optional[TavilySearchAPIRetriever]:
    """Get or create Tavily search retriever instance."""
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
            k=3,  # Number of results to return
            include_generated_answer=False,  # Don't use generated answer (can be truncated)
            include_raw_content=True,  # Include raw content for complete information
            include_images=False,  # Don't include images
        )
        logger.info("Tavily search retriever initialized successfully")
        return _retriever
    except Exception as e:
        logger.error(f"Failed to initialize Tavily retriever: {e}", exc_info=True)
        return None


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
        
        # Normalize target URL for comparison if provided
        target_domain = None
        if target_url:
            # Extract domain from target URL
            target_clean = target_url.strip().lower()
            if not target_clean.startswith(("http://", "https://")):
                target_clean = f"https://{target_clean}"
            try:
                from urllib.parse import urlparse
                parsed = urlparse(target_clean)
                target_domain = parsed.netloc.lower().replace("www.", "")
            except Exception:
                pass
        
        # Filter and prioritize results
        filtered_docs = []
        tavily_domains = ["tavily.com", "api.tavily.com", "docs.tavily.com"]
        
        for doc in docs:
            source_url = doc.metadata.get('source', 'Unknown')
            if not source_url or source_url == 'Unknown':
                continue
            
            # Extract domain from source URL
            try:
                from urllib.parse import urlparse
                parsed = urlparse(source_url)
                source_domain = parsed.netloc.lower().replace("www.", "")
                
                # Filter out Tavily's own domains
                if any(tavily_domain in source_domain for tavily_domain in tavily_domains):
                    logger.debug(f"Filtering out Tavily domain: {source_url}")
                    continue
                
                # Prioritize target URL if provided
                if target_domain and source_domain == target_domain:
                    # Move target URL results to the front
                    filtered_docs.insert(0, doc)
                else:
                    filtered_docs.append(doc)
            except Exception:
                # If URL parsing fails, include it but don't prioritize
                filtered_docs.append(doc)
        
        if not filtered_docs:
            logger.warning(f"All search results were filtered out for query: {query}")
            return None, []
        
        # Format results for LLM consumption and collect sources
        results = []
        sources = []
        max_content_length = 2000  # Limit each result to prevent token overflow
        
        for i, doc in enumerate(filtered_docs, 1):
            # Prefer raw_content if available (more complete), otherwise use page_content
            content = doc.page_content
            raw_content = doc.metadata.get('raw_content', '')
            
            # Use raw_content if it's longer and more informative
            if raw_content and len(raw_content) > len(content):
                content = raw_content
            
            # Truncate if too long (but keep complete sentences)
            if len(content) > max_content_length:
                # Try to truncate at sentence boundary
                truncated = content[:max_content_length]
                last_period = truncated.rfind('.')
                last_newline = truncated.rfind('\n')
                cut_point = max(last_period, last_newline)
                if cut_point > max_content_length * 0.8:  # Only truncate at boundary if reasonable
                    content = content[:cut_point + 1] + "..."
                else:
                    content = content[:max_content_length] + "..."
            
            source_url = doc.metadata.get('source', 'Unknown')
            source_title = doc.metadata.get('title', source_url)  # Use title if available, fallback to URL
            
            results.append(f"[{i}] {content}\nSource: {source_url}")
            
            # Collect source for footer
            sources.append({
                'url': source_url,
                'title': source_title,
            })
        
        formatted_results = "\n\n".join(results)
        total_length = len(formatted_results)
        logger.info(
            f"Web search completed. Found {len(filtered_docs)} results (filtered from {len(docs)}). "
            f"Total content length: {total_length} chars"
        )
        
        # Log if any results were truncated
        for i, doc in enumerate(filtered_docs, 1):
            raw_content = doc.metadata.get('raw_content', '')
            page_content = doc.page_content
            if raw_content and len(raw_content) > max_content_length:
                logger.debug(
                    f"Result {i} raw_content truncated: {len(raw_content)} chars -> "
                    f"{max_content_length} chars max"
                )
        
        return formatted_results, sources
    except Exception as e:
        logger.error(f"Web search error: {e}", exc_info=True)
        return None, []

