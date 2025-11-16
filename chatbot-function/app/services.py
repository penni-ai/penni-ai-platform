"""External service integrations: Firebase Auth and Firestore."""

from __future__ import annotations

import logging
import os
import threading
from typing import Any, Dict

import firebase_admin
from firebase_admin import auth as firebase_auth, credentials
from google.cloud import firestore
from tenacity import retry, stop_after_attempt, wait_fixed

from app.config import get_settings
from app.models import CollectedData, ConversationSnapshot

logger = logging.getLogger(__name__)

# ============================================================================
# Firebase Authentication
# ============================================================================

_FIREBASE_APP = None
_FIREBASE_LOCK = threading.Lock()


class AuthenticationError(Exception):
    pass


def _initialize_app():
    """Initialize Firebase Admin SDK using Application Default Credentials.
    
    In Cloud Functions, ADC is automatically available via the service account.
    For local development, use: gcloud auth application-default login
    
    Automatically connects to Firebase emulators when FIREBASE_AUTH_EMULATOR_HOST is set.
    """
    global _FIREBASE_APP
    settings = get_settings()
    if firebase_admin._apps:
        _FIREBASE_APP = firebase_admin.get_app()
        return
    
    # Always use Application Default Credentials (ADC)
    # Cloud Functions automatically provides ADC via the service account
    # For local dev, configure with: gcloud auth application-default login
    cred = credentials.ApplicationDefault()

    # Check if Firebase Auth emulator is configured
    auth_emulator_host = os.environ.get("FIREBASE_AUTH_EMULATOR_HOST")
    if auth_emulator_host:
        logger.info(f"Using Firebase Auth emulator at %s", auth_emulator_host)
        # Firebase Admin SDK automatically respects this env var
    _FIREBASE_APP = firebase_admin.initialize_app(
        cred,
        {
            "projectId": settings.firebase_project,
        },
    )


def ensure_firebase_initialized():
    if _FIREBASE_APP is not None:
        return
    with _FIREBASE_LOCK:
        if _FIREBASE_APP is None:
            _initialize_app()


def verify_firebase_token(token: str) -> Dict[str, Any]:
    ensure_firebase_initialized()
    if not token:
        raise AuthenticationError("Missing bearer token")
    try:
        decoded = firebase_auth.verify_id_token(token, clock_skew_seconds=60)
    except Exception as exc:  # pylint: disable=broad-except
        raise AuthenticationError("Invalid Firebase token") from exc
    return decoded


# ============================================================================
# Firestore Synchronization
# ============================================================================


class FirestoreSync:
    def __init__(self, project_id: str):
        # Check if Firestore emulator is configured
        # FIRESTORE_EMULATOR_HOST is set by Firebase emulator (format: "host:port")
        emulator_host = os.environ.get("FIRESTORE_EMULATOR_HOST")
        if emulator_host:
            logger.info(f"Using Firestore emulator at {emulator_host}")
            # Firestore client will automatically use the emulator when FIRESTORE_EMULATOR_HOST is set
        self.client = firestore.Client(project=project_id)

    def _campaign_ref(self, uid: str, campaign_id: str) -> firestore.DocumentReference:
        return self.client.collection("users").document(uid).collection("campaigns").document(campaign_id)

    def _collected_doc(self, uid: str, campaign_id: str) -> firestore.DocumentReference:
        return self._campaign_ref(uid, campaign_id).collection("collected").document("data")

    @retry(stop=stop_after_attempt(5), wait=wait_fixed(0.5))
    def sync_collected_data(self, uid: str, campaign_id: str, collected: CollectedData):
        payload: Dict[str, Any] = collected.model_dump(by_alias=True)
        payload["updatedAt"] = collected.updatedAt
        self._collected_doc(uid, campaign_id).set(payload, merge=True)

    @retry(stop=stop_after_attempt(5), wait=wait_fixed(0.5))
    def update_campaign_snapshot(self, uid: str, campaign_id: str, snapshot: ConversationSnapshot):
        self._campaign_ref(uid, campaign_id).set(
            {
                "id": snapshot.id,
                "status": snapshot.status,
                "title": snapshot.collected.campaign_title or "Pending Campaign",
                "updatedAt": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )
