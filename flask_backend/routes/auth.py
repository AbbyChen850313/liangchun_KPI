"""
/api/auth  — binding, session, and account management endpoints.
"""

from __future__ import annotations

import logging

from flask import Blueprint, g, jsonify, request

import config
from services.auth_service import (
    decode_bind_token,
    issue_bind_token,
    issue_session_token,
    require_auth,
    require_hr,
    require_sysadmin,
)
from services.line_service import exchange_auth_code, push_message, verify_access_token
from services.sheets_service import SheetsService

logger = logging.getLogger(__name__)
auth_bp = Blueprint("auth", __name__)


def _sheets(is_test: bool = False) -> SheetsService:
    return SheetsService(is_test=is_test)


def _session_from_access_token(access_token: str, is_test: bool):
    """
    Shared logic: verify access token, look up account, return JSON response.
    Used by both LIFF session and LINE Login OAuth session endpoints.
    """
    profile = verify_access_token(access_token)
    if not profile:
        return jsonify({"error": "LINE Token 驗證失敗"}), 401

    line_uid: str = profile["userId"]
    display_name: str = profile.get("displayName", "")

    sheets = _sheets(is_test)
    account, _ = sheets.find_account_by_uid(line_uid)
    if not account:
        bind_token = issue_bind_token(line_uid, display_name)
        return jsonify({"error": "帳號未綁定", "needBind": True, "bindToken": bind_token}), 401
    if account.get("status") != "已授權":
        return jsonify({"error": "帳號尚未授權，請聯繫 HR"}), 403

    token = issue_session_token(
        line_uid=line_uid,
        name=account["name"],
        role=account.get("role", "同仁"),
        is_test=is_test,
    )
    return jsonify({
        "token": token,
        "name": account["name"],
        "role": account.get("role", "同仁"),
        "jobTitle": account.get("jobTitle", ""),
    })


# ── POST /api/auth/session ─────────────────────────────────────────────────

@auth_bp.route("/session", methods=["POST"])
def create_session():
    """
    Verify a LIFF access token and return a signed session JWT.
    Body: { "accessToken": str, "isTest": bool }
    """
    body = request.get_json(silent=True) or {}
    access_token = body.get("accessToken", "")
    is_test = bool(body.get("isTest", False))

    if not access_token:
        return jsonify({"error": "缺少 accessToken"}), 400

    return _session_from_access_token(access_token, is_test)


# ── POST /api/auth/line-oauth ──────────────────────────────────────────────

@auth_bp.route("/line-oauth", methods=["POST"])
def line_oauth_session():
    """
    Exchange a LINE Login OAuth2 authorisation code for a session JWT.
    Used by external-browser (non-LIFF) login flow.

    Body: { "code": str, "redirectUri": str, "isTest": bool }
    """
    body = request.get_json(silent=True) or {}
    code = (body.get("code") or "").strip()
    redirect_uri = (body.get("redirectUri") or "").strip()
    is_test = bool(body.get("isTest", False))

    if not code or not redirect_uri:
        return jsonify({"error": "缺少 code 或 redirectUri"}), 400

    access_token = exchange_auth_code(code, redirect_uri, is_test)
    if not access_token:
        return jsonify({"error": "LINE 授權失敗，請重試"}), 401

    return _session_from_access_token(access_token, is_test)


# ── POST /api/auth/bind ────────────────────────────────────────────────────

