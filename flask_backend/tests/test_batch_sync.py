"""
Unit tests for _sync_employees_to_firestore batch write behaviour.

驗收條件：
  AC1: 小批量（< 500）時 batch.commit() 恰好被呼叫 1 次
  AC2: 超過 500 筆時 batch.commit() 被分段呼叫（ceil(N/500) 次）
  AC3: 回傳值等於實際員工數

執行：
    COLLECTION_PREFIX=test_ JWT_SECRET=testsecret pytest tests/test_batch_sync.py -v
"""

from __future__ import annotations

import os
import sys
import types
from unittest.mock import MagicMock, patch, call

# ── sys.path ─────────────────────────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

os.environ.setdefault("JWT_SECRET", "testsecret")
os.environ.setdefault("COLLECTION_PREFIX", "test_")


def _stub(name: str) -> types.ModuleType:
    mod = types.ModuleType(name)
    sys.modules[name] = mod
    return mod


# ── Stub heavy dependencies before importing app code ────────────────────────

# gspread
_gs = _stub("gspread")
_stub("gspread.exceptions")

# google hierarchy
_google = _stub("google")
_google.oauth2 = _stub("google.oauth2")
_google.oauth2.service_account = _stub("google.oauth2.service_account")
_google.auth = _stub("google.auth")
_stub("google.cloud.firestore")

class _FakeCreds:
    @staticmethod
    def from_service_account_info(info, scopes=None):
        return object()

_google.oauth2.service_account.Credentials = _FakeCreds

# firebase_admin
_fa = _stub("firebase_admin")
_fa._apps = {"[DEFAULT]": object()}  # pretend already initialised
_fa.initialize_app = MagicMock()
_fa.credentials = _stub("firebase_admin.credentials")
_fa.credentials.Certificate = MagicMock(return_value=object())
_stub("firebase_admin.firestore")

import pytest  # noqa: E402
from services.sheets_service import SheetsService  # noqa: E402


def _make_service(is_test: bool = True) -> SheetsService:
    svc = object.__new__(SheetsService)
    svc.is_test = is_test
    return svc


def _make_employees(n: int) -> list[dict]:
    return [{"empId": f"E{i:04d}", "name": f"員工{i}", "dept": "測試部",
             "section": "A", "joinDate": "2020-01-01", "leaveDate": ""}
            for i in range(1, n + 1)]


# ── helpers to build the mock Firestore db ───────────────────────────────────

def _mock_db(batch_mock: MagicMock) -> MagicMock:
    db = MagicMock()
    db.batch.return_value = batch_mock
    doc_ref = MagicMock()
    db.collection.return_value.document.return_value = doc_ref
    return db


# ── AC1: small batch (< 500) → commit called exactly once ────────────────────

def test_small_batch_commit_once():
    batch = MagicMock()
    db = _mock_db(batch)

    svc = _make_service()
    employees = _make_employees(10)

    import firebase_admin.firestore as fb_store
    fb_store.client = MagicMock(return_value=db)

    import config as cfg_mod
    with patch.object(cfg_mod, "gcp_sa_info", return_value={}):
        result = svc._sync_employees_to_firestore(employees)

    assert result == 10
    assert batch.commit.call_count == 1
    assert batch.set.call_count == 10


# ── AC2: exactly 500 employees → commit called once (full batch) ─────────────

def test_exactly_500_employees_commit_once():
    batch = MagicMock()
    db = _mock_db(batch)

    svc = _make_service()
    employees = _make_employees(500)

    import firebase_admin.firestore as fb_store
    fb_store.client = MagicMock(return_value=db)

    import config as cfg_mod
    with patch.object(cfg_mod, "gcp_sa_info", return_value={}):
        result = svc._sync_employees_to_firestore(employees)

    assert result == 500
    # 500 fills the batch exactly → commit at boundary, then batch_count == 0
    # so the trailing commit is NOT called; total commits == 1
    assert batch.commit.call_count == 1


# ── AC3: 501 employees → commit called twice ─────────────────────────────────

def test_over_500_employees_commit_twice():
    # Each call to db.batch() returns a fresh mock so we can track them separately
    batch1 = MagicMock()
    batch2 = MagicMock()
    batch_side_effects = [batch1, batch2]

    db = MagicMock()
    db.batch.side_effect = batch_side_effects
    doc_ref = MagicMock()
    db.collection.return_value.document.return_value = doc_ref

    svc = _make_service()
    employees = _make_employees(501)

    import firebase_admin.firestore as fb_store
    fb_store.client = MagicMock(return_value=db)

    import config as cfg_mod
    with patch.object(cfg_mod, "gcp_sa_info", return_value={}):
        result = svc._sync_employees_to_firestore(employees)

    assert result == 501
    assert batch1.commit.call_count == 1   # flushed at 500
    assert batch2.commit.call_count == 1   # trailing commit for the 1 remainder


# ── AC4: empty list → commit never called, returns 0 ────────────────────────

def test_empty_employees_no_commit():
    batch = MagicMock()
    db = _mock_db(batch)

    svc = _make_service()

    import firebase_admin.firestore as fb_store
    fb_store.client = MagicMock(return_value=db)

    import config as cfg_mod
    with patch.object(cfg_mod, "gcp_sa_info", return_value={}):
        result = svc._sync_employees_to_firestore([])

    assert result == 0
    assert batch.commit.call_count == 0
