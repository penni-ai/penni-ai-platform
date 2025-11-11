"""Search-related Pydantic models for the simplified API."""
from typing import Any, Dict, List, Optional, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


_ALLOWED_STOP_STAGE_VALUES: Optional[tuple[str, ...]] = None


def _allowed_stop_stage_values() -> tuple[str, ...]:
    """Lazily load stage constants without creating circular imports."""

    global _ALLOWED_STOP_STAGE_VALUES
    if _ALLOWED_STOP_STAGE_VALUES is None:
        from functions.runtime.core.pipeline.base import StageName  # local import

        _ALLOWED_STOP_STAGE_VALUES = (
            StageName.SEARCH,
            StageName.BRIGHTDATA,
            StageName.LLM_FIT,
        )
    return _ALLOWED_STOP_STAGE_VALUES


class SearchRequest(BaseModel):
    """Single discovery request that expands ``query`` into 12 AI-generated searches (4 broad + 2 specific + 6 adjacent) and runs each with 3 alpha values (0.2, 0.5, 0.8), resulting in 36 hybrid Weaviate searches per call."""

    query: str = Field(
        ...,
        min_length=1,
        description=(
            "Natural-language business description; automatically expanded into 12 influencer queries "
            "(4 broad + 2 specific + 6 adjacent)."
        ),
    )
    method: Literal["lexical", "semantic", "hybrid"] = Field(
        default="hybrid", description="Search mode"
    )
    limit: int = Field(default=20, ge=1, le=50000, description="Maximum results to return")

    min_followers: Optional[int] = Field(default=None, ge=0)
    max_followers: Optional[int] = Field(default=None, ge=0)
    min_engagement: Optional[float] = Field(default=None, ge=0.0)
    max_engagement: Optional[float] = Field(default=None, ge=0.0)

    location: Optional[str] = Field(default=None)
    category: Optional[str] = Field(default=None)
    is_verified: Optional[bool] = Field(default=None)
    is_business_account: Optional[bool] = Field(default=None)
    lexical_scope: Literal["bio", "bio_posts"] = Field(
        default="bio", description="Lexical search scope"
    )
    weaviate_top_n: Optional[int] = Field(
        default=None,
        ge=1,
        le=10000,
        description=(
            "Maximum unique profiles to collect across the 12-query x 3-alpha (36 total) Weaviate searches before "
            "applying the final limit (default: 1000)."
        ),
    )
    weaviate_results_per_query: Optional[int] = Field(
        default=None,
        ge=1,
        le=1000,
        description=(
            "Number of results to fetch per query x alpha combination; with 12 queries and 3 alphas this caps the "
            "360-degree recall (default 500 => up to 18,000 raw results before deduplication)."
        ),
    )
    weaviate_alpha_values: Optional[List[float]] = Field(
        default=None,
        description=(
            "Alpha values for hybrid search: 0.0=keyword-only, 1.0=semantic-only (default: [0.2, 0.5, 0.8])"
        ),
    )

    @field_validator("weaviate_alpha_values")
    @classmethod
    def validate_weaviate_alpha_values(
        cls, value: Optional[List[float]]
    ) -> Optional[List[float]]:
        if value is None:
            return value
        if not value:
            raise ValueError("weaviate_alpha_values must include at least one value")
        for alpha in value:
            if not 0.0 <= alpha <= 1.0:
                raise ValueError("weaviate_alpha_values must be between 0.0 and 1.0")
        return value


class SimilarSearchRequest(BaseModel):
    account: str = Field(..., min_length=1, description="Reference account username")
    limit: int = Field(default=10, ge=1, le=100)

    min_followers: Optional[int] = Field(default=None, ge=0)
    max_followers: Optional[int] = Field(default=None, ge=0)
    min_engagement: Optional[float] = Field(default=None, ge=0.0)
    max_engagement: Optional[float] = Field(default=None, ge=0.0)

    location: Optional[str] = Field(default=None)
    category: Optional[str] = Field(default=None)


class CategorySearchRequest(BaseModel):
    category: str = Field(..., min_length=1)
    location: Optional[str] = Field(default=None)
    limit: int = Field(default=15, ge=1, le=200)

    min_followers: Optional[int] = Field(default=None, ge=0)
    max_followers: Optional[int] = Field(default=None, ge=0)
    min_engagement: Optional[float] = Field(default=None, ge=0.0)
    max_engagement: Optional[float] = Field(default=None, ge=0.0)


class PipelineEnrichRequest(BaseModel):
    profiles: List[Dict[str, Any]] = Field(..., min_items=1, description="Profiles to evaluate")
    run_brightdata: bool = Field(default=False)
    run_llm: bool = Field(default=False)
    business_fit_query: Optional[str] = Field(default=None)
    max_profiles: Optional[int] = Field(default=None, ge=1, le=50000)
    max_posts: int = Field(default=6, ge=1, le=20)
    model: str = Field(default="gpt-5-mini")
    verbosity: str = Field(default="medium")
    concurrency: int = Field(default=64, ge=1, le=64)


class SearchResponse(BaseModel):
    success: bool
    results: List[Dict[str, Any]]
    count: int
    query: str
    method: str


class UsernameSearchResponse(BaseModel):
    success: bool
    result: Dict[str, Any]


