"""
四季評分完整流程模擬測試。

驗收條件：
  AC1: 主管可對每季員工完成評分（4 季 × 1 員工 = 4 筆 submit → 全 200）
  AC2: annual-summary 回傳 4 季均有分數，completedCount == 4
  AC3: season-status 所有季度 status == "已完成"
  AC4: quarter-employees 所有員工 scoreStatus == "已送出"

執行方式（從 flask_backend/ 目錄）：
    COLLECTION_PREFIX=test_ JWT_SECRET=testsecret pytest tests/test_four_seasons.py -v
"""

from __future__ import annotations

import json
import os
import sys
import types
from unittest.mock import patch

# ── Ensure flask_backend/ is on sys.path ──────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


# ── Shared stub helpers (duplicated here to keep the file self-contained) ─

def _stub_module(name: str) -> types.ModuleType:
    mod = types.ModuleType(name)
    sys.modules[name] = mod
    return mod


# ── In-memory score store for upsert / read-back ──────────────────────────

class _ScoreStore:
    """Thread-local fake 評分記錄 worksheet that actually stores rows."""

    _HEADER = [
        "quarter", "managerName", "empName", "section", "weight",
        "item1", "item2", "item3", "item4", "item5", "item6",
        "rawScore", "special", "finalScore", "weightedScore",
        "note", "status", "updatedAt",
    ]

    def __init__(self) -> None:
        self._rows: list[list] = [self._HEADER[:]]

    def get_all_values(self) -> list[list]:
        return [r[:] for r in self._rows]

    def update(self, range_str: str, data: list[list], **_kw) -> None:
        # range_str like "A3:R3" → row index 3 (1-based)
        row_num = int(range_str.split(":")[0][1:])
        self._rows[row_num - 1] = data[0][:]

    def append_row(self, row: list, **_kw) -> None:
        self._rows.append(row[:])

    def delete_rows(self, idx: int) -> None:
        del self._rows[idx - 1]


_score_store = _ScoreStore()


def _build_stubs() -> None:
    """Register all external-dependency stubs before importing app."""

    # ── gspread ────────────────────────────────────────────────────────────
    gs = _stub_module("gspread")
    exceptions_mod = types.ModuleType("gspread.exceptions")

    class APIError(Exception):
        pass

    exceptions_mod.APIError = APIError
    gs.exceptions = exceptions_mod
    sys.modules["gspread.exceptions"] = exceptions_mod

    class _FakeWorksheetResponsibilities:
        def get_all_values(self):
            return [
                ["section", "jobTitle", "name", "lineUid", "testUid", "weight"],
                ["人事科", "主任", "張主管", "Lprod1", "Umgr1", "0.6"],
            ]

    class _FakeWorksheetEmployees:
        def get_all_values(self):
            return [
                ["employeeId", "name", "dept", "section", "joinDate", "leaveDate"],
                ["001", "王員工", "行政部", "人事科", "", ""],
            ]

    class _FakeWorksheetDefault:
        def get_all_values(self):
            return [[
                "name", "lineUid", "displayName", "boundAt", "status",
                "jobTitle", "phone", "role", "clearFlag", "testUid", "employeeId",
            ]]

        def update_cell(self, *a, **kw): pass
        def append_row(self, *a, **kw): pass
        def update(self, *a, **kw): pass
        def delete_rows(self, *a, **kw): pass

    class _FakeSpreadsheet:
        def worksheet(self, name: str):
            if name == "主管權重":
                return _FakeWorksheetResponsibilities()
            if name == "員工資料":
                return _FakeWorksheetEmployees()
            if name == "評分記錄":
                return _score_store
            return _FakeWorksheetDefault()

    class _FakeClient:
        def open_by_key(self, key):
            return _FakeSpreadsheet()

    gs.authorize = lambda creds: _FakeClient()
    gs.Client = _FakeClient

    # ── google.oauth2 ──────────────────────────────────────────────────────
    google = _stub_module("google")
    google.oauth2 = _stub_module("google.oauth2")
    google.oauth2.service_account = _stub_module("google.oauth2.service_account")

    class _FakeCreds:
        @staticmethod
        def from_service_account_info(info, scopes=None):
            return object()

    google.oauth2.service_account.Credentials = _FakeCreds

    # ── firebase_admin ─────────────────────────────────────────────────────
    fb = _stub_module("firebase_admin")
    fb._apps = {"default": True}
    fb.initialize_app = lambda *a, **kw: None
    fb.credentials = _stub_module("firebase_admin.credentials")

    class _FakeFS:
        def collection(self, name): return self
        def document(self, uid): return self
        def set(self, data, merge=False): pass

    fb_store = _stub_module("firebase_admin.firestore")
    fb_store.client = lambda: _FakeFS()

    # ── google.cloud.secretmanager ─────────────────────────────────────────
    _stub_module("google.cloud")
    _stub_module("google.cloud.secretmanager")

    # ── LINE SDK ───────────────────────────────────────────────────────────
    line_pkg = _stub_module("linebot")
    line_pkg.v3 = _stub_module("linebot.v3")
    for sub in ["oauth", "messaging", "messaging.models", "messaging.api"]:
        _stub_module(f"linebot.v3.{sub}")


_build_stubs()

# ── Environment variables ──────────────────────────────────────────────────
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

# ── Import app after stubs & env are in place ──────────────────────────────
import pytest  # noqa: E402
from app import create_app  # noqa: E402
from services.auth_service import issue_session_token  # noqa: E402

