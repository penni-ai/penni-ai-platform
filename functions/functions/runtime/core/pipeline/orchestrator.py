"""Pipeline orchestrator that wires stages together to mirror the runtime flow."""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from functions.runtime.core.pipeline.base import ProgressCallback
from functions.runtime.core.pipeline.stages import (
    BrightDataStage,
    LLMFitStage,
    WeaviateSearchStage,
)
from functions.runtime.core.pipeline.utils import build_profile_refs, normalized_profile_key
from functions.runtime.core.post_filter import BrightDataClient, ProfileFitAssessor
from functions.runtime.models.domain import CreatorProfile
from functions.runtime.models.search import SearchPipelineRequest, StageIO


class CreatorDiscoveryPipeline:
    """High-level orchestrator for the creator discovery pipeline."""

    def __init__(
        self,
        *,
        brightdata_client: Optional[BrightDataClient] = None,
        assessor_factory=ProfileFitAssessor,
    ) -> None:
        self._search: Optional[WeaviateSearchStage] = None
        self._brightdata = BrightDataStage(brightdata_client)
        self._llm = LLMFitStage(assessor_factory)

    def run(
        self,
        request: SearchPipelineRequest,
        *,
        progress_cb: ProgressCallback = None,
    ) -> Tuple[List[CreatorProfile], Dict[str, List[Dict[str, object]]]]:
        search_req = request.search
        self._search = WeaviateSearchStage(
            top_n=search_req.weaviate_top_n,
            results_per_query=search_req.weaviate_results_per_query,
            alpha_values=search_req.weaviate_alpha_values,
        )
        weaviate_kwargs = {
            "query": search_req.query,
            "limit": search_req.limit,
            "min_followers": search_req.min_followers,
            "max_followers": search_req.max_followers,
        }
        # WeaviateSearchStage currently only supports follower and optional platform filters.
        platforms = getattr(search_req, "platforms", None)
        if platforms is not None:
            weaviate_kwargs["platforms"] = platforms
        search_result = self._search.run(
            [],
            progress_cb=progress_cb,
            **weaviate_kwargs,
        )
        profiles = list(search_result.profiles)

        if request.max_profiles is not None and profiles:
            limit = max(1, min(request.max_profiles, len(profiles)))
            profiles = profiles[:limit]

        debug: Dict[str, List[Dict[str, object]]] = {
            "brightdata_results": [],
            "profile_fit": [],
        }

        success_keys: List[str] = []
        brightdata_result = self._brightdata.run(profiles, progress_cb=progress_cb)
        profiles = brightdata_result.profiles
        debug["brightdata_results"] = brightdata_result.debug.get("brightdata_results", [])
        success_keys = brightdata_result.debug.get("success_keys", []) or []

        llm_inputs = list(profiles)
        key_set = {key.lower() for key in success_keys}
        if key_set:
            survivors = [
                profile
                for profile in profiles
                if normalized_profile_key(profile) in key_set
            ]
        else:
            survivors = []

        if progress_cb:
            progress_cb(
                "BRIGHTDATA_FILTERED",
                {
                    "survivors": len(survivors),
                    "dropped": max(0, len(profiles) - len(survivors)),
                    "io": StageIO(
                        inputs=build_profile_refs(profiles),
                        outputs=build_profile_refs(survivors),
                    ).model_dump(),
                },
            )

        llm_inputs = survivors or llm_inputs
        if not llm_inputs:
            debug["profile_fit"] = []
            return llm_inputs, debug

        llm_result = self._llm.run(
            llm_inputs,
            progress_cb=progress_cb,
            business_fit_query=request.business_fit_query,
            max_posts=request.max_posts,
            concurrency=request.concurrency,
            model=request.model,
            verbosity=request.verbosity,
        )
        profiles = llm_result.profiles
        debug["profile_fit"] = llm_result.debug.get("profile_fit", [])

        return profiles, debug
