"""Scheduled cleanup for expired search pipeline documents."""
from __future__ import annotations

import logging
from collections import OrderedDict
from datetime import datetime, timezone
from typing import List, Sequence

from config import REGION
from firebase_functions import scheduler_fn
from google.cloud import exceptions

from stage_utils import PIPELINE_COLLECTION, get_firestore_client


logger = logging.getLogger(__name__)

MAX_DOCS_PER_RUN = 500
MAX_PIPELINES_PER_RUN = 100


def _extract_pipeline_id(doc_snapshot) -> str:
    data = doc_snapshot.to_dict() or {}
    pipeline_id = data.get("pipeline_id")
    if pipeline_id:
        return str(pipeline_id)
    doc_id = doc_snapshot.id
    return doc_id.split("_", 1)[0]


def _deduplicate_pipeline_ids(snapshots: Sequence) -> List[str]:
    dedup = OrderedDict()
    for snapshot in snapshots:
        pipeline_id = _extract_pipeline_id(snapshot)
        if not pipeline_id:
            continue
        dedup.setdefault(pipeline_id, None)
        if len(dedup) >= MAX_PIPELINES_PER_RUN:
            break
    return list(dedup.keys())


def _ttl_expired(ttl_value, now: datetime) -> bool:
    if ttl_value is None:
        return True
    if isinstance(ttl_value, datetime):
        return ttl_value <= now
    converter = getattr(ttl_value, "to_datetime", None)
    if converter is not None:
        return converter(tzinfo=timezone.utc) <= now
    return True


def _delete_pipeline_documents(pipeline_id: str, now: datetime) -> int:
    client = get_firestore_client()
    collection_ref = client.collection(PIPELINE_COLLECTION)
    snapshots = list(collection_ref.where("pipeline_id", "==", pipeline_id).stream())
    if not snapshots:
        return 0
    batch = client.batch()
    deletions = 0
    for snapshot in snapshots:
        data = snapshot.to_dict() or {}
        if not _ttl_expired(data.get("ttl"), now):
            continue
        batch.delete(snapshot.reference)
        deletions += 1
    if deletions == 0:
        return 0
    batch.commit()
    return deletions


@scheduler_fn.on_schedule(
    schedule="every 1 hours",
    timezone="Etc/UTC",
    region=REGION,
)
def cleanup_expired_pipelines(event: scheduler_fn.ScheduledEvent) -> None:
    """Delete search pipeline documents whose TTL has expired."""

    start_time = datetime.now(timezone.utc)
    client = get_firestore_client()
    collection_ref = client.collection(PIPELINE_COLLECTION)
    query = (
        collection_ref.where("ttl", "<", start_time)
        .order_by("ttl")
        .limit(MAX_DOCS_PER_RUN)
    )

    try:
        expired_snapshots = list(query.stream())
    except exceptions.GoogleCloudError as exc:  # pragma: no cover - defensive logging
        logger.exception("Failed to load expired pipeline documents", exc_info=exc)
        raise

    if not expired_snapshots:
        logger.info(
            "Cleanup skipped - no expired documents",
            extra={"checked": MAX_DOCS_PER_RUN, "schedule_time": getattr(event, "schedule_time", None)},
        )
        return

    pipeline_ids = _deduplicate_pipeline_ids(expired_snapshots)

    pipelines_processed = 0
    documents_deleted = 0
    for pipeline_id in pipeline_ids:
        try:
            removed = _delete_pipeline_documents(pipeline_id, start_time)
        except exceptions.GoogleCloudError as exc:  # pragma: no cover - defensive logging
            logger.exception(
                "Failed to delete expired pipeline documents",
                extra={"pipeline_id": pipeline_id},
                exc_info=exc,
            )
            continue

        if removed == 0:
            continue
        pipelines_processed += 1
        documents_deleted += removed
        logger.info(
            "Deleted expired pipeline documents",
            extra={"pipeline_id": pipeline_id, "count": removed},
        )

    logger.info(
        "Cleanup completed",
        extra={
            "pipelines_processed": pipelines_processed,
            "documents_deleted": documents_deleted,
            "duration_seconds": (datetime.now(timezone.utc) - start_time).total_seconds(),
        },
    )


__all__ = ["cleanup_expired_pipelines"]