QUARTERS = ["115Q1", "115Q2", "115Q3", "115Q4"]
YEAR = "115"
MANAGER_UID = "Umgr1"
MANAGER_NAME = "張主管"
EMP_NAME = "王員工"
SECTION = "人事科"


def _manager_token() -> str:
    return issue_session_token(
        line_uid=MANAGER_UID,
        name=MANAGER_NAME,
        role="主管",
        is_test=True,
    )


def _auth() -> dict:
    return {"Authorization": f"Bearer {_manager_token()}"}


def _all_甲_payload(quarter: str) -> dict:
    return {
        "empName": EMP_NAME,
        "section": SECTION,
        "scores": {f"item{i}": "甲" for i in range(1, 7)},
        "special": 0,
        "note": "",
        "quarter": quarter,
    }


@pytest.fixture(scope="module")
def client():
    """Single app instance shared across all tests in this module."""
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture(autouse=True, scope="module")
def patch_scoring_period():
    """Override is_in_scoring_period so all 4 quarters accept submit."""
    with patch("routes.scoring.is_in_scoring_period", return_value=True):
        yield


class TestFourSeasonSimulation:
    """
    End-to-end: 主管對同一員工完成四季評分，驗證 AC1~AC4。
    """

    def test_ac1_submit_all_four_quarters(self, client):
        """AC1: 每季 submit 回 200 且 success=True。"""
        for quarter in QUARTERS:
            res = client.post(
                "/api/scoring/submit",
                headers=_auth(),
                json=_all_甲_payload(quarter),
            )
            body = res.get_json()
            assert res.status_code == 200, (
                f"quarter={quarter} 回 {res.status_code}: {body}"
            )
            assert body.get("success") is True, f"quarter={quarter} success≠True: {body}"

    def test_ac2_annual_summary_four_quarters_complete(self, client):
        """AC2: annual-summary completedCount == 4，四季均有 weightedScore。"""
        res = client.get(
            f"/api/scoring/annual-summary?year={YEAR}",
            headers=_auth(),
        )
        assert res.status_code == 200
        body = res.get_json()
        emp = body["summary"].get(EMP_NAME)
        assert emp is not None, "annual-summary 中找不到員工"
        assert emp["completedCount"] == 4, f"completedCount={emp['completedCount']} 不是 4"
        for q in QUARTERS:
            assert emp["quarters"][q] is not None, f"{q} weightedScore 為 null"

    def test_ac3_season_status_all_completed(self, client):
        """AC3: season-status 四季均為「已完成」。"""
        res = client.get(
            f"/api/scoring/season-status?year={YEAR}",
            headers=_auth(),
        )
        assert res.status_code == 200
        body = res.get_json()
        for q_info in body["quarters"]:
            assert q_info["status"] == "已完成", (
                f"{q_info['quarter']} status={q_info['status']} 不是「已完成」"
            )

    def test_ac4_quarter_employees_all_submitted(self, client):
        """AC4: 每季 quarter-employees 所有員工 scoreStatus == 「已送出」。"""
        for quarter in QUARTERS:
            res = client.get(
                f"/api/scoring/quarter-employees?quarter={quarter}",
                headers=_auth(),
            )
            assert res.status_code == 200
            body = res.get_json()
            for emp in body["employees"]:
                assert emp["scoreStatus"] == "已送出", (
                    f"{quarter} 員工 {emp['name']} scoreStatus={emp['scoreStatus']}"
                )

    def test_duplicate_submit_rejected(self, client):
        """P1: 同一主管對同一員工在同季度二次送出應被拒絕（409）。"""
        res = client.post(
            "/api/scoring/submit",
            headers=_auth(),
            json=_all_甲_payload("115Q1"),  # 115Q1 已在 test_ac1 中送出
        )
        assert res.status_code == 409, (
            f"重複送出應回 409，實際回 {res.status_code}: {res.get_json()}"
        )
        body = res.get_json()
        assert "已完成評分" in body.get("error", ""), (
            f"錯誤訊息應含「已完成評分」，實際為：{body}"
        )

    def test_draft_cannot_overwrite_submitted(self, client):
        """P0-1 防護：已送出的 Q1 不被草稿覆寫。"""
        payload = _all_甲_payload("115Q1")
        payload["scores"]["item1"] = "丁"  # 低分草稿
        res = client.post(
            "/api/scoring/draft",
            headers=_auth(),
            json=payload,
        )
        # 應回 200（保護靜默返回），但分數不應被改
        assert res.status_code == 200

        # 驗證 Q1 年度總分仍是 甲×6 的加權分（不被丁污染）
        summary_res = client.get(
            f"/api/scoring/annual-summary?year={YEAR}",
            headers=_auth(),
        )
        emp_data = summary_res.get_json()["summary"][EMP_NAME]
        q1_score = emp_data["quarters"]["115Q1"]
        assert q1_score is not None
        # 甲 rawScore=95, weight=0.6 → weightedScore=57.0
        assert abs(q1_score - 57.0) < 0.01, f"Q1 被草稿污染，分數變成 {q1_score}"

    def test_employee_history_returns_four_quarters(self, client):
        """P0-2: employee-history 端點回傳四季紀錄。"""
        res = client.get(
            f"/api/scoring/employee-history?empName={EMP_NAME}&year={YEAR}",
            headers=_auth(),
        )
        assert res.status_code == 200
        body = res.get_json()
        assert body["empName"] == EMP_NAME
        assert len(body["quarters"]) == 4
        for q in QUARTERS:
            assert q in body["quarters"], f"history 缺少 {q}"
            assert body["quarters"][q] is not None, f"history {q} 為 null"