@auth_bp.route("/bind", methods=["POST"])
def bind_account():
    """
    Bind a LINE account by verifying the access token + identity.

    Body: {
      "accessToken": str,
      "name": str,
      "employeeId": str,
      "isTest": bool
    }
    """
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    employee_id = (body.get("employeeId") or "").strip()
    is_test = bool(body.get("isTest", False))

    if not name or not employee_id:
        return jsonify({"error": "缺少姓名或員工編號"}), 400

    # Resolve LINE identity: accept either LIFF access token or bind token
    bind_token_str = (body.get("bindToken") or "").strip()
    access_token = (body.get("accessToken") or "").strip()

    if bind_token_str:
        payload = decode_bind_token(bind_token_str)
        if not payload:
            return jsonify({"error": "綁定憑證無效或已過期，請重新整理"}), 401
        line_uid: str = payload["lineUid"]
        display_name: str = payload.get("displayName", "")
    elif access_token:
        profile = verify_access_token(access_token)
        if not profile:
            return jsonify({"error": "LINE Token 驗證失敗"}), 401
        line_uid = profile["userId"]
        display_name = profile.get("displayName", "")
    else:
        return jsonify({"error": "缺少 accessToken 或 bindToken"}), 400

    sheets = _sheets(is_test)

    # Check if already bound
    existing, _ = sheets.find_account_by_uid(line_uid)
    if existing:
        return jsonify({"error": "此帳號已綁定，如需重新綁定請聯繫 HR"}), 409

    # Find the account row by identity
    account, sheet_row = sheets.find_account_by_identity(name, employee_id)
    if not account:
        return jsonify({"error": "找不到符合的員工資料，請確認姓名與員工編號"}), 404

    if account.get("status") == "已授權" and account.get("lineUid"):
        return jsonify({"error": "此員工已被其他帳號綁定，請聯繫 HR"}), 409

    # Write UID into the sheet
    sheets.bind_account(sheet_row, line_uid, display_name)

    # Notify binding success via LINE message
    push_message(
        line_uid,
        f"✅ 帳號綁定成功！\n您好，{name}，歡迎使用考核評分系統。",
        is_test=is_test,
    )

    return jsonify({
        "success": True,
        "name": account["name"],
        "jobTitle": account.get("jobTitle", ""),
        "role": account.get("role", "同仁"),
    })


# ── POST /api/auth/refresh-role ────────────────────────────────────────────

@auth_bp.route("/refresh-role", methods=["POST"])
@require_auth
def refresh_role():
    """Re-issue JWT with latest role from Sheets/Firestore.
    Called by frontend on Score page load and on 401 token-expiry recovery.
    """
    line_uid: str = g.session["lineUid"]
    is_test: bool = g.session.get("isTest", False)

    account, _ = _sheets(is_test).find_account_by_uid(line_uid)
    if not account:
        return jsonify({"error": "帳號未綁定"}), 401

    token = issue_session_token(
        line_uid=line_uid,
        name=account["name"],
        role=account.get("role", "同仁"),
        is_test=is_test,
    )
    return jsonify({
        "token": token,
        "name": account["name"],
        "role": account.get("role", "同仁"),
    })


# ── GET /api/auth/check ────────────────────────────────────────────────────

@auth_bp.route("/check", methods=["GET"])
@require_auth
def check_session():
    """Return current session info (used on app load to validate stored token)."""
    return jsonify({
        "bound": True,
        "name": g.session["name"],
        "role": g.session["role"],
        "isTest": g.session["isTest"],
    })


# ── GET /api/auth/accounts ─────────────────────────────────────────────────

@auth_bp.route("/accounts", methods=["GET"])
@require_hr
def get_all_accounts():
    """Return all accounts (HR / SysAdmin only)."""
    is_test = g.session.get("isTest", False)
    accounts = _sheets(is_test).get_all_accounts()
    return jsonify(accounts)


# ── POST /api/auth/reset ───────────────────────────────────────────────────

@auth_bp.route("/reset", methods=["POST"])
@require_hr
def reset_account():
    """
    Force-unbind a target account (HR / SysAdmin only).

    Body: { "targetLineUid": str }
    """
    body = request.get_json(silent=True) or {}
    target_uid = (body.get("targetLineUid") or "").strip()
    if not target_uid:
        return jsonify({"error": "缺少 targetLineUid"}), 400

    is_test = g.session.get("isTest", False)
    sheets = _sheets(is_test)

    _, sheet_row = sheets.find_account_by_uid(target_uid)
    if sheet_row == -1:
        return jsonify({"error": "找不到該帳號"}), 404

    sheets.unbind_account(sheet_row)
    return jsonify({"success": True})


# ── POST /api/auth/verify-code ─────────────────────────────────────────────

@auth_bp.route("/verify-code", methods=["POST"])
def verify_bind_code():
    """
    Validate the bind verification code entered by the user on bind.html.

    Body: { "code": str, "isTest": bool }
    """
    body = request.get_json(silent=True) or {}
    code = (body.get("code") or "").strip()
    is_test = bool(body.get("isTest", False))

    settings = _sheets(is_test).get_settings()
    expected = settings.get("綁定驗證碼", "HR0000")
    return jsonify({"valid": code == expected})
