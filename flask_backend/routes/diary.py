"""
/api/diary  — work diary CRUD.

All authenticated users can read/write their own diary entries.
Managers (主管/HR/系統管理員) can also read subordinates' entries (read-only).
Section isolation is enforced for 主管: only employees in their sections.
"""

from __future__ import annotations

import logging
import re

from flask import Blueprint, g, jsonify, request

from services.auth_service import require_auth, require_manager
from services.diary_service import (
    create_log,
    delete_log,
    get_logs_by_name,
    get_logs_by_uid,
    update_log,
)
from services.sheets_service import SheetsService

logger = logging.getLogger(__name__)
diary_bp = Blueprint("diary", __name__)

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MAX_CONTENT_LEN = 2000


def _valid_date(value: str) -> bool:
    return bool(_DATE_RE.match(value))


def _sheets(is_test: bool) -> SheetsService:
    return SheetsService(is_test=is_test)


# ── GET /api/diary/my-logs ────────────────────────────────────────────────────

@diary_bp.route("/my-logs", methods=["GET"])
@require_auth
def get_my_logs():
    """Return the current user's own diary entries."""
    session = g.session
    logs = get_logs_by_uid(session["lineUid"], session.get("isTest", False))
    return jsonify({"logs": logs})


# ── POST /api/diary/log ───────────────────────────────────────────────────────

@diary_bp.route("/log", methods=["POST"])
@require_auth
def create_diary_log():
    """Create a new diary entry for the current user."""
    session = g.session
    body = request.get_json(silent=True) or {}

    date = body.get("date", "").strip()
    content = body.get("content", "").strip()

    if not _valid_date(date):
        return jsonify({"error": "date 格式錯誤（需為 YYYY-MM-DD）"}), 400
    if not content:
        return jsonify({"error": "content 不可為空"}), 400
    if len(content) > _MAX_CONTENT_LEN:
        return jsonify({"error": f"content 超過 {_MAX_CONTENT_LEN} 字元上限"}), 400

    log_id = create_log(
        author_uid=session["lineUid"],
        author_name=session["name"],
        date=date,
        content=content,
        is_test=session.get("isTest", False),
    )
    return jsonify({"id": log_id}), 201


# ── PUT /api/diary/log/<log_id> ───────────────────────────────────────────────

@diary_bp.route("/log/<log_id>", methods=["PUT"])
@require_auth
def update_diary_log(log_id: str):
    """Update an owned diary entry."""
    session = g.session
    body = request.get_json(silent=True) or {}

    date = body.get("date", "").strip()
    content = body.get("content", "").strip()

    if not _valid_date(date):
        return jsonify({"error": "date 格式錯誤（需為 YYYY-MM-DD）"}), 400
    if not content:
        return jsonify({"error": "content 不可為空"}), 400
    if len(content) > _MAX_CONTENT_LEN:
        return jsonify({"error": f"content 超過 {_MAX_CONTENT_LEN} 字元上限"}), 400

    updated = update_log(
        log_id=log_id,
        author_uid=session["lineUid"],
        date=date,
        content=content,
        is_test=session.get("isTest", False),
    )
    if not updated:
        return jsonify({"error": "找不到日誌或無權限修改"}), 404
    return jsonify({"success": True})


# ── DELETE /api/diary/log/<log_id> ────────────────────────────────────────────

@diary_bp.route("/log/<log_id>", methods=["DELETE"])
@require_auth
def delete_diary_log(log_id: str):
    """Delete an owned diary entry."""
    session = g.session
    deleted = delete_log(
        log_id=log_id,
        author_uid=session["lineUid"],
        is_test=session.get("isTest", False),
    )
    if not deleted:
        return jsonify({"error": "找不到日誌或無權限刪除"}), 404
    return jsonify({"success": True})


# ── GET /api/diary/employee-logs ──────────────────────────────────────────────

@diary_bp.route("/employee-logs", methods=["GET"])
@require_manager
def get_employee_logs():
    """
    Read a named employee's diary entries (manager/HR/SysAdmin only).
    主管: restricted to their responsible sections.
    HR/系統管理員: unrestricted.
    """
    session = g.session
    role = session.get("role", "")
    is_test = session.get("isTest", False)

    emp_name = request.args.get("name", "").strip()
    if not emp_name:
        return jsonify({"error": "缺少 name 參數"}), 400

    if role == "主管":
        sheets = _sheets(is_test)
        responsibilities = sheets.get_manager_responsibilities()
        my_sections = {
            r["section"]
            for r in responsibilities
            if r["lineUid"] == session["lineUid"]
        }
        all_employees = sheets.get_all_employees()
        emp_sections = {e["section"] for e in all_employees if e["name"] == emp_name}
        if not my_sections.intersection(emp_sections):
            return jsonify({"error": "無權限查看此員工日誌"}), 403

    logs = get_logs_by_name(emp_name, is_test)
    return jsonify({"logs": logs, "empName": emp_name})
