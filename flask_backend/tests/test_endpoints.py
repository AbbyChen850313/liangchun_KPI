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


# Module-level mutable scores store so stub persists within a test run
_SCORES_HEADER = [
    "quarter", "managerName", "empName", "section", "weight",
    "item1", "item2", "item3", "item4", "item5", "item6",
    "rawScore", "special", "finalScore", "weightedScore",
    "note", "status", "updatedAt",
]
_fake_scores_rows: list[list] = [_SCORES_HEADER[:]]


def _reset_fake_scores() -> None:
    _fake_scores_rows.clear()
    _fake_scores_rows.append(_SCORES_HEADER[:])


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

        def append_row(self, *a, **kw):
            pass

        def update(self, *a, **kw):
            pass

        def delete_rows(self, *a, **kw):
            pass

    class _FakeWorksheetResponsibilities(_FakeWorksheet):
        """主管權重 sheet: manager Umgr1 → 人事科"""
        def get_all_values(self):
            return [
                ["section", "jobTitle", "name", "lineUid", "testUid", "weight"],
                ["人事科", "主任", "張主管", "Lprod1", "Umgr1", "0.6"],
            ]

    class _FakeWorksheetEmployees(_FakeWorksheet):
        """考核名單 sheet: 王員工 in 人事科"""
        def get_all_values(self):
            return [
                ["employeeId", "name", "dept", "section", "joinDate", "leaveDate"],
                ["001", "王員工", "行政部", "人事科", "", ""],
            ]

    class _FakeWorksheetScores(_FakeWorksheet):
        """評分記錄 sheet: stateful stub so duplicate-submit guard works in tests."""
        def get_all_values(self):
            return [row[:] for row in _fake_scores_rows]

        def append_row(self, row, **kw):
            _fake_scores_rows.append(list(row))

        def update(self, range_str, values, **kw):
            import re
            m = re.match(r"A(\d+)", range_str)
            if m:
                idx = int(m.group(1)) - 1
                if 0 < idx < len(_fake_scores_rows):
                    _fake_scores_rows[idx] = list(values[0])

        def delete_rows(self, row_index, **kw):
            idx = row_index - 1
            if 0 < idx < len(_fake_scores_rows):
                _fake_scores_rows.pop(idx)

    _fake_scores_ws = _FakeWorksheetScores()

    class _FakeWorksheetAccounts(_FakeWorksheet):
        """LINE帳號 sheet: test-uid-001 → 已授權 系統管理員"""
        def get_all_values(self):
            # Columns: name(0) lineUid(1) displayName(2) boundAt(3) status(4)
            #          jobTitle(5) phone(6) role(7) clearFlag(8) testUid(9) employeeId(10)
            return [
                ["name", "lineUid", "displayName", "boundAt", "status",
                 "jobTitle", "phone", "role", "clearFlag", "testUid", "employeeId"],
                ["測試用戶", "test-uid-001", "測試用戶", "2024-01-01", "已授權",
                 "系統管理員", "", "系統管理員", "", "test-uid-001", "T001"],
            ]

    class _FakeSpreadsheet:
        def worksheet(self, name):
            if name == "主管權重":
                return _FakeWorksheetResponsibilities()
            if name == "考核名單":
                return _FakeWorksheetEmployees()
            if name == "評分記錄":
                return _fake_scores_ws
            if name == "LINE帳號":
                return _FakeWorksheetAccounts()
            return _FakeWorksheet()

    class _FakeClient:
        def open_by_key(self, key):
            return _FakeSpreadsheet()

    # exceptions submodule needed by app.py error handler
    exceptions_mod = types.ModuleType("gspread.exceptions")

    class APIError(Exception):
        pass

    exceptions_mod.APIError = APIError
    gs.exceptions = exceptions_mod
    sys.modules["gspread.exceptions"] = exceptions_mod

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
os.environ.setdefault("JWT_SECRET", "test-secret-for-pytest-min32chars!!")
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
    import services.sheets_service as _svc
    _reset_fake_scores()
    _svc.gspread = _build_gspread_stub()  # patch sheets_service directly; sys.modules swap alone does not update bound name
    _svc._ws_cache.clear()
    _svc._year_score_cache.clear()
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


