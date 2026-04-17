"""
Authentication & authorisation helpers.

Session flow:
  1. Frontend sends LIFF access token to POST /api/auth/session
  2. We verify it with LINE, look up the account in Sheets, issue a signed JWT
  3. Frontend stores the JWT in localStorage and sends it as:
       Authorization: Bearer <jwt>
  4. All protected routes call `require_auth()` to decode the JWT

JWT payload:
  { "lineUid": str, "name": str, "role": str, "isTest": bool, "exp": int }
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from functools import wraps
from typing import Callable

import jwt
from flask import g, request, jsonify

import config

logger = logging.getLogger(__name__)

_ALGORITHM = "HS256"
_TOKEN_TTL_HOURS = 24
_BIND_TOKEN_TTL_MINUTES = 10


# ── Token issuance ─────────────────────────────────────────────────────────

def issue_session_token(
    line_uid: str,
    name: str,
    role: str,
    is_test: bool,
    responsibilities: list | None = None,
) -> str:
    payload = {
        "lineUid": line_uid,
        "name": name,
        "role": role,
        "isTest": is_test,
        "responsibilities": responsibilities or [],
        "exp": datetime.now(tz=timezone.utc) + timedelta(hours=_TOKEN_TTL_HOURS),
    }
    return jwt.encode(payload, config.jwt_secret(), algorithm=_ALGORITHM)


def issue_bind_token(line_uid: str, display_name: str) -> str:
    """Short-lived token (10 min) used by external-browser bind flow."""
    payload = {
        "lineUid": line_uid,
        "displayName": display_name,
        "purpose": "bind",
        "exp": datetime.now(tz=timezone.utc) + timedelta(minutes=_BIND_TOKEN_TTL_MINUTES),
    }
    return jwt.encode(payload, config.jwt_secret(), algorithm=_ALGORITHM)


def decode_bind_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, config.jwt_secret(), algorithms=[_ALGORITHM])
        if payload.get("purpose") != "bind":
            return None
        return payload
    except jwt.InvalidTokenError:
        return None


def decode_session_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, config.jwt_secret(), algorithms=[_ALGORITHM])
    except jwt.ExpiredSignatureError:
        logger.debug("JWT expired.")
        return None
    except jwt.InvalidTokenError as exc:
        logger.debug("Invalid JWT: %s", exc)
        return None


# ── Request decorators ─────────────────────────────────────────────────────

def _extract_bearer() -> str | None:
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[7:]
    return None


def require_auth(f: Callable) -> Callable:
    """Decode JWT and populate g.session (lineUid, name, role, isTest)."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = _extract_bearer()
        if not token:
            return jsonify({"error": "未提供授權 token"}), 401
        session = decode_session_token(token)
        if not session:
            return jsonify({"error": "Token 無效或已過期，請重新登入"}), 401
        g.session = session
        return f(*args, **kwargs)
    return decorated


def require_manager(f: Callable) -> Callable:
    """Require any authenticated user (主管/HR/系統管理員)."""
    @wraps(f)
    @require_auth
    def decorated(*args, **kwargs):
        role = g.session.get("role", "")
        if role not in ("主管", "HR", "系統管理員"):
            return jsonify({"error": "無評分主管權限"}), 403
        return f(*args, **kwargs)
    return decorated


def require_hr(f: Callable) -> Callable:
    """Require HR or SysAdmin role."""
    @wraps(f)
    @require_auth
    def decorated(*args, **kwargs):
        role = g.session.get("role", "")
        if role not in ("HR", "系統管理員"):
            return jsonify({"error": "無 HR 權限"}), 403
        return f(*args, **kwargs)
    return decorated


def require_sysadmin(f: Callable) -> Callable:
    """Require SysAdmin role."""
    @wraps(f)
    @require_auth
    def decorated(*args, **kwargs):
        if g.session.get("role") != "系統管理員":
            return jsonify({"error": "無系統管理員權限"}), 403
        return f(*args, **kwargs)
    return decorated


def can_access_employee_data(session: dict, emp_name: str, sheets) -> bool:
    """Return True if the session user may read data about emp_name.

    HR / 系統管理員: unrestricted access.
    主管: restricted to employees in their responsible sections.
    All other roles: denied.
    """
    role = session.get("role", "")
    if role in ("HR", "系統管理員"):
        return True
    if role != "主管":
        return False

    manager_name: str = session["name"]
    line_uid: str = session["lineUid"]

    all_resp = sheets.get_manager_responsibilities()
    all_employees = sheets.get_all_employees()

    emp_rec = next(
        (e for e in all_employees if e.get("name", "").strip() == manager_name), None
    )
    manager_emp_id = emp_rec.get("employeeId", "") if emp_rec else ""

    responsibilities = [
        r for r in all_resp
        if (manager_emp_id and r.get("employeeId") == manager_emp_id)
        or (not manager_emp_id and r.get("lineUid") == line_uid)
    ]
    manager_sections = {r["section"] for r in responsibilities}
    emp_sections = {e["section"] for e in all_employees if e["name"] == emp_name}

    return bool(manager_sections.intersection(emp_sections))
