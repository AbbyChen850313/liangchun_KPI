"""
End-to-end smoke tests for the Flask backend.
Run from the flask_backend/ directory:

    COLLECTION_PREFIX=test_ JWT_SECRET=testsecret pytest tests/ -v

These tests use a real Flask test client but stub all external services
(Sheets, LINE, Firestore) so no network calls are made.
"""

from __future__ import annotations

import json
import os
import sys
import types

# ── Ensure flask_backend/ is on sys.path ──────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# ── Stub heavy external dependencies before importing app ─────────────────

def _stub_module(name: str) -> types.ModuleType:
    mod = types.ModuleType(name)
    sys.modules[name] = mod
    return mod


def _build_gspread_stub():
    gs = _stub_module("gspread")

    class _FakeWorksheet:
        def get_all_values(self):
            return [["name", "lineUid", "displayName", "boundAt", "status",
                     "jobTitle", "phone", "role", "clearFlag", "testUid", "employeeId"]]

        def worksheet(self, name):
            return self

        def update_cell(self, *a, **kw):
            pass

    class _FakeSpreadsheet:
        def worksheet(self, name):
            return _FakeWorksheet()

    class _FakeClient:
        def open_by_key(self, key):
            return _FakeSpreadsheet()

    gs.authorize = lambda creds: _FakeClient()
    gs.Client = _FakeClient
    gs.Spreadsheet = _FakeSpreadsheet
    gs.Worksheet = _FakeWorksheet
    return gs


def _build_google_oauth_stub():
    google = _stub_module("google")
    google.oauth2 = _stub_module("google.oauth2")
    google.oauth2.service_account = _stub_module("google.oauth2.service_account")

    class _FakeCreds:
        @staticmethod
        def from_service_account_info(info, scopes=None):
            return object()

    google.oauth2.service_account.Credentials = _FakeCreds
    return google


def _build_firebase_stub():
    fb = _stub_module("firebase_admin")
    fb._apps = {"default": True}  # pretend already initialised
    fb.initialize_app = lambda *a, **kw: None
    fb.credentials = _stub_module("firebase_admin.credentials")

    class _FakeFS:
        def collection(self, name):
            return self
        def document(self, uid):
            return self
        def set(self, data, merge=False):
            pass

    fb_store = _stub_module("firebase_admin.firestore")
    fb_store.client = lambda: _FakeFS()
    return fb


_build_gspread_stub()
_build_google_oauth_stub()
_build_firebase_stub()

# Stub google.cloud.secretmanager so config._get_secret falls back to env
_stub_module("google.cloud")
_stub_module("google.cloud.secretmanager")

# Stub LINE SDK
line_pkg = _stub_module("linebot")
line_pkg.v3 = _stub_module("linebot.v3")
for sub in ["oauth", "messaging", "messaging.models", "messaging.api"]:
    _stub_module(f"linebot.v3.{sub}")

# ── Set required env vars before importing config ─────────────────────────
os.environ.setdefault("JWT_SECRET", "test-secret-for-pytest")
os.environ.setdefault("GCP_SA_KEY", json.dumps({
    "type": "service_account",
    "project_id": "test",
    "private_key_id": "key_id",
    "private_key": (
        "-----BEGIN RSA PRIVATE KEY-----\n"
        "MIIEpAIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4PAtE" + "A" * 100 + "\n"
        "-----END RSA PRIVATE KEY-----\n"
    ),
    "client_email": "sa@test.iam.gserviceaccount.com",
    "client_id": "1234",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
}))
os.environ.setdefault("COLLECTION_PREFIX", "test_")
os.environ.setdefault("LINE_CHANNEL_TOKEN", "stub_token")
os.environ.setdefault("LINE_CHANNEL_TOKEN_TEST", "stub_token_test")
os.environ.setdefault("LINE_CHANNEL_SECRET", "stub_secret")
os.environ.setdefault("LINE_CHANNEL_SECRET_TEST", "stub_secret_test")
os.environ.setdefault("LINE_LOGIN_CHANNEL_SECRET", "stub_login_secret")
os.environ.setdefault("LINE_LOGIN_CHANNEL_SECRET_TEST", "stub_login_secret_test")