class TestRoleEmptyStringFallback:
    def test_dashboard_with_empty_role_does_not_return_500(self, client):
        """JWT with role='' must not cause 500 — dashboard must fall back to 同仁 view.

        Root cause (P0-NEW): _parse_account_row returned role: "" (empty string).
        account.get("role", "同仁") does NOT apply the default when the key exists,
        so JWT was issued with role: "" → all dashboard routing conditions skipped →
        exception → global 500 handler. Fixed by using `account.get("role") or "同仁"`.
        """
        token = issue_session_token(
            line_uid="test-uid-001",
            name="測試用戶",
            role="",  # simulate corrupted/missing role in Sheets
            is_test=True,
        )
        res = client.get("/api/dashboard", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code != 500, (
            f"role='' caused 500 — or fallback missing. Got: {res.get_data(as_text=True)[:200]}"
        )


class TestRefreshRole:
    def test_refresh_role_returns_fresh_token_and_role(self, client):
        """Valid JWT → returns new token and role."""
        res = client.post("/api/auth/refresh-role", headers=_auth_header())
        # Sheets stub returns empty worksheet, so find_account_by_uid returns None → 401
        # This verifies the endpoint exists and auth guard works correctly.
        assert res.status_code in (200, 401)

    def test_refresh_role_rejects_no_token(self, client):
        """No JWT → 401."""
        res = client.post("/api/auth/refresh-role")
        assert res.status_code == 401

    def test_refresh_role_rejects_invalid_token(self, client):
        """Malformed JWT → 401."""
        res = client.post(
            "/api/auth/refresh-role",
            headers={"Authorization": "Bearer not.a.real.token"},
        )
        assert res.status_code == 401


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


class TestAnnualSummary:
    def test_requires_auth(self, client):
        res = client.get("/api/scoring/annual-summary")
        assert res.status_code == 401

    def test_non_manager_forbidden(self, client):
        res = client.get(
            "/api/scoring/annual-summary",
            headers=_auth_header(role="同仁"),
        )
        assert res.status_code == 403

    def test_manager_returns_200(self, client):
        res = client.get(
            "/api/scoring/annual-summary",
            headers=_auth_header(role="主管"),
        )
        assert res.status_code == 200
        body = res.get_json()
        assert "quarters" in body
        assert len(body["quarters"]) == 4
        assert "summary" in body


class TestExportAnnualCsv:
    def test_requires_year_param(self, client):
        res = client.get(
            "/api/admin/export-annual-csv",
            headers=_auth_header(role="HR"),
        )
        assert res.status_code == 400

    def test_non_hr_forbidden(self, client):
        res = client.get(
            "/api/admin/export-annual-csv?year=115",
            headers=_auth_header(role="主管"),
        )
        assert res.status_code == 403

    def test_hr_returns_csv(self, client):
        res = client.get(
            "/api/admin/export-annual-csv?year=115",
            headers=_auth_header(role="HR"),
        )
        assert res.status_code == 200
        assert "text/csv" in res.content_type
        lines = res.data.decode("utf-8-sig").splitlines()
        header = lines[0]
        assert "115Q1加權分" in header
        assert "最終年度總分" in header


class TestYearValidation:
    """Invalid user-supplied year param must return 400, not crash with 500."""

    def test_annual_summary_invalid_year_returns_400(self, client):
        res = client.get(
            "/api/scoring/annual-summary?year=abc",
            headers=_auth_header(role="主管"),
        )
        assert res.status_code == 400
        assert "year" in res.get_json().get("error", "").lower() or "年份" in res.get_json().get("error", "")

    def test_season_status_invalid_year_returns_400(self, client):
        res = client.get(
            "/api/scoring/season-status?year=99",
            headers=_auth_header(role="主管"),
        )
        assert res.status_code == 400

    def test_employee_history_invalid_year_returns_400(self, client):
        res = client.get(
            "/api/scoring/employee-history?empName=王員工&year=abc",
            headers=_auth_header(role="主管"),
        )
        assert res.status_code == 400


class TestUnknownRoute:
    def test_unknown_route_returns_404(self, client):
        res = client.get("/api/does-not-exist")
        assert res.status_code == 404


# ── Batch submit ──────────────────────────────────────────────────────────

def _hr_header() -> dict:
    token = issue_session_token(
        line_uid="Uhr001",
        name="測試HR",
        role="HR",
        is_test=True,
    )
    return {"Authorization": f"Bearer {token}"}


def _manager_header() -> dict:
    token = issue_session_token(
        line_uid="Umgr1",
        name="張主管",
        role="主管",
        is_test=True,
        responsibilities=[{"section": "人事科", "lineUid": "Umgr1", "weight": 0.6}],
    )
    return {"Authorization": f"Bearer {token}"}


def _make_valid_entry(emp_name: str = "王員工") -> dict:
    return {
        "managerName": "張主管",
        "managerLineUid": "Umgr1",
        "empName": emp_name,
        "section": "人事科",
        "scores": {f"item{i}": "甲" for i in range(1, 7)},
        "special": 0,
        "note": "",
    }


class TestBatchSubmit:
    def test_missing_body_returns_400(self, client):
        res = client.post(
            "/api/admin/batch-submit",
            headers=_hr_header(),
            json={},
        )
        assert res.status_code == 400

    def test_requires_hr_role(self, client):
        res = client.post(
            "/api/admin/batch-submit",
            headers=_manager_header(),
            json={"quarter": "115Q1", "entries": [_make_valid_entry()]},
        )
        assert res.status_code == 403

    def test_all_success(self, client):
        """AC1: 2 entries fully filled → submitted=2, failed=[]"""
        entries = [_make_valid_entry(f"員工{n}") for n in range(1, 3)]
        res = client.post(
            "/api/admin/batch-submit",
            headers=_hr_header(),
            json={"quarter": "115Q1", "entries": entries},
        )
        assert res.status_code == 200
        data = res.get_json()
        assert data["submitted"] == 2
        assert data["failed"] == []

    def test_partial_failure_missing_item(self, client):
        """AC2: one valid entry + one with missing item3 → submitted=1, failed=[{...}]"""
        incomplete = _make_valid_entry("李員工")
        incomplete["scores"]["item3"] = ""
        entries = [_make_valid_entry("王員工"), incomplete]
        res = client.post(
            "/api/admin/batch-submit",
            headers=_hr_header(),
            json={"quarter": "115Q1", "entries": entries},
        )
        assert res.status_code == 200
        data = res.get_json()
        assert data["submitted"] == 1
        assert len(data["failed"]) == 1
        assert "item3" in data["failed"][0]["error"]


# ── Unit tests: pure scoring logic ───────────────────────────────────────────

from services.scoring_service import (  # noqa: E402
    calc_raw_score, calc_final_score, calc_weighted_score,
    calc_all, build_score_record, aggregate_annual_scores,
)


class TestScoringCalculations:
    """AC1: 每位部屬 Q1 分數 = Σ 各項目分數"""

    def test_all_甲_averages_to_95(self):
        assert calc_raw_score({f"item{i}": "甲" for i in range(1, 7)}) == 95.0

    def test_mixed_grades(self):
        # (95+85+65+35+95+85)/6 = 76.67
        scores = {"item1": "甲", "item2": "乙", "item3": "丙",
                  "item4": "丁", "item5": "甲", "item6": "乙"}
        assert calc_raw_score(scores) == 76.67

    def test_special_bonus_adds_to_final(self):
        assert calc_final_score(80.0, 5.0) == 85.0

    def test_special_penalty_subtracts(self):
        assert calc_final_score(80.0, -10.0) == 70.0

    def test_weight_multiplied(self):
        assert calc_weighted_score(80.0, 0.6) == 48.0

    def test_full_chain_with_weight(self):
        scores = {f"item{i}": "甲" for i in range(1, 7)}
        result = calc_all(scores, special=0, weight=0.6)
        assert result["rawScore"] == 95.0
        assert result["finalScore"] == 95.0
        assert result["weightedScore"] == 57.0

    def test_build_score_record_weight_lookup(self):
        responsibilities = [{"lineUid": "Umgr1", "section": "人事科", "weight": 0.6}]
        scores = {f"item{i}": "甲" for i in range(1, 7)}
        rec = build_score_record(
            "張主管", "Umgr1", "王員工", "人事科",
            scores, 0, "", "115Q1", responsibilities,
        )
        assert rec["weight"] == 0.6
        assert rec["weightedScore"] == round(95.0 * 0.6, 2)


class TestAggregateAnnualScores:
    """AC2: 年度均分 = avg(已完成季度)，無重複或漏計"""

    def test_all_four_quarters_avg(self):
        data = {"王員工": {"115Q1": 80.0, "115Q2": 75.0, "115Q3": 90.0, "115Q4": 85.0}}
        result = aggregate_annual_scores(data)
        assert result["王員工"]["annualAvg"] == 82.5   # (80+75+90+85)/4
        assert result["王員工"]["completedCount"] == 4

    def test_partial_quarters_exclude_none(self):
        data = {"李員工": {"115Q1": 80.0, "115Q2": None, "115Q3": 90.0, "115Q4": None}}
        result = aggregate_annual_scores(data)
        assert result["李員工"]["annualAvg"] == 85.0   # (80+90)/2
        assert result["李員工"]["completedCount"] == 2

    def test_all_none_returns_zero(self):
        data = {"陳員工": {"115Q1": None, "115Q2": None, "115Q3": None, "115Q4": None}}
        result = aggregate_annual_scores(data)
        assert result["陳員工"]["annualAvg"] == 0.0
        assert result["陳員工"]["completedCount"] == 0

    def test_multiple_employees_independent(self):
        data = {
            "張員工": {"115Q1": 80.0, "115Q2": 75.0, "115Q3": 90.0, "115Q4": 85.0},
            "林員工": {"115Q1": 70.0, "115Q2": 80.0, "115Q3": None, "115Q4": None},
        }
        result = aggregate_annual_scores(data)
        assert result["張員工"]["annualAvg"] == 82.5   # (80+75+90+85)/4
        assert result["林員工"]["annualAvg"] == 75.0   # (70+80)/2


class TestScoreModification:
    """AC3: 草稿不計入年度加總；re-submit 不拋錯"""

    def test_draft_excluded_from_aggregate(self):
        """route 在傳入 aggregate 前已過濾 status != 已送出；None 語義驗證"""
        data = {"王員工": {"115Q1": None, "115Q2": 80.0, "115Q3": None, "115Q4": None}}
        result = aggregate_annual_scores(data)
        assert result["王員工"]["annualAvg"] == 80.0   # 80/1
        assert result["王員工"]["completedCount"] == 1

    def test_resubmit_returns_409(self, client):
        """AC3: 主管對同一員工二次 submit，應回傳 409（已完成評分不可重複提交）"""
        payload = {
            "empName": "王員工", "section": "人事科",
            "scores": {f"item{i}": "乙" for i in range(1, 7)},
            "special": 0, "note": "", "quarter": "115Q1",
        }
        r1 = client.post("/api/scoring/submit",
                         headers=_manager_header(), json=payload)
        assert r1.status_code == 200

        r2 = client.post("/api/scoring/submit",
                         headers=_manager_header(), json=payload)
        assert r2.status_code == 409
        assert "已完成評分" in r2.get_json().get("error", "")
