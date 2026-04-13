"""
KPI 匯出 CSV 欄位正確性測試。

驗收條件：
  AC1: 季度 CSV 包含所有必要欄位（季度/主管/員工/科別/原始分/加權分等 18 欄）
  AC2: 年度 CSV 包含所有必要欄位（員工/各季加權分/最終年度總分/等級）
  AC3: 非 HR 角色呼叫匯出端點回 403

執行（從 flask_backend/ 目錄）：
    COLLECTION_PREFIX=test_ JWT_SECRET=testsecret pytest tests/test_kpi_export.py -v
"""
from __future__ import annotations

import json
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


# ── Stub helpers (self-contained, following project test convention) ────────

def _stub_module(name: str) -> types.ModuleType:
    mod = types.ModuleType(name)
    sys.modules[name] = mod
    return mod


def _build_stubs() -> types.ModuleType:
    gs = _stub_module("gspread")
    exceptions_mod = types.ModuleType("gspread.exceptions")

    class APIError(Exception):
        pass

    exceptions_mod.APIError = APIError
    gs.exceptions = exceptions_mod
    sys.modules["gspread.exceptions"] = exceptions_mod

    class _FakeWorksheetDefault:
        def get_all_values(self):
            return [[
                "name", "lineUid", "displayName", "boundAt", "status",
                "jobTitle", "phone", "role", "clearFlag", "testUid", "employeeId",
            ]]

        def update_cell(self, *_a, **_kw): pass
        def append_row(self, *_a, **_kw): pass
        def update(self, *_a, **_kw): pass
        def delete_rows(self, *_a, **_kw): pass

    class _FakeSpreadsheet:
        def worksheet(self, _name: str):
            return _FakeWorksheetDefault()

    class _FakeClient:
        def open_by_key(self, _key):
            return _FakeSpreadsheet()

    gs.authorize = lambda _creds: _FakeClient()
    gs.Client = _FakeClient

    google = _stub_module("google")
    google.oauth2 = _stub_module("google.oauth2")
    google.oauth2.service_account = _stub_module("google.oauth2.service_account")

    class _FakeCreds:
        @staticmethod
        def from_service_account_info(_info, scopes=None):
            return object()

    google.oauth2.service_account.Credentials = _FakeCreds

    fb = _stub_module("firebase_admin")
    fb._apps = {"default": True}
    fb.initialize_app = lambda *_a, **_kw: None
    fb.credentials = _stub_module("firebase_admin.credentials")

    class _FakeFS:
        def collection(self, _name): return self
        def document(self, _uid): return self
        def set(self, _data, merge=False): pass

    fb_store = _stub_module("firebase_admin.firestore")
    fb_store.client = lambda: _FakeFS()

    _stub_module("google.cloud")
    _stub_module("google.cloud.secretmanager")

    line_pkg = _stub_module("linebot")
    line_pkg.v3 = _stub_module("linebot.v3")
    for sub in ["oauth", "messaging", "messaging.models", "messaging.api"]:
        _stub_module(f"linebot.v3.{sub}")

    return gs


_build_stubs()

