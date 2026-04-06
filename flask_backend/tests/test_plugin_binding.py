"""
Plugin Binding Tests — 驗證 Base ↔ Plugin 介面解耦

測試策略：
- Mock KpiAccountStore（AccountStorePort 的實作），完全不碰真實 Sheets / Firestore
- 直接呼叫 auth route，驗證各種顧客旅程路徑
- 確保 NameError 修復後 bind_account 在成功路徑上不爆炸
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from app import create_app


@pytest.fixture
def app():
    application = create_app()
    application.config["TESTING"] = True
    return application


@pytest.fixture
def client(app):
    return app.test_client()


# ── Mock 工廠 ────────────────────────────────────────────────

def _mock_store(
    *,
    uid_account=None,        # find_by_uid 回傳的 account
    field_account=None,      # find_by_fields 回傳的 account
    field_row=1,
    name_exists=False,
):
    """建立一個可設定回傳值的 AccountStorePort mock。"""
    store = MagicMock()
    store.find_by_uid.return_value = (uid_account, 0 if uid_account else -1)
    store.find_by_fields.return_value = (field_account, field_row if field_account else -1)
    store.name_exists.return_value = name_exists
    store.get_settings.return_value = {"bindVerifyCode": "TEST123"}
    store.bind.return_value = None
    return store


def _bind_token(client, line_uid="U_test_001", display_name="測試員工"):
    """取得 bind token（模擬 LIFF session 後未綁定狀態）。"""
    with patch("routes.auth.verify_access_token") as mock_verify, \
         patch("routes.auth._STORE") as mock_store_patch:
        mock_verify.return_value = {"userId": line_uid, "displayName": display_name}
        mock_store_patch.find_by_uid.return_value = (None, -1)
        mock_store_patch.get_settings.return_value = {"bindVerifyCode": "TEST123"}
        resp = client.post(
            "/api/auth/session",
            json={"accessToken": "fake_token", "isTest": True},
        )
    # Session endpoint returns 401 with bindToken in body when account is unbound
    assert resp.status_code == 401
    return resp.get_json().get("bindToken", "")


# ── 綁定流程測試 ─────────────────────────────────────────────

class TestBindCheckEndpoint:
    """GET /api/auth/bind-check — 決定分流（直接姓名+員編 vs 驗證碼）"""

    def test_name_in_employee_list_returns_direct_flow(self, client):
        store = _mock_store(name_exists=True)
        with patch("routes.auth._STORE", store), \
             patch("routes.auth.decode_bind_token") as mock_decode:
            mock_decode.return_value = {"lineUid": "U001", "displayName": "王小明"}
            # bindToken is passed as a query param (route reads request.args.get("bindToken"))
            resp = client.get(
                "/api/auth/bind-check",
                query_string={"bindToken": "fake_bind_token", "isTest": "true"},
            )
        assert resp.status_code == 200
        assert resp.get_json()["inEmployeeList"] is True

    def test_name_not_in_list_returns_verify_code_flow(self, client):
        store = _mock_store(name_exists=False)
        with patch("routes.auth._STORE", store), \
             patch("routes.auth.decode_bind_token") as mock_decode:
            mock_decode.return_value = {"lineUid": "U002", "displayName": "訪客用戶"}
            resp = client.get(
                "/api/auth/bind-check",
                query_string={"bindToken": "fake_bind_token", "isTest": "true"},
            )
        assert resp.status_code == 200
        assert resp.get_json()["inEmployeeList"] is False


class TestBindAccountEndpoint:
    """POST /api/auth/bind — 顧客旅程核心路徑"""

    def test_successful_bind_returns_200_with_name(self, client):
        """成功綁定：回傳 200 + name，且不再爆 NameError"""
        employee_account = {
            "name": "陳小華", "role": "同仁", "jobTitle": "工程師",
            "status": "未綁定", "lineUid": "",
        }
        store = _mock_store(field_account=employee_account)
        with patch("routes.auth._STORE", store), \
             patch("routes.auth.decode_bind_token") as mock_decode, \
             patch("routes.auth.push_message"), \
             patch("routes.auth.write_audit_log"):
            mock_decode.return_value = {"lineUid": "U_new_001", "displayName": "陳小華"}
            # Route reads flat body keys (name, employeeId) via validate_bind_fields
            resp = client.post(
                "/api/auth/bind",
                json={
                    "bindToken": "fake_bind_token",
                    "name": "陳小華",
                    "employeeId": "E001",
                    "isTest": True,
                },
            )
        data = resp.get_json()
        assert resp.status_code == 200
        assert data["success"] is True
        assert data["name"] == "陳小華"
        store.bind.assert_called_once()

    def test_employee_not_found_returns_404(self, client):
        """找不到員工 → 404，不繼續執行"""
        store = _mock_store(field_account=None)
        with patch("routes.auth._STORE", store), \
             patch("routes.auth.decode_bind_token") as mock_decode:
            mock_decode.return_value = {"lineUid": "U_ghost", "displayName": "不存在的人"}
            resp = client.post(
                "/api/auth/bind",
                json={
                    "bindToken": "fake_bind_token",
                    "name": "不存在的人",
                    "employeeId": "X999",
                    "isTest": True,
                },
            )
        assert resp.status_code == 404
        store.bind.assert_not_called()

    def test_already_bound_returns_409(self, client):
        """已綁定帳號重試 → 409，Sheets 不被再次寫入"""
        already_bound = {
            "name": "李大同", "role": "同仁", "status": "已授權",
            "lineUid": "U_existing_001",
        }
        store = _mock_store(field_account=already_bound)
        with patch("routes.auth._STORE", store), \
             patch("routes.auth.decode_bind_token") as mock_decode:
            mock_decode.return_value = {"lineUid": "U_new_002", "displayName": "李大同"}
            resp = client.post(
                "/api/auth/bind",
                json={
                    "bindToken": "fake_bind_token",
                    "name": "李大同",
                    "employeeId": "E002",
                    "isTest": True,
                },
            )
        assert resp.status_code == 409
        store.bind.assert_not_called()

    def test_line_push_failure_does_not_rollback_bind(self, client):
        """LINE push 失敗不能讓綁定回滾 — bind() 必須已被呼叫"""
        employee_account = {
            "name": "張三", "role": "同仁", "jobTitle": "業務",
            "status": "未綁定", "lineUid": "",
        }
        store = _mock_store(field_account=employee_account)
        with patch("routes.auth._STORE", store), \
             patch("routes.auth.decode_bind_token") as mock_decode, \
             patch("routes.auth.push_message", side_effect=Exception("LINE 掛了")), \
             patch("routes.auth.write_audit_log"):
            mock_decode.return_value = {"lineUid": "U_003", "displayName": "張三"}
            resp = client.post(
                "/api/auth/bind",
                json={
                    "bindToken": "fake_bind_token",
                    "name": "張三",
                    "employeeId": "E003",
                    "isTest": True,
                },
            )
        assert resp.status_code == 200          # 綁定仍成功
        store.bind.assert_called_once()         # Sheets 已寫入


class TestPluginDecoupling:
    """驗證 Base 不依賴 KPI Plugin 具體實作"""

    def test_swapping_store_implementation_changes_behaviour(self, client):
        """換掉 Plugin 實作，auth route 行為跟著改變（不是綁死 KpiAccountStore）"""
        custom_store = _mock_store(field_account=None)   # 這個 store 永遠找不到員工
        with patch("routes.auth._STORE", custom_store), \
             patch("routes.auth.decode_bind_token") as mock_decode:
            mock_decode.return_value = {"lineUid": "U_999", "displayName": "任何人"}
            resp = client.post(
                "/api/auth/bind",
                json={
                    "bindToken": "fake",
                    "name": "任何人",
                    "employeeId": "X",
                    "isTest": True,
                },
            )
        # 換 store → 行為改變，確認 route 真的透過 Port 呼叫
        assert resp.status_code == 404
        custom_store.find_by_fields.assert_called_once()
