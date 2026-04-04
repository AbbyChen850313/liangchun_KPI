"""
Work diary service — CRUD for work_logs Firestore collection.

Each log entry is owned by the author (authorUid).
Writes are transactional; reads are filtered server-side.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

_COLLECTION = "work_logs"
_TEST_COLLECTION = "test_work_logs"


def _collection_name(is_test: bool) -> str:
    return _TEST_COLLECTION if is_test else _COLLECTION


def _db():
    """Return Firestore client, initialising firebase_admin on first call."""
    import firebase_admin
    from firebase_admin import credentials as fb_creds, firestore as fb_store

    import config

    if not firebase_admin._apps:
        firebase_admin.initialize_app(fb_creds.Certificate(config.gcp_sa_info()))

    return fb_store.client()


def create_log(
    *,
    author_uid: str,
    author_name: str,
    date: str,
    content: str,
    is_test: bool,
) -> str:
    """Insert a new work log. Returns the created document ID."""
    db = _db()
    now = datetime.now(timezone.utc).isoformat()
    _, doc_ref = db.collection(_collection_name(is_test)).add({
        "authorUid": author_uid,
        "authorName": author_name,
        "date": date,
        "content": content,
        "isTest": is_test,
        "createdAt": now,
        "updatedAt": now,
    })
    return doc_ref.id


def get_logs_by_uid(author_uid: str, is_test: bool) -> list[dict[str, Any]]:
    """Return all logs owned by a LINE UID, sorted by date descending."""
    db = _db()
    docs = (
        db.collection(_collection_name(is_test))
        .where("authorUid", "==", author_uid)
        .order_by("date", direction="DESCENDING")
        .stream()
    )
    return [{"id": doc.id, **doc.to_dict()} for doc in docs]


def get_logs_by_name(author_name: str, is_test: bool) -> list[dict[str, Any]]:
    """Return all logs for an employee name (used by managers for subordinate view)."""
    db = _db()
    docs = (
        db.collection(_collection_name(is_test))
        .where("authorName", "==", author_name)
        .order_by("date", direction="DESCENDING")
        .stream()
    )
    return [{"id": doc.id, **doc.to_dict()} for doc in docs]


def update_log(
    *,
    log_id: str,
    author_uid: str,
    date: str,
    content: str,
    is_test: bool,
) -> bool:
    """
    Update an existing log entry.
    Returns False if the document does not exist or is not owned by author_uid.
    """
    db = _db()
    doc_ref = db.collection(_collection_name(is_test)).document(log_id)
    doc = doc_ref.get()
    if not doc.exists or doc.to_dict().get("authorUid") != author_uid:
        return False
    doc_ref.update({
        "date": date,
        "content": content,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    })
    return True


def delete_log(*, log_id: str, author_uid: str, is_test: bool) -> bool:
    """
    Delete a log entry.
    Returns False if the document does not exist or is not owned by author_uid.
    """
    db = _db()
    doc_ref = db.collection(_collection_name(is_test)).document(log_id)
    doc = doc_ref.get()
    if not doc.exists or doc.to_dict().get("authorUid") != author_uid:
        return False
    doc_ref.delete()
    return True
