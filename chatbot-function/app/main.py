"""Application entrypoint for the penni-chatbot service."""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langsmith import configure

from app.api import create_runtime, router, set_runtime
from app.config import get_settings
from app.database import setup_checkpointer_schema
from app.utils import configure_logging

app = FastAPI(title="Penni Chatbot", version="1.0.0")
settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger("penni.main")

# Configure LangSmith tracing if enabled
if settings.langsmith_enabled:
    logger.info("LangSmith tracing enabled")
    if settings.langsmith_endpoint:
        os.environ["LANGSMITH_ENDPOINT"] = settings.langsmith_endpoint
    if settings.langsmith_api_key:
        os.environ["LANGSMITH_API_KEY"] = settings.langsmith_api_key
    if settings.langsmith_project:
        os.environ["LANGSMITH_PROJECT"] = settings.langsmith_project
    configure()
    logger.info(f"LangSmith project: {settings.langsmith_project}")
else:
    logger.info("LangSmith tracing disabled")

app.include_router(router)

if settings.cors_origins_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.on_event("startup")
async def on_startup() -> None:
    logger.info("Starting penni-chatbot service", extra={"project": settings.google_cloud_project})
    # Initialize Firestore checkpointer
    setup_checkpointer_schema()
    runtime = create_runtime(settings)
    set_runtime(runtime)
    logger.info("Runtime initialized")


@app.on_event("shutdown")
async def on_shutdown() -> None:
    logger.info("Shutting down penni-chatbot service")


@app.get("/health")
async def healthcheck():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.api_host,
        port=settings.api_port,
        log_level=settings.log_level.lower(),
    )
