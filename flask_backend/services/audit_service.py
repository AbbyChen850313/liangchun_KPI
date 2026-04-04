"""
Audit log service — persists admin operation records to Firestore `audit_logs`.

Writes are fire-and-forget: failures are logged but never propagate to callers.
This ensures audit logging never disrupts business operations.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


def write_audit_log(
    *,
    actor_name: str,
    actor_uid: str,
    action: str,
    details: dict[str, Any],
    is_test: bool,
) -> None:
    """
    Write a structured audit record to Firestore `audit_logs` (or `test_audit_logs`).

    Fields stored:
      actorName  — display name of the operator
      actorUid   — LINE UID of the operator
      action     — machine-readable operation name (e.g. "batch_submit")
      details    — arbitrary dict of operation-specific context
      isTest     — whether this occurred in the test environment
      timestamp  — UTC ISO-8601 string
    """
    try:
        import firebase_admin
        from firebase_admin import credentials as fb_creds, firestore as fb_store
    except ImportError:
        logger.warning("audit_service: firebase_admin not installed; skipping audit log")
        return

    try:
        import config

        if not firebase_admin._apps:
            sa_info = config.gcp_sa_info()
            firebase_admin.initialize_app(fb_creds.Certificate(sa_info))

        db = fb_store.client()
        collection = "test_audit_logs" if is_test else "audit_logs"

        db.collection(collection).add({
            "actorName": actor_name,
            "actorUid": actor_uid,
            "action": action,
            "details": details,
            "isTest": is_test,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        # Audit failures must never surface to callers
        logger.exception("audit_service: failed to write audit log for action=%s", action)