class PipelineEnrichResponse(BaseModel):
    success: bool
    results: List[Dict[str, Any]]
    brightdata_results: List[Dict[str, Any]]
    profile_fit: List[Dict[str, Any]]
    count: int


class JobEnqueueResponse(BaseModel):
    """Standard response for async job submissions."""

    job_id: str
    queue: str
    status: Literal["queued"] = "queued"


class PipelineStageEvent(BaseModel):
    """Structured stage telemetry for the search pipeline."""

    stage: str
    data: Dict[str, Any]


class ProfileRef(BaseModel):
    """Minimal, stable profile identifier carried across stages."""

    lance_db_id: Optional[str] = None
    account: Optional[str] = None
    profile_url: Optional[str] = None

    @classmethod
    def from_result(cls, result: Any) -> "ProfileRef":
        if isinstance(result, dict):
            lance = result.get("lance_db_id")
            account = result.get("account") or result.get("username")
            url = result.get("profile_url") or result.get("url")
        else:
            lance = getattr(result, "lance_db_id", None)
            account = getattr(result, "account", None) or getattr(result, "username", None)
            url = (
                getattr(result, "profile_url", None)
                or getattr(result, "url", None)
            )
        if isinstance(url, str):
            url = url.strip() or None
        return cls(
            lance_db_id=lance,
            account=account,
            profile_url=url,
        )


class StageIO(BaseModel):
    """Uniform inputs/outputs envelope per stage."""

    inputs: List[ProfileRef] = Field(default_factory=list)
    outputs: List[ProfileRef] = Field(default_factory=list)
    meta: Dict[str, Any] = Field(default_factory=dict)


class SearchPipelineRequest(BaseModel):
    """Run discovery plus enrichment in a single orchestrated request."""

    search: SearchRequest
    business_fit_query: str = Field(..., min_length=1)
    max_profiles: Optional[int] = Field(default=None, ge=1, le=50000)
    max_posts: int = Field(default=6, ge=1, le=20)
    model: str = Field(default="gpt-5-mini")
    verbosity: str = Field(default="medium")
    concurrency: int = Field(default=64, ge=1, le=64)
    debug_mode: bool = Field(default=False, description="Enable debug output for all stages")
    stop_at_stage: Optional[Literal["SEARCH", "BRIGHTDATA", "LLM_FIT"]] = Field(
        default=None,
        description="Stop pipeline execution after this stage and return results",
    )

    @field_validator("stop_at_stage")
    @classmethod
    def validate_stop_at_stage(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        valid_stages = _allowed_stop_stage_values()
        if value not in valid_stages:
            raise ValueError(
                "stop_at_stage must be one of: " + ", ".join(valid_stages)
            )
        return value


class SearchPipelineResponse(BaseModel):
    """Response returned by the staged search pipeline."""

    success: bool
    results: List[Dict[str, Any]]
    brightdata_results: List[Dict[str, Any]]
    profile_fit: List[Dict[str, Any]]
    stages: List[PipelineStageEvent]
    count: int
    pipeline_id: Optional[str] = None
    pipeline_status_path: Optional[str] = None
    debug_summary: Optional[Dict[str, Any]] = None


class BrightDataStageRequest(BaseModel):
    profiles: List[Dict[str, Any]] = Field(..., min_items=1)
    max_profiles: Optional[int] = Field(default=None, ge=1, le=50000)

    @model_validator(mode="after")
    def ensure_profile_urls_present(self):
        missing = [
            idx
            for idx, profile in enumerate(self.profiles)
            if not _extract_profile_url(profile)
        ]
        if missing:
            raise ValueError("Each profile must include a 'profile_url' or 'url' value")
        return self


def _extract_profile_url(profile: Dict[str, Any]) -> Optional[str]:
    url_value = profile.get("profile_url") or profile.get("url") or profile.get("input_url")
    if isinstance(url_value, str) and url_value.strip():
        return url_value.strip()
    return None


class BrightDataStageResponse(BaseModel):
    success: bool
    results: List[Dict[str, Any]]
    brightdata_results: List[Dict[str, Any]]
    count: int


class ProfileFitStageRequest(BaseModel):
    profiles: List[Dict[str, Any]] = Field(..., min_items=1)
    business_fit_query: str = Field(..., min_length=1)
    max_profiles: Optional[int] = Field(default=None, ge=1, le=50000)
    max_posts: int = Field(default=6, ge=1, le=20)
    model: str = Field(default="gpt-5-mini")
    verbosity: str = Field(default="medium")
    concurrency: int = Field(default=64, ge=1, le=64)
    use_brightdata: bool = Field(default=False)


class ProfileFitStageResponse(BaseModel):
    success: bool
    results: List[Dict[str, Any]]
    brightdata_results: List[Dict[str, Any]]
    profile_fit: List[Dict[str, Any]]
    count: int


class ImageRefreshRequest(BaseModel):
    """Payload to refresh images for explicit usernames."""

    usernames: List[str] = Field(..., min_items=1, max_items=50)
    update_database: bool = Field(default=False)


class ImageRefreshSearchRequest(BaseModel):
    """Payload to refresh images for a batch of search results."""

    search_results: List[Dict[str, Any]] = Field(..., min_items=1)
    update_database: bool = Field(default=True)