# ── Import app ────────────────────────────────────────────────────────────
import pytest
from app import create_app  # noqa: E402
from services.auth_service import issue_session_token  # noqa: E402


@pytest.fixture
def client():
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _auth_header(role: str = "系統管理員", is_test: bool = True) -> dict:
    token = issue_session_token(
        line_uid="test-uid-001",
        name="測試用戶",
        role=role,
        is_test=is_test,
    )
    return {"Authorization": f"Bearer {token}"}


# ── Tests ─────────────────────────────────────────────────────────────────

class TestHealth:
    def test_health_returns_200(self, client):
        res = client.get("/health")
        assert res.status_code == 200
        body = res.get_json()
        assert body["status"] == "ok"


class TestAuth:
    def test_check_missing_token_returns_401(self, client):
        res = client.get("/api/auth/check")
        assert res.status_code == 401

    def test_check_invalid_token_returns_401(self, client):
        res = client.get(
            "/api/auth/check",
            headers={"Authorization": "Bearer not.a.real.token"},
        )
        assert res.status_code == 401

    def test_check_valid_token_returns_200(self, client):
        """GET /api/auth/check with valid JWT should return 200."""
        res = client.get("/api/auth/check", headers=_auth_header())
        assert res.status_code == 200


class TestAdminRefreshRoles:
    def test_refresh_roles_requires_sysadmin(self, client):
        res = client.post(
            "/api/admin/refresh-roles",
            headers=_auth_header(role="HR"),
        )
        assert res.status_code == 403

    def test_refresh_roles_no_token_returns_401(self, client):
        res = client.post("/api/admin/refresh-roles")
        assert res.status_code == 401

    def test_refresh_roles_sysadmin_no_longer_501(self, client):
        """
        The endpoint must NOT return 501 anymore.
        It may return 200 (success) or 500 (if Sheets/Firestore stubs are incomplete),
        but never 501.
        """
        res = client.post(
            "/api/admin/refresh-roles",
            headers=_auth_header(role="系統管理員"),
        )
        assert res.status_code != 501, (
            f"refresh-roles still returns 501 — implementation missing. "
            f"Got: {res.status_code} {res.get_data(as_text=True)[:200]}"
        )


class TestAdminBatchReset:
    def test_batch_reset_missing_body_returns_400(self, client):
        res = client.post(
            "/api/admin/batch-reset",
            json={},
            headers=_auth_header(role="HR"),
        )
        assert res.status_code == 400

    def test_batch_reset_requires_auth(self, client):
        res = client.post("/api/admin/batch-reset", json={})
        assert res.status_code == 401


class TestAdminExportCsv:
    def test_export_csv_missing_quarter_returns_400(self, client):
        res = client.get("/api/admin/export-csv", headers=_auth_header(role="HR"))
        assert res.status_code == 400

    def test_export_csv_requires_auth(self, client):
        res = client.get("/api/admin/export-csv?quarter=2025Q1")
        assert res.status_code == 401


class TestScoringRoutes:
    def test_scoring_items_requires_auth(self, client):
        res = client.get("/api/scoring/items")
        assert res.status_code == 401

    def test_scoring_all_status_requires_auth(self, client):
        """GET /api/scoring/all-status should reject unauthenticated requests."""
        res = client.get("/api/scoring/all-status")
        assert res.status_code == 401

    def test_scoring_my_scores_requires_auth(self, client):
        res = client.get("/api/scoring/my-scores")
        assert res.status_code == 401


class TestUnknownRoute:
    def test_unknown_route_returns_404(self, client):
        res = client.get("/api/does-not-exist")
        assert res.status_code == 404
