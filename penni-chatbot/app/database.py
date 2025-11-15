"""Database connection pool, checkpointer, and message storage."""

from __future__ import annotations

import logging
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator, List, Optional, Sequence
from urllib.parse import quote_plus
from uuid import uuid4

import psycopg2
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg2.extras import Json
from psycopg2.pool import ThreadedConnectionPool

from app.config import Settings, get_settings
from app.models import Message, MessageSource

logger = logging.getLogger(__name__)

# ============================================================================
# Connection Pool
# ============================================================================

_POOL: Optional[ThreadedConnectionPool] = None


def init_pool(settings: Settings) -> ThreadedConnectionPool:
    global _POOL
    if _POOL is not None:
        return _POOL

    if not settings.postgres_user or not settings.postgres_db:
        raise RuntimeError("Postgres configuration is incomplete")

    host = settings.postgres_host or "127.0.0.1"
    if settings.cloud_sql_connection_name:
        host = f"/cloudsql/{settings.cloud_sql_connection_name}"

    conn_kwargs = {
        "user": settings.postgres_user,
        "password": settings.postgres_password,
        "dbname": settings.postgres_db,
        "host": host,
        "port": settings.postgres_port,
        "connect_timeout": 10,
        "sslmode": "prefer",
    }

    _POOL = ThreadedConnectionPool(
        settings.postgres_pool_min,
        settings.postgres_pool_max,
        **conn_kwargs,
    )
    return _POOL


def get_pool() -> ThreadedConnectionPool:
    if _POOL is None:
        raise RuntimeError("Postgres pool has not been initialized")
    return _POOL


@contextmanager
def get_connection():
    pool = get_pool()
    conn = pool.getconn()
    conn.autocommit = False
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


def close_pool():
    global _POOL
    if _POOL is not None:
        _POOL.closeall()
        _POOL = None


# ============================================================================
# Checkpointer
# ============================================================================

_CHECKPOINTER: Optional[BaseCheckpointSaver] = None


def build_postgres_connection_string() -> str:
    """Build PostgreSQL connection string from settings.
    
    For Cloud SQL Unix sockets, psycopg requires the host to be specified
    as a query parameter, not in the URL path.
    """
    settings = get_settings()
    
    if not settings.postgres_user or not settings.postgres_db:
        raise ValueError("PostgreSQL configuration is incomplete. POSTGRES_USER and POSTGRES_DB must be set.")
    
    # URL encode password if it contains special characters
    password = quote_plus(settings.postgres_password or "")
    
    # Handle Cloud SQL Unix socket connection
    # psycopg requires Unix socket paths to be specified as a query parameter
    if settings.cloud_sql_connection_name:
        socket_path = f"/cloudsql/{settings.cloud_sql_connection_name}"
        # Format: postgresql://user:password@/database?host=/cloudsql/connection_name
        conn_str = f"postgresql://{settings.postgres_user}:{password}@/{settings.postgres_db}?host={quote_plus(socket_path)}"
    else:
        host = settings.postgres_host or "127.0.0.1"
        port = settings.postgres_port
        conn_str = f"postgresql://{settings.postgres_user}:{password}@{host}:{port}/{settings.postgres_db}"
    
    return conn_str


def setup_checkpointer_schema() -> None:
    """Set up database schema for PostgresSaver.
    
    This MUST be called during application startup to create the necessary
    tables and run migrations. According to LangGraph documentation, the
    setup() method must be called the first time the checkpointer is used.
    """
    settings = get_settings()
    
    if not settings.postgres_user or not settings.postgres_db:
        logger.warning("PostgreSQL not configured, skipping checkpointer schema setup")
        return
    
    try:
        conn_str = build_postgres_connection_string()
        with PostgresSaver.from_conn_string(conn_str) as checkpointer:
            # Setup creates tables and runs migrations - MUST be called first time
            checkpointer.setup()
            logger.info("PostgresSaver schema setup completed")
    except Exception as e:
        logger.error(f"Failed to setup PostgresSaver schema: {e}", exc_info=True)
        raise


def get_checkpointer() -> BaseCheckpointSaver:
    """Return global PostgreSQL checkpointer."""
    global _CHECKPOINTER
    
    if _CHECKPOINTER is not None:
        return _CHECKPOINTER
    
    settings = get_settings()
    
    if not settings.postgres_user or not settings.postgres_db:
        raise RuntimeError(
            "PostgreSQL configuration is required. "
            "Set POSTGRES_USER and POSTGRES_DB environment variables."
        )
    
    conn_str = build_postgres_connection_string()
    _CHECKPOINTER = PostgresSaver.from_conn_string(conn_str)
    return _CHECKPOINTER


# ============================================================================
# Message Store
# ============================================================================

MESSAGES_TABLE = "conversation_messages"


class MessageStore:
    def __init__(self) -> None:
        self._ensure_table()

    def _ensure_table(self) -> None:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    CREATE TABLE IF NOT EXISTS {MESSAGES_TABLE} (
                        id UUID PRIMARY KEY,
                        uid TEXT NOT NULL,
                        campaign_id TEXT NOT NULL,
                        role TEXT NOT NULL,
                        content TEXT NOT NULL,
                        type TEXT NOT NULL DEFAULT 'text',
                        turn_id TEXT,
                        sources JSONB NOT NULL DEFAULT '[]'::jsonb,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        sequence BIGSERIAL
                    );
                    """
                )
                cur.execute(
                    f"""
                    CREATE INDEX IF NOT EXISTS idx_{MESSAGES_TABLE}_campaign
                    ON {MESSAGES_TABLE} (uid, campaign_id, sequence);
                    """
                )

    def save_message(
        self,
        *,
        uid: str,
        campaign_id: str,
        role: str,
        content: str,
        turn_id: Optional[str] = None,
        message_type: str = "text",
        sources: Optional[Sequence[MessageSource]] = None,
    ) -> Message:
        message_id = str(uuid4())
        payload_sources = [source.model_dump(by_alias=True) for source in sources or []]
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    INSERT INTO {MESSAGES_TABLE} (
                        id, uid, campaign_id, role, content, type, turn_id, sources
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id, uid, campaign_id, role, content, type, turn_id, sources, created_at, sequence
                    """,
                    (
                        message_id,
                        uid,
                        campaign_id,
                        role,
                        content,
                        message_type,
                        turn_id,
                        Json(payload_sources),
                    ),
                )
                row = cur.fetchone()
        return self._row_to_message(row)

    def list_messages(self, uid: str, campaign_id: str) -> List[Message]:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT id, uid, campaign_id, role, content, type, turn_id, sources, created_at, sequence
                    FROM {MESSAGES_TABLE}
                    WHERE uid = %s AND campaign_id = %s
                    ORDER BY sequence ASC
                    """,
                    (uid, campaign_id),
                )
                rows = cur.fetchall()
        return [self._row_to_message(row) for row in rows]

    def _row_to_message(self, row) -> Message:
        (
            message_id,
            uid,
            campaign_id,
            role,
            content,
            msg_type,
            turn_id,
            sources,
            created_at,
            sequence,
        ) = row
        created = created_at if isinstance(created_at, datetime) else datetime.now(tz=timezone.utc)
        source_models = []
        if isinstance(sources, list):
            for raw in sources:
                if isinstance(raw, dict):
                    source_models.append(MessageSource(**raw))
        return Message(
            id=str(message_id),
            role=role,
            content=content,
            type=msg_type,
            created_at=created,
            turn_id=turn_id,
            sources=source_models,
            sequence=sequence,
        )