os.environ["JWT_SECRET"] = "test-secret-for-pytest-min32chars!!"
os.environ.setdefault("GCP_SA_KEY", json.dumps({
    "type": "service_account", "project_id": "test",
    "private_key_id": "key_id",
    "private_key": (
        "-----BEGIN RSA PRIVATE KEY-----\n"
        "MIIEpAIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4PAtE" + "A" * 100 + "\n"
        "-----END RSA PRIVATE KEY-----\n"
    ),
    "client_email": "sa@test.iam.gserviceaccount.com", "client_id": "1234",
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

import pytest  # noqa: E402
from app import create_app  # noqa: E402
from services.auth_service import issue_session_token  # noqa: E402


# ── Fixtures ───────────────────────────────────────────────────────────────


@pytest.fixture
def client():
    import services.sheets_service as _svc
    _svc.gspread = _build_stubs()
    _svc._ws_cache.clear()
    _svc._year_score_cache.clear()
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _hr_header() -> dict:
    token = issue_session_token(
        line_uid="Uhr01", name="測試HR", role="HR", is_test=True,
    )
    return {"Authorization": f"Bearer {token}"}


def _manager_header() -> dict:
    token = issue_session_token(
        line_uid="Umgr1", name="張主管", role="主管", is_test=True,
        responsibilities=[{"section": "人事科", "lineUid": "Umgr1", "weight": 0.6}],
    )
    return {"Authorization": f"Bearer {token}"}


# ── Expected column definitions ────────────────────────────────────────────

_QUARTERLY_EXPECTED_COLUMNS = [
    "季度", "主管", "員工", "科別", "權重",
    "項目1", "項目2", "項目3", "項目4", "項目5", "項目6",
    "原始分", "特殊加減", "調整後分", "加權分", "備註", "狀態", "更新時間",
]

_ANNUAL_EXPECTED_COLUMNS = [
    "員工", "主管", "科別",
    "115Q1加權分", "115Q2加權分", "115Q3加權分", "115Q4加權分",
    "四季平均", "已完成季度數", "HR年度調整", "最終年度總分", "等級",
]


# ── AC1: 季度 CSV 欄位驗證 ─────────────────────────────────────────────────


class TestQuarterlyCsvExport:
    """季度匯出 CSV 欄位正確性。"""

    def test_quarterly_csv_has_all_required_columns(self, client):
        """GET /api/admin/export-csv?quarter=115Q1 → CSV 含所有規定欄位。"""
        res = client.get(
            "/api/admin/export-csv?quarter=115Q1",
            headers=_hr_header(),
        )
        assert res.status_code == 200
        assert "text/csv" in res.content_type

        header_line = res.data.decode("utf-8-sig").splitlines()[0]
        for col in _QUARTERLY_EXPECTED_COLUMNS:
            assert col in header_line, (
                f"季度 CSV 缺少欄位「{col}」，實際標題行：{header_line}"
            )

    def test_quarterly_csv_has_18_columns(self, client):
        """季度 CSV 標題行恰好有 18 個欄位。"""
        res = client.get(
            "/api/admin/export-csv?quarter=115Q1",
            headers=_hr_header(),
        )
        assert res.status_code == 200
        header_line = res.data.decode("utf-8-sig").splitlines()[0]
        columns = header_line.split(",")
        assert len(columns) == 18, (
            f"季度 CSV 應有 18 欄，實際有 {len(columns)} 欄：{columns}"
        )

    def test_non_hr_cannot_export_quarterly_csv(self, client):
        """主管無法呼叫季度 CSV 匯出端點 → 403。"""
        res = client.get(
            "/api/admin/export-csv?quarter=115Q1",
            headers=_manager_header(),
        )
        assert res.status_code == 403

    def test_quarterly_csv_missing_quarter_returns_400(self, client):
        """未提供 quarter 參數 → 400。"""
        res = client.get("/api/admin/export-csv", headers=_hr_header())
        assert res.status_code == 400


# ── AC2: 年度 CSV 欄位驗證 ─────────────────────────────────────────────────


class TestAnnualCsvExport:
    """年度匯出 CSV 欄位正確性（含等級欄）。"""

    def test_annual_csv_has_employee_and_score_columns(self, client):
        """GET /api/admin/export-annual-csv?year=115 → CSV 含員工、各季加權分欄位。"""
        res = client.get(
            "/api/admin/export-annual-csv?year=115",
            headers=_hr_header(),
        )
        assert res.status_code == 200
        assert "text/csv" in res.content_type

        header_line = res.data.decode("utf-8-sig").splitlines()[0]
        for col in ["員工", "主管", "科別", "115Q1加權分", "115Q2加權分",
                    "115Q3加權分", "115Q4加權分", "最終年度總分"]:
            assert col in header_line, (
                f"年度 CSV 缺少欄位「{col}」，實際標題行：{header_line}"
            )

    def test_annual_csv_has_grade_column(self, client):
        """年度 CSV 必須包含「等級」欄（甲/乙/丙/丁 評定）。"""
        res = client.get(
            "/api/admin/export-annual-csv?year=115",
            headers=_hr_header(),
        )
        assert res.status_code == 200
        header_line = res.data.decode("utf-8-sig").splitlines()[0]
        assert "等級" in header_line, (
            f"年度 CSV 缺少「等級」欄，實際標題行：{header_line}"
        )

    def test_annual_csv_has_hr_adjustment_column(self, client):
        """年度 CSV 必須包含「HR年度調整」欄（HR 年度加減分）。"""
        res = client.get(
            "/api/admin/export-annual-csv?year=115",
            headers=_hr_header(),
        )
        assert res.status_code == 200
        header_line = res.data.decode("utf-8-sig").splitlines()[0]
        assert "HR年度調整" in header_line, (
            f"年度 CSV 缺少「HR年度調整」欄，實際標題行：{header_line}"
        )

    def test_non_hr_cannot_export_annual_csv(self, client):
        """主管無法呼叫年度 CSV 匯出端點 → 403。"""
        res = client.get(
            "/api/admin/export-annual-csv?year=115",
            headers=_manager_header(),
        )
        assert res.status_code == 403

    def test_annual_csv_missing_year_returns_400(self, client):
        """未提供 year 參數 → 400。"""
        res = client.get("/api/admin/export-annual-csv", headers=_hr_header())
        assert res.status_code == 400
