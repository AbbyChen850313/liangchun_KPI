"""
KPI 角色權限隔離整合測試。

驗收條件：
  AC1: 同仁 (role=同仁) 無法存取主管評分端點 → 403
  AC2: 主管只能評分自己負責科別的員工，跨科別操作被拒絕 → 403
  AC3: HR 可查看全公司評分狀態；batch-submit 不可改寫已送出的評分（skipped）

執行（從 flask_backend/ 目錄）：
    COLLECTION_PREFIX=test_ JWT_SECRET=testsecret pytest tests/test_kpi_permission.py -v
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


class _ScoreStore:
    """In-memory fake 評分記錄 worksheet (stateful for per-test upsert/read)."""

    _HEADER = [
        "quarter", "managerName", "empName", "section", "weight",
        "item1", "item2", "item3", "item4", "item5", "item6",
        "rawScore", "special", "finalScore", "weightedScore",
        "note", "status", "updatedAt",
    ]

    def __init__(self) -> None:
        self._rows: list[list] = [self._HEADER[:]]

    def reset(self) -> None:
        self._rows = [self._HEADER[:]]

    def get_all_values(self) -> list[list]:
        return [r[:] for r in self._rows]

    def append_row(self, row: list, **_kw) -> None:
        self._rows.append(list(row))

    def update(self, range_str: str, values: list[list], **_kw) -> None:
        import re
        m = re.match(r"A(\d+)", range_str)
        if m:
            idx = int(m.group(1)) - 1
            if 0 < idx < len(self._rows):
                self._rows[idx] = list(values[0])

    def delete_rows(self, idx: int, **_kw) -> None:
        if 0 < idx < len(self._rows):
            del self._rows[idx - 1]

    def update_cell(self, *_a, **_kw) -> None:
        pass


_score_store = _ScoreStore()


def _build_stubs() -> types.ModuleType:
    """Register all external-dependency stubs before importing app."""

    gs = _stub_module("gspread")
    exceptions_mod = types.ModuleType("gspread.exceptions")

    class APIError(Exception):
        pass

    exceptions_mod.APIError = APIError
    gs.exceptions = exceptions_mod
    sys.modules["gspread.exceptions"] = exceptions_mod

    class _FakeWorksheetResponsibilities:
        def get_all_values(self):
            # 張主管 → 人事科 only (section isolation)
            return [
                ["section", "jobTitle", "name", "lineUid", "employeeId", "weight"],
                ["人事科", "主任", "張主管", "Umgr1", "", "0.6"],
            ]

    class _FakeWorksheetEmployees:
        def get_all_values(self):
            # 王員工 is in 人事科; 李員工 is in 業務科 (different section)
            return [
                ["employeeId", "name", "dept", "section", "joinDate", "leaveDate"],
                ["001", "王員工", "行政部", "人事科", "", ""],
                ["002", "李員工", "業務部", "業務科", "", ""],
            ]

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
        def worksheet(self, name: str):
            if name == "主管權重":
                return _FakeWorksheetResponsibilities()
            if name == "考核名單":
                return _FakeWorksheetEmployees()
            if name == "評分記錄":
                return _score_store
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
    _score_store.reset()
    _svc.gspread = _build_stubs()
    _svc._ws_cache.clear()
    _svc._year_score_cache.clear()
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _token(role: str, line_uid: str = "Utest", name: str = "測試用戶",
           responsibilities: list | None = None) -> dict:
    token = issue_session_token(
        line_uid=line_uid, name=name, role=role,
        is_test=True, responsibilities=responsibilities or [],
    )
    return {"Authorization": f"Bearer {token}"}


def _manager_header() -> dict:
    return _token(
        role="主管", line_uid="Umgr1", name="張主管",
        responsibilities=[{"section": "人事科", "lineUid": "Umgr1", "weight": 0.6}],
    )


def _employee_header() -> dict:
    return _token(role="同仁", line_uid="Uemp1", name="王員工")


def _hr_header() -> dict:
    return _token(role="HR", line_uid="Uhr01", name="測試HR")


def _valid_submit_payload(section: str = "人事科", emp_name: str = "王員工") -> dict:
    return {
        "empName": emp_name,
        "section": section,
        "scores": {f"item{i}": "甲" for i in range(1, 7)},
        "special": 0,
        "note": "",
        "quarter": "115Q1",
    }


# ── AC1: 同仁不能存取主管評分端點 ─────────────────────────────────────────


class TestEmployeePermissions:
    """同仁只能操作自評端點，無法存取主管評分端點。"""

    def test_employee_cannot_submit_manager_score(self, client):
        """同仁呼叫 POST /api/scoring/submit → 403（需要主管角色）。"""
        res = client.post(
            "/api/scoring/submit",
            headers=_employee_header(),
            json=_valid_submit_payload(),
        )
        assert res.status_code == 403

    def test_employee_cannot_access_my_scores(self, client):
        """同仁呼叫 GET /api/scoring/my-scores → 403。"""
        res = client.get("/api/scoring/my-scores", headers=_employee_header())
        assert res.status_code == 403

    def test_employee_can_access_own_self_score(self, client):
        """同仁可查詢自己的自評（GET /api/scoring/my-self-score）→ 200。"""
        res = client.get("/api/scoring/my-self-score", headers=_employee_header())
        assert res.status_code == 200


# ── AC2: 主管只能評自己負責的科別 ─────────────────────────────────────────


class TestManagerSectionIsolation:
    """主管跨科別送出評分應被拒絕。"""

    def test_manager_submit_own_section_succeeds(self, client):
        """主管對自己負責科別的員工送出評分 → 200。"""
        res = client.post(
            "/api/scoring/submit",
            headers=_manager_header(),
            json=_valid_submit_payload(section="人事科", emp_name="王員工"),
        )
        assert res.status_code == 200

    def test_manager_cannot_submit_other_section(self, client):
        """主管對不在自己負責範圍的科別送出評分 → 403。"""
        res = client.post(
            "/api/scoring/submit",
            headers=_manager_header(),
            json=_valid_submit_payload(section="業務科", emp_name="李員工"),
        )
        assert res.status_code == 403
        body = res.get_json()
        assert "無此科別" in body.get("error", ""), (
            f"錯誤訊息應含「無此科別」，實際為：{body}"
        )

    def test_manager_cannot_submit_employee_not_in_section(self, client):
        """主管科別正確但員工不屬於該科別 → 403。"""
        # 王員工在人事科，但這裡送入一個不存在於人事科的員工名稱
        res = client.post(
            "/api/scoring/submit",
            headers=_manager_header(),
            json=_valid_submit_payload(section="人事科", emp_name="不存在員工"),
        )
        assert res.status_code == 403


# ── AC3: HR 可查看全公司，不可改寫已送出評分 ──────────────────────────────


class TestHRViewAndWritePermissions:
    """HR 可查看全公司狀態；batch-submit 遇到已送出的評分應 skip 而非覆寫。"""

    def test_hr_can_view_all_status(self, client):
        """HR 可查看所有主管的評分進度 → 200。"""
        res = client.get("/api/scoring/all-status", headers=_hr_header())
        assert res.status_code == 200

    def test_non_hr_cannot_view_all_status(self, client):
        """主管無法查看全公司評分狀態（all-status 限 HR/SysAdmin）→ 403。"""
        res = client.get("/api/scoring/all-status", headers=_manager_header())
        assert res.status_code == 403

    def test_hr_batch_submit_skips_already_submitted(self, client):
        """AC3: HR batch-submit 遇到已送出的員工應 skip，不可覆寫。

        流程：
          1. 主管先對 王員工 送出評分（寫入 _score_store）
          2. HR 再用 batch-submit 送同一員工
          期望：submitted=0, skipped=1（已送出不可重複寫入）
        """
        # Step 1: 主管送出評分
        r1 = client.post(
            "/api/scoring/submit",
            headers=_manager_header(),
            json=_valid_submit_payload(),
        )
        assert r1.status_code == 200, f"主管送出應成功，但回 {r1.status_code}: {r1.get_json()}"

        # Step 2: HR 嘗試 batch-submit 同一員工
        r2 = client.post(
            "/api/admin/batch-submit",
            headers=_hr_header(),
            json={
                "quarter": "115Q1",
                "entries": [{
                    "managerName": "張主管",
                    "managerLineUid": "Umgr1",
                    "empName": "王員工",
                    "section": "人事科",
                    "scores": {f"item{i}": "丁" for i in range(1, 7)},
                    "special": 0,
                    "note": "",
                }],
            },
        )
        assert r2.status_code == 200
        body = r2.get_json()
        assert body["submitted"] == 0, (
            f"已送出的評分被 batch-submit 覆寫了！submitted={body['submitted']}"
        )
        assert body["skipped"] == 1, (
            f"期望 skipped=1，實際 skipped={body['skipped']}"
        )
