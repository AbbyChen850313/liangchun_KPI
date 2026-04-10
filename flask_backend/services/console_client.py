"""
Cross-project Firestore client for 紫精靈 (liangchun-console).

Uses CONSOLE_SA_KEY from Secret Manager to access the central console Firestore
without colliding with the KPI service's own Firebase app.
"""
from __future__ import annotations

import logging

from google.cloud import firestore as gcloud_firestore
from google.oauth2 import service_account

import config

logger = logging.getLogger(__name__)

_db: gcloud_firestore.Client | None = None
_CONSOLE_PROJECT = "liangchun-console"
_CONSOLE_DB_ID = "liangchun-console"


def get_console_db() -> gcloud_firestore.Client:
    """Return a lazily-initialised Firestore client for liangchun-console."""
    global _db
    if _db is not None:
        return _db

    sa_info = config.console_sa_info()
    credentials = service_account.Credentials.from_service_account_info(
        sa_info,
        scopes=["https://www.googleapis.com/auth/datastore"],
    )
    _db = gcloud_firestore.Client(
        project=_CONSOLE_PROJECT,
        database=_CONSOLE_DB_ID,
        credentials=credentials,
    )
    logger.info("console_client: 已連接 liangchun-console Firestore")
    return _db
