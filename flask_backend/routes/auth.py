"""
/api/auth  — binding, session, and account management endpoints.
"""

from __future__ import annotations

import hmac
import logging

from flask import Blueprint, g, jsonify, request

import config
from extensions import limiter
from services.audit_service import write_audit_log
from services.auth_service import (
    decode_bind_token,
    issue_bind_token,
    issue_session_token,
    require_auth,
    require_hr,
    require_sysadmin,
)
from base.ports import AccountStorePort
from plugins.kpi.identity import KpiAccountStore
from services.bind_config_service import get_bind_config, validate_bind_fields
from services.line_service import exchange_auth_code, push_message, verify_access_token

logger = logging.getLogger(__name__)
auth_bp = Blueprint("auth", __name__)

# Plugin mount: swap KpiAccountStore for any AccountStorePort implementation to
# target a different system without touching the auth routes below.
_STORE: AccountStorePort = KpiAccountStore()


def _session_from_access_token(access_token: str, is_test: bool):
    """
    Shared logic: verify access token, look up account, return JSON response.
    Used by both LIFF session and LINE Login OAuth session endpoints.
    """
    profile = verify_access_token(access_token, is_test=is_test)
    if not profile:
        return jsonify({"error": "LINE Token 驗證失敗"}), 401

    line_uid: str = profile["userId"]
    display_name: str = profile.get("displayName", "")

    account, _ = _STORE.find_by_uid(line_uid, is_test)
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
@limiter.limit("10/minute")
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
@limiter.limit("10/minute")
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

    # [P0] Whitelist validation — reject redirect_uri values not registered in config
    if redirect_uri not in config.ALLOWED_REDIRECT_URIS:
        return jsonify({"error": "redirect_uri 不在許可清單中"}), 400

    access_token = exchange_auth_code(code, redirect_uri, is_test)
    if not access_token:
        return jsonify({"error": "LINE 授權失敗，請重試"}), 401

    return _session_from_access_token(access_token, is_test)


# ── GET /api/auth/bind-fields ──────────────────────────────────────────────

@auth_bp.route("/bind-fields", methods=["GET"])
@limiter.limit("60/minute")
def get_bind_fields():
    """
    Return bind field configuration for the frontend to render dynamically.

    Query: { "isTest": bool }
    Response: { "useVerifyCode": bool, "fields": [...] }
    """
    is_test = request.args.get("isTest", "false").lower() == "true"
    return jsonify(get_bind_config(is_test))


# ── POST /api/auth/bind ────────────────────────────────────────────────────

@auth_bp.route("/bind", methods=["POST"])
@limiter.limit("10/minute")
def bind_account():
    """
    Bind a LINE account using dynamically-configured identity fields.

    Body: {
      "accessToken": str,       # LIFF token (inside LINE app)
      "bindToken": str,         # bind token (external browser)
      "isTest": bool,
      ...field_values           # keys/values per _config/bind_fields (e.g. name, employeeId)
    }
    """
    body = request.get_json(silent=True) or {}
    is_test = bool(body.get("isTest", False))

    # Validate identity fields against config
    bind_config = get_bind_config(is_test)
    field_values, field_error = validate_bind_fields(bind_config["fields"], body)
    if field_error:
        return jsonify({"error": field_error}), 400

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
        profile = verify_access_token(access_token, is_test=is_test)
        if not profile:
            return jsonify({"error": "LINE Token 驗證失敗"}), 401
        line_uid = profile["userId"]
        display_name = profile.get("displayName", "")
    else:
        return jsonify({"error": "缺少 accessToken 或 bindToken"}), 400

    # Check if already bound
    existing, _ = _STORE.find_by_uid(line_uid, is_test)
    if existing:
        return jsonify({"error": "此帳號已綁定，如需重新綁定請聯繫 HR"}), 409

    # Delegate identity resolution to the plugin (field semantics are plugin-owned)
    account, sheet_row = _STORE.find_by_fields(field_values, is_test)
    if not account:
        return jsonify({"error": "找不到符合的員工資料，請確認填寫的資料是否正確"}), 404

    if account.get("status") == "已授權" and account.get("lineUid"):
        return jsonify({"error": "此員工已被其他帳號綁定，請聯繫 HR"}), 409

    # Persist binding via plugin
    _STORE.bind(sheet_row, line_uid, display_name, is_test)

    logger.info(
        "AUDIT | route=bind_account | actor=%s(%s) | action=bind | target=%s",
        name, line_uid, employee_id,
    )
    write_audit_log(
        actor_name=name, actor_uid=line_uid,
        action="bind_account",
        details={**field_values, "displayName": display_name},
        is_test=is_test,
    )  # [P1-AUDIT-03]

    # Notify binding success; failure must not undo a successful bind
    try:
        push_message(
            line_uid,
            f"✅ 帳號綁定成功！\n您好，{name}，歡迎使用考核評分系統。",
            is_test=is_test,
        )
    except Exception:
        logger.warning(
            "bind_account: LINE push_message failed for uid=%s; binding succeeded", line_uid
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

    account, _ = _STORE.find_by_uid(line_uid, is_test)
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
    accounts = _STORE.get_all(is_test)
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

    _, sheet_row = _STORE.find_by_uid(target_uid, is_test)
    if sheet_row == -1:
        return jsonify({"error": "找不到該帳號"}), 404

    _STORE.unbind(sheet_row, is_test)
    logger.info(
        "AUDIT | route=reset_account | actor=%s(%s) | action=unbind | target=%s",
        g.session["name"], g.session["lineUid"], target_uid,
    )
    write_audit_log(
        actor_name=g.session["name"], actor_uid=g.session["lineUid"],
        action="reset_account", details={"targetLineUid": target_uid}, is_test=is_test,
    )  # [P1-AUDIT-01]
    return jsonify({"success": True})


# ── GET /api/auth/bind-check ──────────────────────────────────────────────

@auth_bp.route("/bind-check", methods=["GET"])
@limiter.limit("20/minute")
def bind_check():
    """
    Check whether the LINE display name (from bind token) exists in the employee list.
    Used by Bind.tsx on mount to decide initial step: skip verify-code for known employees.

    Query: { "bindToken": str, "isTest": bool }
    Response: { "inEmployeeList": bool }
    """
    bind_token_str = (request.args.get("bindToken") or "").strip()
    is_test = request.args.get("isTest", "false").lower() == "true"

    if not bind_token_str:
        return jsonify({"error": "缺少 bindToken"}), 400

    payload = decode_bind_token(bind_token_str)
    if not payload:
        return jsonify({"error": "bindToken 無效或已過期"}), 401

    display_name: str = payload.get("displayName", "")
    in_employee_list = _STORE.name_exists(display_name, is_test)
    return jsonify({"inEmployeeList": in_employee_list})


# ── POST /api/auth/verify-code ─────────────────────────────────────────────

@auth_bp.route("/verify-code", methods=["POST"])
@limiter.limit("5/minute")
def verify_bind_code():
    """
    Validate the bind verification code entered by the user on bind.html.

    Body: { "code": str, "isTest": bool }
    """
    body = request.get_json(silent=True) or {}
    code = (body.get("code") or "").strip()
    is_test = bool(body.get("isTest", False))

    settings = _STORE.get_settings(is_test)
    expected = settings.get("綁定驗證碼", "HR0000")
    return jsonify({"valid": hmac.compare_digest(code, expected)})  # [P2-TIMING-01]
