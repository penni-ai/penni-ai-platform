"""Stage that executes multi-query hybrid search against Weaviate.

The stage currently respects follower count bounds and optional platform filters.
Additional filters passed from upstream will be ignored until explicitly supported.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from weaviate.classes.query import Filter, HybridVector, MetadataQuery, TargetVectors

from functions.runtime.config import settings
from functions.runtime.core.pipeline.base import ProgressCallback, Stage, StageName, StageResult
from functions.runtime.core.pipeline.utils import build_profile_refs
from functions.runtime.models.domain import CreatorProfile
from functions.runtime.models.mappers import to_creator_profile
from functions.runtime.models.search import StageIO
from functions.runtime.services.query_expansion import QueryExpansionError, QueryExpansionService
from functions.runtime.services.weaviate_client import WeaviateClient, WeaviateClientError


logger = logging.getLogger("weaviate_search_stage")

DEFAULT_ALPHA_VALUES: Tuple[float, ...] = (0.2, 0.5, 0.8)
DEFAULT_RESULTS_PER_QUERY = 500
DEFAULT_TOP_N = 1000
PROFILE_WEIGHT = 2.5
POST_WEIGHT = 1.0
HASHTAG_WEIGHT = 1.5
QUERY_PROPERTIES = ["profile_text", "post_text", "hashtag_text"]
MAX_FOLLOWERS_FALLBACK = 10_000_000


def _normalize_platforms(platforms: Optional[Sequence[str]]) -> List[str]:
    if not platforms:
        return []
    normalized: List[str] = []
    for platform in platforms:
        if not platform:
            continue
        clean = platform.strip().lower()
        if clean:
            normalized.append(clean)
    return normalized


def _build_filters(
    min_followers: Optional[int],
    max_followers: Optional[int],
    platforms: Optional[Sequence[str]],
) -> Optional[Filter]:
    filters: List[Any] = []
    follower_min = max(0, int(min_followers)) if min_followers is not None else 0
    follower_max = max(0, int(max_followers)) if max_followers is not None else MAX_FOLLOWERS_FALLBACK

    if follower_min:
        filters.append(Filter.by_property("followers").greater_or_equal(follower_min))
    if follower_max:
        filters.append(Filter.by_property("followers").less_or_equal(follower_max))

    normalized_platforms = _normalize_platforms(platforms)
    platform_filters = [Filter.by_property("platform").equal(value) for value in normalized_platforms]
    if platform_filters:
        filters.append(Filter.any_of(platform_filters))

    if not filters:
        return None
    if len(filters) == 1:
        return filters[0]
    return Filter.all_of(filters)


def _metadata_score(metadata: Any) -> Optional[float]:
    if not metadata:
        return None
    score = getattr(metadata, "score", None)
    if isinstance(score, (int, float)):
        return float(score)
    distance = getattr(metadata, "distance", None)
    if isinstance(distance, (int, float)):
        try:
            return max(0.0, 1.0 - float(distance))
        except (TypeError, ValueError):
            return None
    return None


def _coerce_properties(raw: Any) -> Dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return dict(raw)
    dump_method = getattr(raw, "model_dump", None)
    if callable(dump_method):
        return dict(dump_method())
    if hasattr(raw, "__dict__"):
        return dict(raw.__dict__)
    try:
        return dict(raw)
    except Exception:  # pragma: no cover - defensive fallback
        return {}


def _weaviate_to_profile(obj: Any) -> Optional[CreatorProfile]:
    try:
        properties = _coerce_properties(getattr(obj, "properties", {}))
        metadata = getattr(obj, "metadata", None)
        score = _metadata_score(metadata)
        payload = dict(properties)
        payload.setdefault("lance_db_id", properties.get("lance_db_id") or properties.get("id"))
        payload.setdefault("combined_score", score if score is not None else properties.get("combined_score"))
        payload.setdefault("vector_similarity_score", score)
        payload.setdefault("account", properties.get("username") or properties.get("display_name"))
        payload.setdefault("profile_name", properties.get("display_name") or properties.get("username"))
        payload.setdefault("posts_raw", properties.get("posts") or properties.get("post_text"))
        payload.setdefault("platform", (properties.get("platform") or "").lower())
        payload.setdefault("profile_image_url", properties.get("profile_image_url") or properties.get("profile_image_link"))
        payload.setdefault("profile_url", properties.get("profile_url") or properties.get("url"))
        payload.setdefault("username", properties.get("username") or properties.get("account"))
        return to_creator_profile(payload)
    except Exception:  # pylint: disable=broad-except
        logger.warning("Failed to map Weaviate object to CreatorProfile", exc_info=True)
        return None


class WeaviateSearchStage(Stage):
    name = StageName.SEARCH

    def __init__(
        self,
        *,
        weaviate_client: Optional[WeaviateClient] = None,
        query_expansion_service: Optional[QueryExpansionService] = None,
        collection_name: Optional[str] = None,
        alpha_values: Optional[Sequence[float]] = None,
        results_per_query: Optional[int] = None,
        top_n: Optional[int] = None,
    ) -> None:
        self._weaviate_client = weaviate_client or WeaviateClient()
        self._query_service = query_expansion_service or QueryExpansionService()
        self._collection_name = collection_name or settings.WEAVIATE_COLLECTION_NAME
        self._alpha_values: Tuple[float, ...] = tuple(alpha_values) if alpha_values else DEFAULT_ALPHA_VALUES
        self._results_per_query = int(results_per_query or DEFAULT_RESULTS_PER_QUERY)
        self._top_n = int(top_n or DEFAULT_TOP_N)
        self._target_vector = TargetVectors.manual_weights(
            {
                "profile": PROFILE_WEIGHT,
                "post": POST_WEIGHT,
                "hashtag": HASHTAG_WEIGHT,
            }
        )
        logger.debug(
            "WeaviateSearchStage initialized",
            extra={
                "collection": self._collection_name,
                "alphas": list(self._alpha_values),
                "results_per_query": self._results_per_query,
                "top_n": self._top_n,
            },
        )

    def _expanded_queries(self, inquiry: str) -> List[str]:
        try:
            return self._query_service.generate_queries(inquiry)
        except (QueryExpansionError, ValueError):
            logger.warning("Query expansion failed; falling back to original query", exc_info=True)
            return [inquiry]

    def _search_single_query_alpha(
        self,
        collection,
        query: str,
        query_vector: Optional[List[float]],
        alpha: float,
        filters: Optional[Filter],
        limit: int,
    ) -> List[Any]:
        hybrid_vector = (
            HybridVector.near_vector(query_vector)
            if query_vector
            else None
        )
        try:
            response = collection.query.hybrid(
                query=query,
                vector=hybrid_vector,
                alpha=alpha,
                limit=limit,
                filters=filters,
                query_properties=list(QUERY_PROPERTIES),
                target_vector=self._target_vector,
                return_metadata=MetadataQuery(score=True, distance=True),
            )
            return list(getattr(response, "objects", []) or [])
        except Exception:  # pylint: disable=broad-except
            logger.warning(
                "Hybrid query failed",
                exc_info=True,
                extra={"alpha": alpha, "query": query[:80], "limit": limit},
            )
            return []

    def _perform_multi_search(
        self,
        inquiry: str,
        filters: Optional[Filter],
        progress_cb: ProgressCallback,
    ) -> List[CreatorProfile]:
        weaviate_client = self._weaviate_client.get_client()
        collection = weaviate_client.collections.get(self._collection_name)
        queries = self._expanded_queries(inquiry)
        logger.info(
            "Query expansion generated queries",
            extra={"count": len(queries), "queries": queries},
        )
        results: List[CreatorProfile] = []
        seen_ids: Set[str] = set()

        for query in queries:
            normalized_query = query.strip()
            if not normalized_query:
                continue
            query_vector = self._weaviate_client.generate_embedding(normalized_query)
            if query_vector is None:
                logger.warning("Embedding generation failed; skipping query", extra={"query": normalized_query})
                continue
            for alpha in self._alpha_values:
                objects = self._search_single_query_alpha(
                    collection,
                    normalized_query,
                    query_vector,
                    alpha,
                    filters,
                    self._results_per_query,
                )
                new_count = 0
                for obj in objects:
                    profile = _weaviate_to_profile(obj)
                    if profile is None:
                        continue
                    dedupe_key = (profile.lance_db_id or "").strip()
                    if not dedupe_key:
                        dedupe_key = (profile.username or profile.account or profile.profile_url or "").strip()
                    if not dedupe_key:
                        continue
                    if dedupe_key in seen_ids:
                        continue
                    seen_ids.add(dedupe_key)
                    results.append(profile)
                    new_count += 1

                if progress_cb:
                    progress_cb(
                        f"{self.name}_QUERY_ALPHA_COMPLETED",
                        {
                            "query": normalized_query,
                            "alpha": alpha,
                            "results": len(objects),
                            "new_profiles": new_count,
                        },
                    )
        return results

    def run(
        self,
        profiles: List[CreatorProfile],
        *,
        progress_cb: ProgressCallback = None,
        query: str,
        limit: int = 20,
        min_followers: Optional[int] = None,
        max_followers: Optional[int] = None,
        platforms: Optional[Sequence[str]] = None,
        **_: Any,
    ) -> StageResult:
        del profiles

        search_query = (query or "").strip()
        if not search_query:
            empty_io = StageIO(inputs=[], outputs=[])
            return StageResult(profiles=[], io=empty_io, debug={"total_found": 0, "top_n": 0})

        filters = _build_filters(min_followers, max_followers, platforms)
        io_payload = StageIO(inputs=[], outputs=[])

        if progress_cb:
            progress_cb(
                f"{self.name}_STARTED",
                {
                    "query": search_query,
                    "limit": limit,
                    "filters": str(filters) if filters else None,
                    "alphas": list(self._alpha_values),
                    "io": io_payload.model_dump(),
                },
            )

        try:
            results = self._perform_multi_search(search_query, filters, progress_cb)
        except WeaviateClientError:
            logger.exception("Weaviate search failed during execution")
            raise

        sorted_results = sorted(results, key=lambda profile: profile.combined_score, reverse=True)
        top_results = sorted_results[: min(self._top_n, len(sorted_results))]
        limit_value = max(1, int(limit)) if limit else 1
        final_results = top_results[:limit_value] if top_results else []
        io_payload = StageIO(inputs=[], outputs=build_profile_refs(final_results))

        if progress_cb:
            progress_cb(
                f"{self.name}_COMPLETED",
                {
                    "total_found": len(results),
                    "top_n": len(top_results),
                    "returned": len(final_results),
                    "io": io_payload.model_dump(),
                },
            )

        return StageResult(
            profiles=final_results,
            io=io_payload,
            debug={
                "total_found": len(results),
                "top_n": len(top_results),
                "alphas": list(self._alpha_values),
            },
        )


__all__ = ["WeaviateSearchStage"]
