"""Service for expanding business inquiries into influencer search queries using OpenAI."""
from __future__ import annotations

import json
import logging
import re
from typing import List, Optional

from openai import OpenAI

from functions.runtime.config import settings


logger = logging.getLogger("query_expansion")


class QueryExpansionError(RuntimeError):
    """Raised when query expansion fails"""


CODE_FENCE_RE = re.compile(r"```(?:json|jsonc|javascript|txt)?|```", re.IGNORECASE)


class QueryExpansionService:
    """Generate diverse influencer search queries from a business inquiry."""

    def __init__(
        self,
        *,
        model: str = "gpt-5-mini",
        num_queries: int = 12,
        openai_api_key: Optional[str] = None,
        temperature: float = 0.7,
    ) -> None:
        sanitized_num = num_queries or 12
        try:
            sanitized_num = int(sanitized_num)
        except (TypeError, ValueError):
            sanitized_num = 12
        if sanitized_num < 12:
            sanitized_num = 12
        if sanitized_num > 12:
            sanitized_num = 12

        self.model = model or "gpt-5-mini"
        self.num_queries = sanitized_num
        try:
            self.temperature = float(temperature)
        except (TypeError, ValueError):
            self.temperature = 0.7

        settings_api_key = (
            settings.OPENAI_API_KEY.get_secret_value() if getattr(settings, "OPENAI_API_KEY", None) else None
        )
        self.api_key = openai_api_key or settings_api_key
        if not self.api_key:
            raise QueryExpansionError("OPENAI_API_KEY must be configured for query expansion")

        logger.debug(
            "QueryExpansionService initialized",
            extra={
                "model": self.model,
                "num_queries": self.num_queries,
                "has_api_key": bool(self.api_key),
                "temperature": self.temperature,
            },
        )

    def _call_openai(self, prompt: str) -> str:
        """Invoke OpenAI's chat completions API and return the raw text response."""

        try:
            client = OpenAI(api_key=self.api_key)
            response = client.chat.completions.create(
                model=self.model,
                temperature=self.temperature,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are an expert growth marketer helping brands find influencer partners. "
                            "Generate exactly 12 keyword-based search queries following the 4+2+6 structure "
                            "(4 broad, 2 specific, 6 adjacent). Always respond with a plain JSON array of strings."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.error(
                "OpenAI call failed",
                extra={"error": str(exc), "model": self.model},
            )
            raise QueryExpansionError("OpenAI call failed") from exc

        choice = (response.choices or [None])[0]
        if not choice or not choice.message or not choice.message.content:
            raise QueryExpansionError("OpenAI response missing content")
        # ``content`` can be list (new SDK) or str (legacy); handle both.
        content = choice.message.content
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(str(block.get("text", "")))
                elif isinstance(block, str):
                    parts.append(block)
            return "\n".join(parts).strip()
        return str(content).strip()

    def _build_prompt(self, business_inquiry: str) -> str:
        return f"""Based on this influencer description, generate EXACTLY 12 simple, keyword-based search queries for an INFLUENCER SEARCH ENGINE.

Description: {business_inquiry}

CRITICAL Requirements:
- These queries will search influencer BIOS and POSTS
- ONLY use words that would actually appear in an influencer's bio or content
- Use terms influencers use to describe THEMSELVES (not how others describe them)
- Keep queries SHORT (2-4 words max)
- Use simple keywords only
- Don't use full sentences or third-person descriptions
- Format: one query per line
- Generate EXACTLY 12 queries total

QUERY BREAKDOWN (MUST FOLLOW):
- 4 BROAD queries (individual concepts, single words or simple 2-word terms)
- 2 SPECIFIC queries (location + niche combinations)
- 6 ADJACENT queries (related influencer types with valuable audiences)

⚠️ NEVER USE BUSINESS/ENTITY TYPES:
- ❌ DON'T: "coffee shop", "restaurant", "gym", "studio", "store", "cafe", "venue"
- ✅ DO: "coffee lover", "foodie", "fitness coach", "photographer", "content creator"
- Remember: Influencers are PEOPLE, not businesses
- Use words that describe what they DO or are interested in, not places/businesses

Wrong vs Right Examples:
❌ "san francisco coffee shop" → ✅ "sf coffee lover" or "sf barista"
❌ "la restaurant" → ✅ "la foodie" or "la food blogger"
❌ "nyc gym" → ✅ "nyc fitness" or "nyc personal trainer"
❌ "miami beach club" → ✅ "miami nightlife" or "miami lifestyle"

STRUCTURE - Generate queries in this order:

PART 1 - BROAD QUERIES (4 total):
- Extract main concepts separately (location, niche, related terms)
- Single words or simple 2-word terms
- Cast the widest net

PART 2 - SPECIFIC QUERIES (2 total):
- Combine location + niche
- Use location abbreviations when relevant

PART 3 - ADJACENT QUERIES (6 total):
- SINGLE WORDS/TERMS - Mix of adjacent locations AND related influencer types
- Include ADJACENT LOCATIONS (2-3 queries): nearby areas, regions, or related cities
  * San Francisco → "bay area", "oakland", "berkeley"
  * Los Angeles → "socal", "orange county", "hollywood"
  * New York → "nyc", "brooklyn", "manhattan"
  * Miami → "south florida", "fort lauderdale", "brickell"
- Include ADJACENT INFLUENCER TYPES (3-4 queries): related categories with valuable audiences
  * For food/restaurant → "lifestyle", "blogger", "creator", "local", "guide"
  * For fitness/gym → "wellness", "lifestyle", "motivational", "coach", "athlete"
  * For fashion/clothing → "lifestyle", "style", "beauty", "blogger", "creator"
  * For travel/hotel → "adventure", "lifestyle", "explorer", "creator", "vlogger"
- These should be SIMPLE single-word terms or 2-word location names

Example for "San Francisco coffee shop" (12 queries):
BROAD (4):
san francisco          ← location
coffee                 ← niche
foodie                 ← related niche
food                   ← related term

SPECIFIC (2):
sf coffee              ← location + niche
bay area coffee        ← location variation + niche

ADJACENT (6):
bay area               ← adjacent location
oakland                ← adjacent city
berkeley               ← adjacent city
lifestyle              ← adjacent influencer type
blogger                ← adjacent influencer type
creator                ← adjacent influencer type

Example for "LA gym" (12 queries):
BROAD (4):
los angeles            ← location
fitness                ← niche
health                 ← related term
workout                ← activity term

SPECIFIC (2):
la fitness             ← location + niche
la workout             ← location + activity

ADJACENT (6):
socal                  ← adjacent location/region
orange county          ← adjacent area
hollywood              ← adjacent city/area
wellness               ← adjacent influencer type
lifestyle              ← adjacent influencer type
coach                  ← adjacent influencer type

Now generate EXACTLY 12 queries following the structure above (4 broad + 2 specific + 6 adjacent):"""

    def generate_queries(self, business_inquiry: str) -> List[str]:
        """Create up to ``num_queries`` unique influencer search queries.

        Responses containing fewer than ``num_queries`` but at least three distinct entries are accepted as-is,
        while any result with fewer than three unique queries triggers a retry/fallback.
        """
        query = (business_inquiry or "").strip()
        if not query:
            raise ValueError("business_inquiry must be provided")

        logger.info(
            "Generating influencer queries",
            extra={"business_inquiry": query, "num_queries": self.num_queries},
        )

        prompt = self._build_prompt(query)
        attempts = 0
        last_error: Optional[str] = None

        while attempts < 3:
            attempts += 1
            raw_output: Optional[str] = None
            try:
                raw_output = self._call_openai(prompt)
                prepared = self._prepare_json_payload(raw_output)
                parsed = json.loads((prepared or "").strip())
                if not isinstance(parsed, list):
                    raise ValueError("Response was not a JSON array")
                cleaned: List[str] = []
                seen = set()
                for entry in parsed:
                    if isinstance(entry, str):
                        text = entry.strip()
                        if text:
                            normalized = text.lower()
                            if normalized in seen:
                                continue
                            seen.add(normalized)
                            cleaned.append(text)
                if len(cleaned) < 12:
                    raise ValueError("Response must include at least 12 unique queries")
                if len(cleaned) > self.num_queries:
                    cleaned = cleaned[: self.num_queries]
                logger.info(
                    "Generated influencer queries",
                    extra={"business_inquiry": query, "attempt": attempts, "count": len(cleaned)},
                )
                return cleaned
            except json.JSONDecodeError as exc:
                last_error = str(exc)
                logger.warning(
                    "Failed to parse OpenAI response; retrying",
                    extra={
                        "attempt": attempts,
                        "error": last_error,
                        "business_inquiry": query,
                        "raw_preview": self._truncate_preview(raw_output),
                    },
                )
            except (ValueError, QueryExpansionError) as exc:
                last_error = str(exc)
                logger.warning(
                    "Failed to parse OpenAI response; retrying",
                    extra={"attempt": attempts, "error": last_error, "business_inquiry": query},
                )

        logger.warning(
            "Falling back to original query after exhausting retries",
            extra={"business_inquiry": query, "last_error": last_error},
        )
        return [query]

    @staticmethod
    def _prepare_json_payload(raw: Optional[str]) -> str:
        if raw is None:
            return ""
        original = raw.strip()
        if not original:
            return original
        text = CODE_FENCE_RE.sub("", original)
        extracted = QueryExpansionService._extract_first_json_array(text)
        if extracted:
            return extracted
        if text != original:
            return text
        return original

    @staticmethod
    def _extract_first_json_array(text: str) -> Optional[str]:
        start = text.find("[")
        if start == -1:
            return None
        depth = 0
        for idx, char in enumerate(text[start:], start=start):
            if char == "[":
                depth += 1
            elif char == "]":
                depth -= 1
                if depth == 0:
                    return text[start : idx + 1]
        return None

    @staticmethod
    def _truncate_preview(raw: Optional[str], limit: int = 200) -> str:
        if not raw:
            return ""
        preview = raw.replace("\n", " ").replace("\r", " ")
        return preview[:limit]
